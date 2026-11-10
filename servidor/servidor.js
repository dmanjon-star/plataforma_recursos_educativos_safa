/**
 * servidor.js — Servidor web de Recursos SAFA (Node.js, sin framework).
 *
 *   npm start
 *
 * Sirve la interfaz (index.html, css, js) y la API (/api/...). Todas las
 * decisiones de permisos se toman AQUÍ, no en el navegador.
 *
 * Seguridad general:
 *  - Cookie de sesión HttpOnly + SameSite=Lax (+ Secure con https).
 *  - Las peticiones que cambian datos deben llevar la cabecera
 *    «X-Requested-With: SAFA» (protección contra CSRF: otra web no puede
 *    añadir esa cabecera sin permiso CORS, y este servidor no lo da).
 *  - Cabeceras de seguridad (CSP, nosniff, frame-ancestors…).
 *  - Límite de intentos en el inicio de sesión y en las solicitudes de invitado.
 *  - Solo se sirven los archivos de la interfaz; nunca data/ ni servidor/.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const { Cuentas, ROLE_LABELS } = require("./cuentas");
const { Catalogo, httpError } = require("./catalogo");
const { Pagos } = require("./pagos");
const { SyncGitHub } = require("./github");
const { analyzeUrl } = require("./autoclasificador");
const correo = require("./correo");
const { CFG } = require("./compartido");

const cuentas = new Cuentas();
const github = new SyncGitHub();
const catalogo = new Catalogo(github);
const pagos = new Pagos(cuentas);

// Al arrancar se revisa si el catálogo difiere de GitHub (por si hubo cambios sin subir)
github.markDirty(config.catalogFile);
github.start(() => catalogo.summary());

/* ======================================================================= */
/* Utilidades HTTP                                                          */
/* ======================================================================= */
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    ...(isJson ? { "Content-Type": "application/json; charset=utf-8" } : {}),
    ...headers
  });
  res.end(isJson ? JSON.stringify(body) : body);
}
const json = (res, status, body) => send(res, status, body);
const redirect = (res, location, headers = {}) => send(res, 303, "", { Location: location, ...headers });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, "Los datos enviados son demasiado grandes."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req, limit = 100 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw httpError(400, "Los datos enviados no son válidos.");
  }
}

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))])
  );
}
const COOKIE = "safa_sid";
function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? "; Secure" : ""}`;
}
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.secureCookies ? "; Secure" : ""}`;

function clientIp(req) {
  // Detrás de un proxy (Render, Nginx…) la IP real va en X-Forwarded-For.
  // Solo se hace caso a esa cabecera con TRUST_PROXY=1: sin proxy, cualquiera podría inventarla.
  if (config.trustProxy && req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  return String(req.socket.remoteAddress || "");
}

/** Límite sencillo de intentos: máximo `max` en `windowMs` por clave. */
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  if (hits.size > 10000) hits.clear(); // evita que la memoria crezca sin límite
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  return true;
}

/* ======================================================================= */
/* Archivos de la interfaz                                                   */
/* ======================================================================= */
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/css/styles.css": ["css/styles.css", "text/css; charset=utf-8"],
  "/js/utils.js": ["js/utils.js", "text/javascript; charset=utf-8"],
  "/js/api.js": ["js/api.js", "text/javascript; charset=utf-8"],
  "/js/app.js": ["js/app.js", "text/javascript; charset=utf-8"],
  "/favicon.svg": ["css/favicon.svg", "image/svg+xml"]
};
function serveStatic(res, pathname) {
  const entry = STATIC[pathname];
  if (!entry) return false;
  const file = path.join(config.ROOT, entry[0]);
  if (!fs.existsSync(file)) return false;
  send(res, 200, fs.readFileSync(file), { "Content-Type": entry[1], "Cache-Control": "no-cache" });
  return true;
}

/** Página sencilla para mensajes (enlace de invitado caducado, pago…). */
function messagePage(res, status, title, message) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  send(
    res,
    status,
    `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} | Recursos SAFA</title><link rel="stylesheet" href="/css/styles.css"></head>
<body><main class="login-view"><div class="login-card"><div class="login-logo" aria-hidden="true">📚</div><h1 class="login-title">${esc(title)}</h1><p class="help-box">${esc(message)}</p><a class="btn btn-primary btn-xl btn-block" href="/">Ir a la página de inicio</a></div></main></body></html>`,
    { "Content-Type": "text/html; charset=utf-8" }
  );
}

/* ======================================================================= */
/* Rutas                                                                     */
/* ======================================================================= */
const routes = [];
/**
 * Registra una ruta.
 * @param {string} method
 * @param {string} pattern - Con parámetros «:nombre».
 * @param {"public"|"user"|"admin"} access
 * @param {Function} handler - (ctx) => respuesta
 */
function route(method, pattern, access, handler) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, access, handler });
}

const me = (u) => ({ ...cuentas.publicUser(u), can: { all: cuentas.can(u, "resource:all"), courses: cuentas.can(u, "course:view"), buy: cuentas.can(u, "course:buy"), admin: cuentas.can(u, "admin") } });

/* ---------- Público ---------- */
route("GET", "/api/config", "public", () => ({
  config: CFG,
  roles: ROLE_LABELS,
  payments: { ...pagos.providers(), price: config.payments.price, currency: config.payments.currency, months: config.payments.months },
  guest: { selfSignup: config.guest.selfSignup && correo.isConfigured(), days: config.guest.days },
  ai: config.ai.enabled,
  mail: correo.isConfigured()
}));

route("POST", "/api/login", "public", async ({ req, res }) => {
  const body = await readJson(req);
  const ip = clientIp(req);
  if (!rateLimit(`login:${ip}`, 10, 15 * 60e3)) throw httpError(429, "Has fallado muchas veces. Espera unos minutos y vuelve a probar.");
  const r = cuentas.login(body.username, body.password);
  if (!r.ok) throw httpError(401, r.message);
  hits.delete(`login:${ip}`);
  const s = cuentas.createSession(r.user);
  res.setHeader("Set-Cookie", sessionCookie(s.token, s.maxAge));
  return { user: me(r.user) };
});

route("POST", "/api/logout", "public", ({ req, res }) => {
  cuentas.destroySession(cookies(req)[COOKIE]);
  res.setHeader("Set-Cookie", clearCookie());
  return { ok: true };
});

route("GET", "/api/sesion", "user", ({ user }) => ({ user: me(user) }));

/** Prueba gratis: cualquiera deja su correo y recibe el enlace (si hay correo configurado). */
route("POST", "/api/invitados/solicitar", "public", async ({ req }) => {
  if (!config.guest.selfSignup || !correo.isConfigured()) throw httpError(403, "Ahora mismo no se pueden pedir accesos de prueba. Escribe al equipo de administración.");
  const body = await readJson(req);
  if (!rateLimit(`guest:${clientIp(req)}`, 5, 3600e3)) throw httpError(429, "Has hecho muchas solicitudes. Prueba dentro de una hora.");
  const email = String(body.email || "").trim().toLowerCase();
  if (!rateLimit(`guest-mail:${email}`, 2, 3600e3)) throw httpError(429, "Ya hemos enviado un enlace a ese correo. Revisa tu bandeja de entrada.");
  const r = cuentas.inviteGuest({ email, displayName: body.name || "Invitado", days: config.guest.days }, "autoservicio");
  // Mismo mensaje tanto si existe la cuenta como si no (no se revela quién está registrado)
  if (r.ok) {
    await correo.sendGuestInvite({ to: email, name: r.user.displayName, link: r.link, username: r.user.username, password: r.password, days: r.days }).catch((e) => console.error("Correo:", e.message));
  } else if (!/cuenta completa/.test(r.message)) {
    throw httpError(400, r.message);
  }
  return { ok: true, message: "Si el correo es correcto, en unos minutos te llegará un enlace para entrar. Mira también en «Spam»." };
});

/** Enlace de invitado: entra directamente. */
route("GET", "/acceso/:token", "public", ({ res, params }) => {
  const r = cuentas.userFromGuestLink(params.token);
  if (r.error) return messagePage(res, 410, "No se puede entrar", r.error);
  const s = cuentas.createSession(r.user);
  return redirect(res, "/#catalogo", { "Set-Cookie": sessionCookie(s.token, s.maxAge) });
});

/* ---------- Usuarios con sesión ---------- */
route("POST", "/api/cuenta/contrasena", "user", async ({ req, user }) => {
  const body = await readJson(req);
  if (user.role === "invitado") throw httpError(403, "Las cuentas de prueba no pueden cambiar la contraseña.");
  if (!cuentas.login(user.username, body.current).ok) throw httpError(400, "La contraseña actual no es correcta.");
  const r = cuentas.setPassword(user.id, body.password);
  if (!r.ok) throw httpError(400, r.message);
  return r;
});

route("GET", "/api/catalogo", "user", ({ user }) => {
  const all = cuentas.can(user, "resource:all");
  return {
    categories: catalogo.categories,
    resources: catalogo.visibleFor(all),
    total: catalogo.resources.length,
    limited: !all
  };
});

route("GET", "/api/archivos/:id", "user", ({ res, user, params }) => {
  const r = catalogo.resources.find((x) => x.id === params.id);
  const allowed = r && (cuentas.can(user, "resource:all") || r.guestSample);
  const file = allowed && catalogo.filePath(r);
  if (!file) throw httpError(404, "No se encuentra el archivo.");
  const name = encodeURIComponent(r.file.name);
  send(res, 200, fs.readFileSync(file), {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${name}`
  });
});

route("GET", "/api/cursos", "user", ({ user }) => {
  const full = cuentas.can(user, "course:view");
  return { courses: catalogo.listCourses(full), unlocked: full, canBuy: cuentas.can(user, "course:buy"), paidUntil: user.paidUntil };
});

/* ---------- Pagos ---------- */
route("POST", "/api/pagos/stripe", "user", async ({ user }) => {
  if (!cuentas.can(user, "course:buy")) throw httpError(403, "Solo las cuentas de pago pueden comprar los cursos.");
  if (!pagos.providers().stripe) throw httpError(503, "El pago con tarjeta (Stripe) no está configurado.");
  return { url: await pagos.createStripeCheckout(user) };
});

route("POST", "/api/pagos/paypal", "user", async ({ user }) => {
  if (!cuentas.can(user, "course:buy")) throw httpError(403, "Solo las cuentas de pago pueden comprar los cursos.");
  if (!pagos.providers().paypal) throw httpError(503, "El pago con PayPal no está configurado.");
  return { url: await pagos.createPaypalOrder(user) };
});

route("GET", "/pago/stripe/ok", "user", async ({ res, user, query }) => {
  const r = await pagos.confirmStripeSession(query.get("session_id"), user.id).catch((e) => ({ ok: false, message: e.message }));
  return redirect(res, r.ok ? "/#cursos?pago=ok" : `/#cursos?pago=error&motivo=${encodeURIComponent(r.message)}`);
});

route("GET", "/pago/paypal/ok", "user", async ({ res, user, query }) => {
  const r = await pagos.capturePaypalOrder(query.get("token"), user.id).catch((e) => ({ ok: false, message: e.message }));
  return redirect(res, r.ok ? "/#cursos?pago=ok" : `/#cursos?pago=error&motivo=${encodeURIComponent(r.message)}`);
});

/** Aviso firmado de Stripe (no lleva sesión: se comprueba la firma). */
route("POST", "/api/pagos/stripe/webhook", "webhook", async ({ req }) => {
  const raw = (await readBody(req, 512 * 1024)).toString("utf8");
  if (!pagos.verifyStripeSignature(raw, req.headers["stripe-signature"])) throw httpError(400, "Firma no válida.");
  const r = pagos.handleStripeEvent(JSON.parse(raw));
  return { received: true, ok: r.ok };
});

/* ---------- Administración: recursos ---------- */
route("POST", "/api/admin/analizar", "admin", async ({ req, user }) => {
  if (!rateLimit(`analyze:${user.id}`, 30, 60e3)) throw httpError(429, "Demasiados análisis seguidos. Espera un minuto.");
  const body = await readJson(req);
  const result = await analyzeUrl(body, { catalog: catalogo.resources, categories: catalogo.categories, ignoreId: body.ignoreId || null });
  if (result.record && result.record.url) catalogo.rememberAnalysis(result.record.url, result.validation);
  return result;
});

route("POST", "/api/admin/recursos", "admin", async ({ req, user }) => ({ resource: catalogo.saveResource(await readJson(req, 3 * 1024 * 1024), user) }));
route("PUT", "/api/admin/recursos/:id", "admin", async ({ req, user, params }) => ({ resource: catalogo.saveResource(await readJson(req, 3 * 1024 * 1024), user, params.id) }));
route("DELETE", "/api/admin/recursos/:id", "admin", ({ params }) => ({ deleted: catalogo.deleteResource(params.id).id }));
route("PUT", "/api/admin/recursos/:id/muestra", "admin", async ({ req, params }) => ({ resource: catalogo.setSample(params.id, (await readJson(req)).guestSample) }));

/* ---------- Administración: categorías ---------- */
route("POST", "/api/admin/categorias", "admin", async ({ req }) => ({ category: catalogo.addCategory(await readJson(req)) }));
route("PUT", "/api/admin/categorias/:id", "admin", async ({ req, params }) => ({ category: catalogo.updateCategory(params.id, await readJson(req)) }));
route("DELETE", "/api/admin/categorias/:id", "admin", ({ params }) => (catalogo.deleteCategory(params.id), { ok: true }));
route("POST", "/api/admin/categorias/:id/secciones", "admin", async ({ req, params }) => ({ subcategory: catalogo.addSubcategory(params.id, await readJson(req)).sub }));
route("PUT", "/api/admin/categorias/:id/secciones/:sid", "admin", async ({ req, params }) => ({ subcategory: catalogo.updateSubcategory(params.id, params.sid, await readJson(req)) }));
route("DELETE", "/api/admin/categorias/:id/secciones/:sid", "admin", ({ params }) => (catalogo.deleteSubcategory(params.id, params.sid), { ok: true }));

/* ---------- Administración: cuentas ---------- */
const result = (r) => {
  if (!r.ok) throw httpError(400, r.message);
  return { message: r.message, user: r.user ? cuentas.publicUser(r.user) : undefined };
};
route("GET", "/api/admin/usuarios", "admin", () => ({ users: cuentas.users.data.map((u) => cuentas.publicUser(u)) }));
route("POST", "/api/admin/usuarios", "admin", async ({ req, user }) => result(cuentas.create(await readJson(req), user.username)));
route("PUT", "/api/admin/usuarios/:id", "admin", async ({ req, user, params }) => result(cuentas.update(params.id, await readJson(req), user)));
route("DELETE", "/api/admin/usuarios/:id", "admin", ({ user, params }) => result(cuentas.remove(params.id, user)));
route("POST", "/api/admin/usuarios/:id/contrasena", "admin", async ({ req, params }) => result(cuentas.setPassword(params.id, (await readJson(req)).password)));

/** Invitar: crea el invitado, genera sus credenciales y su enlace, y envía el correo si se puede. */
route("POST", "/api/admin/invitados", "admin", async ({ req, user }) => {
  const body = await readJson(req);
  const r = cuentas.inviteGuest({ email: body.email, displayName: body.name, days: body.days }, user.username);
  if (!r.ok) throw httpError(400, r.message);
  let emailed = false;
  let mailError = null;
  try {
    emailed = await correo.sendGuestInvite({ to: r.user.email, name: r.user.displayName, link: r.link, username: r.user.username, password: r.password, days: r.days });
  } catch (e) {
    mailError = "No se ha podido enviar el correo. Copia el enlace y envíalo tú.";
    console.error("Correo:", e.message);
  }
  return { user: cuentas.publicUser(r.user), link: r.link, username: r.user.username, password: r.password, days: r.days, emailed, mailError };
});

/* ---------- Administración: cursos y pagos ---------- */
route("GET", "/api/admin/cursos", "admin", () => ({ courses: catalogo.listCourses(true) }));
route("POST", "/api/admin/cursos", "admin", async ({ req }) => ({ course: catalogo.saveCourse(await readJson(req)) }));
route("PUT", "/api/admin/cursos/:id", "admin", async ({ req, params }) => ({ course: catalogo.saveCourse(await readJson(req), params.id) }));
route("DELETE", "/api/admin/cursos/:id", "admin", ({ params }) => (catalogo.deleteCourse(params.id), { ok: true }));
route("GET", "/api/admin/pagos", "admin", () => ({ payments: pagos.list() }));

/* ---------- Administración: copias y GitHub ---------- */
route("GET", "/api/admin/exportar", "admin", ({ res }) => {
  const body = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), categories: catalogo.categories, resources: catalogo.resources }, null, 2);
  send(res, 200, body, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="recursos_safa_${new Date().toISOString().slice(0, 10)}.json"` });
});
route("POST", "/api/admin/importar", "admin", async ({ req, user }) => {
  const body = await readJson(req, 15 * 1024 * 1024);
  if (body.restore) {
    catalogo.restore(body);
    return { restored: true, total: catalogo.resources.length };
  }
  return { report: catalogo.importResources(body.resources, user) };
});
route("GET", "/api/admin/github", "admin", () => github.status());
route("POST", "/api/admin/github/sincronizar", "admin", async () => ({ ...(await github.syncNow(catalogo.summary())), status: github.status() }));

/* ======================================================================= */
/* Servidor                                                                  */
/* ======================================================================= */
async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const method = req.method.toUpperCase();

  if (method === "GET" && serveStatic(res, url.pathname)) return;

  const match = routes.find((r) => r.method === method && r.re.test(url.pathname));
  if (!match) {
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "No existe." });
    return messagePage(res, 404, "Página no encontrada", "Esta dirección no existe.");
  }
  const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(url.pathname.match(match.re)[i + 1])]));

  try {
    // Protección CSRF para todo lo que cambia datos (salvo el aviso firmado de Stripe)
    if (method !== "GET" && match.access !== "webhook" && req.headers["x-requested-with"] !== "SAFA") {
      throw httpError(403, "Petición no permitida.");
    }
    const user = cuentas.userFromToken(cookies(req)[COOKIE]);
    if (match.access === "user" || match.access === "admin") {
      if (!user) {
        if (!url.pathname.startsWith("/api/")) return redirect(res, "/");
        throw httpError(401, "Tu sesión ha terminado. Vuelve a entrar.");
      }
      if (match.access === "admin" && !cuentas.can(user, "admin")) throw httpError(403, "Esto es solo para el equipo de administración.");
    }
    const out = await match.handler({ req, res, user, params, query: url.searchParams });
    if (!res.headersSent && out !== undefined) json(res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: status >= 500 ? "Ha habido un problema en el servidor. Prueba otra vez." : e.message, ...(e.extra || {}) });
  }
}

function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: "Error interno." });
    });
  });
}

if (require.main === module) {
  createServer().listen(config.port, () => {
    console.log(`Recursos SAFA en ${config.baseUrl} (puerto ${config.port})`);
    if (cuentas.firstRunPassword) {
      console.log("──────────────────────────────────────────────────────────");
      console.log("Primera vez: se ha creado la cuenta de administración.");
      console.log(`  Usuario: admin   Contraseña: ${cuentas.firstRunPassword}`);
      console.log("Cámbiala al entrar (botón «Mi contraseña»).");
      console.log("──────────────────────────────────────────────────────────");
    }
    console.log(`IA: ${config.ai.enabled ? "activada" : "no configurada (se usan reglas)"} · Correo: ${correo.isConfigured() ? "sí" : "no"} · Stripe: ${pagos.providers().stripe ? "sí" : "no"} · PayPal: ${pagos.providers().paypal ? "sí" : "no"} · GitHub: ${github.isConfigured() ? config.github.repo : "no"}`);
  });
}

module.exports = { createServer, cuentas, catalogo, pagos, github };
