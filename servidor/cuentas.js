/**
 * cuentas.js — Perfiles, contraseñas, sesiones, enlaces de invitado y permisos.
 *
 * PERFILES
 *  - admin     Administración: puede cambiar todo.
 *  - docente   Docente del centro: todos los recursos (igual que VIP).
 *  - vip       Usuario VIP: todos los recursos. Cuenta creada por la administración.
 *  - pago      Usuario de pago: todos los recursos y, tras pagar, los cursos.
 *  - invitado  Prueba gratis: solo una selección de recursos y durante unos días.
 *              Entra con un enlace (y también con usuario y contraseña generados).
 *
 * SEGURIDAD
 *  - Contraseñas con scrypt y «sal» aleatoria (nunca en texto).
 *  - La sesión es una cookie HttpOnly con un código aleatorio; en disco solo
 *    se guarda su resumen SHA-256 (si alguien roba el archivo, no le sirve).
 *  - Los enlaces de invitado también se guardan solo como resumen.
 *  - Todas las comprobaciones de permiso se hacen en el servidor.
 */
const crypto = require("node:crypto");
const path = require("node:path");
const { Almacen } = require("./almacen");
const config = require("./config");

const ROLES = ["admin", "docente", "vip", "pago", "invitado"];
const ROLE_LABELS = {
  admin: "Administración",
  docente: "Docente del centro",
  vip: "VIP",
  pago: "De pago",
  invitado: "Invitado"
};

const SESSION_HOURS = 12;

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
/** Contraseña legible: 12 caracteres sin letras que se confunden (0/O, 1/l). */
function randomPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.randomBytes(12);
  for (const b of bytes) out += chars[b % chars.length];
  return out.slice(0, 8) + "-" + (bytes[0] % 90 + 10); // siempre lleva números
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}
function checkPassword(user, password) {
  if (!user || !user.hash) return false;
  const a = Buffer.from(hashPassword(password, user.salt).hash, "hex");
  const b = Buffer.from(user.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function passwordProblem(password) {
  if (!password || String(password).length < 8) return "La contraseña debe tener 8 caracteres o más.";
  if (!/\d/.test(password)) return "La contraseña debe tener al menos un número.";
  return null;
}

class Cuentas {
  constructor() {
    this.users = new Almacen(path.join(config.privateDir, "usuarios.json"), []);
    this.sessions = new Almacen(path.join(config.privateDir, "sesiones.json"), []);
    this.firstRunPassword = null;
    this._seed();
    this._cleanSessions();
  }

  /** Primera vez: crea la cuenta de administración (y las de prueba si DEMO=1). */
  _seed() {
    if (!this.users.data.length) {
      const pass = config.adminPassword || randomPassword();
      if (!config.adminPassword) this.firstRunPassword = pass;
      this._insert({ username: "admin", displayName: "Administración SAFA", role: "admin", password: pass, createdBy: "sistema" });
    }
    if (config.demo) {
      const demo = [
        ["docente", "Docente de prueba", "docente", "Docente2026!"],
        ["vip", "Persona VIP de prueba", "vip", "Vip2026!"],
        ["pago", "Persona de pago de prueba", "pago", "Pago2026!"]
      ];
      for (const [username, displayName, role, password] of demo) {
        if (!this.findByUsername(username)) this._insert({ username, displayName, role, password, createdBy: "demo" });
      }
      if (config.adminPassword && this.findByUsername("admin")) {
        Object.assign(this.findByUsername("admin"), hashPassword(config.adminPassword));
      }
    }
    this.users.saveSync();
  }

  _insert({ username, displayName, role, password, email = "", createdBy, expiresAt = null }) {
    const user = {
      id: "usr_" + randomToken(9),
      username: username.toLowerCase(),
      displayName: displayName || username,
      email: email.toLowerCase(),
      role,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy,
      expiresAt,
      paidUntil: null,
      ...hashPassword(password)
    };
    this.users.data.push(user);
    return user;
  }

  _cleanSessions() {
    const now = Date.now();
    this.sessions.data = this.sessions.data.filter((s) => s.expiresAt > now);
    this.sessions.saveSync();
  }

  findById(id) {
    return this.users.data.find((u) => u.id === id);
  }
  findByUsername(username) {
    const name = String(username || "").trim().toLowerCase();
    return this.users.data.find((u) => u.username === name);
  }

  /** ¿La cuenta puede entrar ahora? (activa y, si es invitado, sin caducar) */
  isUsable(user) {
    if (!user || !user.active) return false;
    if (user.expiresAt && Date.parse(user.expiresAt) < Date.now()) return false;
    return true;
  }

  /** Datos que se pueden enviar al navegador (sin contraseña ni códigos). */
  publicUser(u) {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      email: u.email || "",
      role: u.role,
      roleLabel: ROLE_LABELS[u.role],
      active: u.active,
      createdAt: u.createdAt,
      expiresAt: u.expiresAt || null,
      paidUntil: u.paidUntil || null,
      hasPaid: this.hasPaid(u)
    };
  }

  hasPaid(u) {
    return Boolean(u && u.paidUntil && Date.parse(u.paidUntil) > Date.now());
  }

  /* ------------------------------------------------------------------ */
  /* Permisos                                                             */
  /* ------------------------------------------------------------------ */
  /**
   * ¿Puede este usuario hacer esta acción?
   *   resource:all     ver TODOS los recursos
   *   resource:sample  ver la selección de prueba
   *   course:view      ver el contenido de los cursos
   *   course:buy       pagar para desbloquear los cursos
   *   admin            panel de administración
   */
  can(user, action) {
    if (!this.isUsable(user)) return false;
    switch (action) {
      case "resource:all":
        return ["admin", "docente", "vip", "pago"].includes(user.role);
      case "resource:sample":
        return true;
      case "course:view":
        return user.role === "admin" || (user.role === "pago" && this.hasPaid(user));
      case "course:buy":
        return user.role === "pago";
      case "admin":
        return user.role === "admin";
      default:
        return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sesiones                                                             */
  /* ------------------------------------------------------------------ */
  createSession(user) {
    const now = Date.now();
    this.sessions.data = this.sessions.data.filter((s) => s.expiresAt > now); // limpia las caducadas
    const token = randomToken();
    let expiresAt = Date.now() + SESSION_HOURS * 3600 * 1000;
    if (user.expiresAt) expiresAt = Math.min(expiresAt, Date.parse(user.expiresAt));
    this.sessions.data.push({ tokenHash: sha256(token), userId: user.id, expiresAt });
    this.sessions.save();
    return { token, maxAge: Math.max(60, Math.floor((expiresAt - Date.now()) / 1000)) };
  }

  /** Devuelve el usuario de una sesión válida, o null. */
  userFromToken(token) {
    if (!token) return null;
    const hash = sha256(token);
    const s = this.sessions.data.find((x) => x.tokenHash === hash);
    if (!s || s.expiresAt < Date.now()) return null;
    const user = this.findById(s.userId);
    return this.isUsable(user) ? user : null;
  }

  destroySession(token) {
    const hash = sha256(token || "");
    this.sessions.data = this.sessions.data.filter((s) => s.tokenHash !== hash);
    this.sessions.save();
  }

  destroyUserSessions(userId) {
    this.sessions.data = this.sessions.data.filter((s) => s.userId !== userId);
    this.sessions.save();
  }

  /* ------------------------------------------------------------------ */
  /* Inicio de sesión                                                     */
  /* ------------------------------------------------------------------ */
  login(username, password) {
    const user = this.findByUsername(username);
    if (!user || !checkPassword(user, password)) return { ok: false, message: "El usuario o la contraseña no son correctos. Revísalos y prueba otra vez." };
    if (user.expiresAt && Date.parse(user.expiresAt) < Date.now()) {
      return { ok: false, message: "Tu acceso de prueba ha terminado. Pide una cuenta completa al equipo de administración." };
    }
    if (!user.active) return { ok: false, message: "Esta cuenta está desactivada. Habla con el equipo de administración." };
    return { ok: true, user };
  }

  /* ------------------------------------------------------------------ */
  /* Gestión (solo administración)                                        */
  /* ------------------------------------------------------------------ */
  create({ username, displayName, email, role, password }, createdBy) {
    const name = String(username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(name)) return { ok: false, message: "El usuario debe tener de 3 a 30 letras o números, sin espacios ni tildes." };
    if (this.findByUsername(name)) return { ok: false, message: "Ya existe una cuenta con ese usuario." };
    if (!ROLES.includes(role) || role === "invitado") return { ok: false, message: "Elige un tipo de cuenta válido. Los invitados se crean con «Invitar»." };
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "El correo no es correcto." };
    const problem = passwordProblem(password);
    if (problem) return { ok: false, message: problem };
    const user = this._insert({ username: name, displayName: String(displayName || name).trim().slice(0, 80), email: email || "", role, password, createdBy });
    this.users.save();
    return { ok: true, message: `Cuenta «${name}» creada.`, user };
  }

  update(id, changes, actor) {
    const user = this.findById(id);
    if (!user) return { ok: false, message: "No se encuentra la cuenta." };
    if (changes.role !== undefined) {
      if (!ROLES.includes(changes.role)) return { ok: false, message: "Tipo de cuenta no válido." };
      if (user.id === actor.id && changes.role !== "admin") return { ok: false, message: "No puedes quitarte a ti el permiso de administración." };
      if (user.role === "admin" && changes.role !== "admin" && this.users.data.filter((u) => u.role === "admin").length <= 1) {
        return { ok: false, message: "Debe quedar al menos una cuenta de administración." };
      }
      if (changes.role !== "invitado") user.expiresAt = null;
      user.role = changes.role;
    }
    if (changes.displayName !== undefined) user.displayName = String(changes.displayName).trim().slice(0, 80) || user.username;
    if (changes.email !== undefined) {
      if (changes.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(changes.email)) return { ok: false, message: "El correo no es correcto." };
      user.email = String(changes.email).toLowerCase();
    }
    if (changes.active !== undefined) {
      if (user.id === actor.id && !changes.active) return { ok: false, message: "No puedes desactivar tu propia cuenta." };
      user.active = Boolean(changes.active);
      if (!user.active) this.destroyUserSessions(user.id);
    }
    if (changes.expiresAt !== undefined && user.role === "invitado") {
      const t = Date.parse(changes.expiresAt);
      if (!Number.isFinite(t)) return { ok: false, message: "La fecha de fin no es correcta." };
      user.expiresAt = new Date(t).toISOString();
    }
    if (changes.paidUntil !== undefined) {
      user.paidUntil = changes.paidUntil ? new Date(Date.parse(changes.paidUntil)).toISOString() : null;
    }
    user.updatedAt = new Date().toISOString();
    user.updatedBy = actor.username;
    this.users.save();
    return { ok: true, message: "Cuenta actualizada.", user };
  }

  setPassword(id, password) {
    const user = this.findById(id);
    if (!user) return { ok: false, message: "No se encuentra la cuenta." };
    const problem = passwordProblem(password);
    if (problem) return { ok: false, message: problem };
    Object.assign(user, hashPassword(password));
    this.users.save();
    return { ok: true, message: "Contraseña cambiada." };
  }

  remove(id, actor) {
    const user = this.findById(id);
    if (!user) return { ok: false, message: "No se encuentra la cuenta." };
    if (user.id === actor.id) return { ok: false, message: "No puedes borrar tu propia cuenta." };
    if (user.role === "admin" && this.users.data.filter((u) => u.role === "admin").length <= 1) {
      return { ok: false, message: "Debe quedar al menos una cuenta de administración." };
    }
    this.users.data = this.users.data.filter((u) => u.id !== id);
    this.destroyUserSessions(id);
    this.users.save();
    return { ok: true, message: `Cuenta «${user.username}» borrada.` };
  }

  /* ------------------------------------------------------------------ */
  /* Invitados                                                            */
  /* ------------------------------------------------------------------ */
  /**
   * Crea (o renueva) un invitado y genera sus credenciales y su enlace.
   * Si ya hay un invitado con ese correo, se le da un enlace nuevo.
   * @returns {{ok:boolean, user?:Object, link?:string, password?:string, message?:string}}
   */
  inviteGuest({ email, displayName, days }, createdBy) {
    const mail = String(email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { ok: false, message: "Escribe un correo electrónico correcto." };
    const existing = this.users.data.find((u) => u.email === mail);
    if (existing && existing.role !== "invitado") {
      return { ok: false, message: "Ese correo ya tiene una cuenta completa. No hace falta invitarle." };
    }
    const duration = Math.min(Math.max(Number(days) || config.guest.days, 1), 90);
    const expiresAt = new Date(Date.now() + duration * 86400 * 1000).toISOString();
    const password = randomPassword();
    let user = existing;
    if (!user) {
      let username;
      do username = "invitado-" + crypto.randomBytes(3).toString("hex");
      while (this.findByUsername(username));
      user = this._insert({ username, displayName: String(displayName || "Invitado").trim().slice(0, 80), email: mail, role: "invitado", password, createdBy, expiresAt });
    } else {
      Object.assign(user, hashPassword(password), { expiresAt, active: true });
    }
    const token = randomToken();
    user.guestTokenHash = sha256(token);
    this.users.save();
    return { ok: true, user, password, link: `${config.baseUrl}/acceso/${token}`, days: duration };
  }

  /** Busca al invitado de un enlace. Devuelve {user} o {error}. */
  userFromGuestLink(token) {
    const hash = sha256(token || "");
    const user = this.users.data.find((u) => u.guestTokenHash && u.guestTokenHash === hash);
    if (!user) return { error: "Este enlace no es válido. Puede que se haya creado uno nuevo." };
    if (!user.active) return { error: "Este acceso está desactivado." };
    if (user.expiresAt && Date.parse(user.expiresAt) < Date.now()) return { error: "Tu acceso de prueba ha terminado. Gracias por probar la plataforma." };
    return { user };
  }

  /* ------------------------------------------------------------------ */
  /* Pagos                                                                */
  /* ------------------------------------------------------------------ */
  /** Suma meses de acceso a los cursos (desde hoy o desde el final actual). */
  grantPaidAccess(userId, months) {
    const user = this.findById(userId);
    if (!user) return null;
    const from = Math.max(Date.now(), user.paidUntil ? Date.parse(user.paidUntil) : 0);
    const d = new Date(from);
    d.setMonth(d.getMonth() + months);
    user.paidUntil = d.toISOString();
    this.users.save();
    return user;
  }
}

module.exports = { Cuentas, ROLES, ROLE_LABELS, passwordProblem, sha256, randomToken };
