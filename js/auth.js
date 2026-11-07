/**
 * ============================================================================
 *  auth.js — Inicio de sesión, cuentas y permisos
 * ============================================================================
 *  Roles:
 *    - «docente»: puede ver, buscar, abrir y descargar recursos.
 *    - «admin»:   además puede añadir, modificar y borrar recursos,
 *                 categorías y cuentas de docentes.
 *
 *  IMPORTANTE (decisión documentada): el documento de especificaciones pide
 *  una web estática sin servidor (abrir index.html). Por eso el inicio de
 *  sesión y los permisos se comprueban en el navegador. Esto sirve para
 *  ordenar el uso en el centro, pero NO es una protección fuerte: quien
 *  sepa manejar las herramientas del navegador podría saltárselo. Si la
 *  plataforma se publica en Internet con datos sensibles, hay que mover
 *  estas comprobaciones a un servidor (ver docs/ARQUITECTURA.md).
 * ============================================================================
 */
window.EduAuth = (function () {
  const S = () => window.EduStorage;

  /** Qué puede hacer cada rol. */
  const PERMISSIONS = {
    docente: ["resource:view", "resource:download"],
    admin: [
      "resource:view",
      "resource:download",
      "resource:create",
      "resource:update",
      "resource:delete",
      "category:create",
      "category:update",
      "category:delete",
      "user:manage",
      "data:import",
      "data:export"
    ]
  };

  /** Bloqueo sencillo tras 5 intentos fallidos (1 minuto). */
  const MAX_ATTEMPTS = 5;
  const LOCK_MS = 60 * 1000;
  let failedAttempts = 0;
  let lockedUntil = 0;

  let users = [];
  let session = null;

  function init() {
    users = S().loadUsers();
    session = S().loadSession();
    // Si la cuenta de la sesión ya no existe o está desactivada, se cierra
    if (session && !users.some((u) => u.id === session.userId && u.active)) {
      logout();
    }
  }

  /**
   * Intenta entrar con usuario y contraseña.
   * @returns {{ok:boolean, message?:string, user?:Object}}
   */
  function login(username, password) {
    if (Date.now() < lockedUntil) {
      const secs = Math.ceil((lockedUntil - Date.now()) / 1000);
      return { ok: false, message: `Has fallado muchas veces. Espera ${secs} segundos y vuelve a probar.` };
    }
    const name = String(username || "").trim().toLowerCase();
    if (!name || !password) {
      return { ok: false, message: "Escribe tu usuario y tu contraseña." };
    }
    const user = users.find((u) => u.username.toLowerCase() === name);
    const valid = user && user.active && S().hashPassword(password, user.salt).passwordHash === user.passwordHash;
    if (!valid) {
      failedAttempts++;
      if (failedAttempts >= MAX_ATTEMPTS) {
        lockedUntil = Date.now() + LOCK_MS;
        failedAttempts = 0;
      }
      // Mensaje igual para usuario o contraseña: no se da pista de cuál falla
      return { ok: false, message: "El usuario o la contraseña no son correctos. Revísalos y prueba otra vez." };
    }
    failedAttempts = 0;
    session = { userId: user.id, username: user.username, displayName: user.displayName, role: user.role, since: Date.now() };
    S().saveSession(session);
    return { ok: true, user: publicUser(user) };
  }

  function logout() {
    session = null;
    S().clearSession();
  }

  function currentUser() {
    return session;
  }

  function isAdmin() {
    return Boolean(session && session.role === "admin");
  }

  /** ¿Puede el usuario actual hacer esta acción? */
  function can(action) {
    return Boolean(session && (PERMISSIONS[session.role] || []).includes(action));
  }

  /**
   * Lanza un error si el usuario no tiene permiso. Todas las funciones que
   * cambian datos en app.js llaman a esto ANTES de hacer nada.
   */
  function require(action) {
    if (!can(action)) {
      throw new Error("No tienes permiso para hacer esto. Solo el equipo de administración puede.");
    }
  }

  /** Copia de la cuenta sin datos de contraseña. */
  function publicUser(u) {
    return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, active: u.active, createdAt: u.createdAt };
  }

  function listUsers() {
    require("user:manage");
    return users.map(publicUser);
  }

  /** Reglas sencillas de contraseña: 8 letras, con algún número. */
  function checkPassword(password) {
    if (!password || password.length < 8) return "La contraseña debe tener 8 caracteres o más.";
    if (!/\d/.test(password)) return "La contraseña debe tener al menos un número.";
    return null;
  }

  /**
   * Crea una cuenta nueva (solo administración).
   * @returns {{ok:boolean, message:string}}
   */
  function createUser({ username, displayName, password, role }) {
    require("user:manage");
    const name = String(username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(name)) {
      return { ok: false, message: "El usuario debe tener de 3 a 30 letras o números, sin espacios ni tildes." };
    }
    if (users.some((u) => u.username.toLowerCase() === name)) {
      return { ok: false, message: "Ya existe una cuenta con ese usuario." };
    }
    const pwError = checkPassword(password);
    if (pwError) return { ok: false, message: pwError };
    users.push({
      id: window.EduUtils.uid("usr"),
      username: name,
      displayName: String(displayName || name).trim(),
      role: role === "admin" ? "admin" : "docente",
      active: true,
      createdAt: new Date().toISOString(),
      ...S().hashPassword(password)
    });
    if (!S().saveUsers(users)) return { ok: false, message: "No se pudo guardar. El navegador no tiene espacio." };
    return { ok: true, message: `Cuenta «${name}» creada.` };
  }

  /** Cambia la contraseña de una cuenta (admin para cualquiera, o la propia). */
  function changePassword(userId, newPassword) {
    if (!session) throw new Error("Primero tienes que entrar.");
    if (session.userId !== userId) require("user:manage");
    const pwError = checkPassword(newPassword);
    if (pwError) return { ok: false, message: pwError };
    const user = users.find((u) => u.id === userId);
    if (!user) return { ok: false, message: "No se encuentra la cuenta." };
    Object.assign(user, S().hashPassword(newPassword));
    S().saveUsers(users);
    return { ok: true, message: "Contraseña cambiada." };
  }

  /** Borra una cuenta. No se puede borrar la propia ni el último admin. */
  function deleteUser(userId) {
    require("user:manage");
    if (session.userId === userId) return { ok: false, message: "No puedes borrar tu propia cuenta." };
    const user = users.find((u) => u.id === userId);
    if (!user) return { ok: false, message: "No se encuentra la cuenta." };
    if (user.role === "admin" && users.filter((u) => u.role === "admin").length <= 1) {
      return { ok: false, message: "Debe quedar al menos una cuenta de administración." };
    }
    users = users.filter((u) => u.id !== userId);
    S().saveUsers(users);
    return { ok: true, message: `Cuenta «${user.username}» borrada.` };
  }

  /**
   * ¿Siguen las cuentas de prueba con su contraseña original? Si es así, la
   * pantalla de inicio las muestra. En cuanto se cambian, dejan de verse.
   */
  function demoAccountsActive() {
    return (window.DEMO_USERS || []).some((d) => {
      const u = users.find((x) => x.username === d.username);
      return u && u.active && S().hashPassword(d.password, u.salt).passwordHash === u.passwordHash;
    });
  }

  return { init, login, demoAccountsActive, logout, currentUser, isAdmin, can, require, listUsers, createUser, changePassword, deleteUser };
})();
