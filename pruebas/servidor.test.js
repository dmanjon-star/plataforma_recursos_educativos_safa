/**
 * Pruebas del servidor (sin navegador).
 * Ejecutar:  npm test
 *
 * Se usa una carpeta de datos temporal para no tocar los datos reales.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "safa-test-"));
fs.copyFileSync(path.join(__dirname, "..", "data", "catalogo.json"), path.join(TMP, "catalogo.json"));
Object.assign(process.env, {
  DATA_DIR: path.join(TMP, "privado"),
  CATALOG_FILE: path.join(TMP, "catalogo.json"),
  FILES_DIR: path.join(TMP, "archivos"),
  ADMIN_PASSWORD: "Admin2026!",
  DEMO: "1",
  ALLOW_PRIVATE_FETCH: "",
  STRIPE_WEBHOOK_SECRET: "whsec_prueba",
  ANTHROPIC_API_KEY: ""
});

const { extractHtml, isPrivateIp, safeFetch } = require("../servidor/extractor");
const { detectGrades, detectCost, buildRecord } = require("../servidor/etiquetador");
const { Cuentas } = require("../servidor/cuentas");
const { Pagos } = require("../servidor/pagos");
const { Catalogo, sanitizeRecord } = require("../servidor/catalogo");
const { SyncGitHub } = require("../servidor/github");
const config = require("../servidor/config");

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

/* ------------------------------ Lectura de páginas ------------------------------ */
test("extractHtml lee título, descripción, idioma, títulos y entidades", () => {
  const html = `<!doctype html><html lang="es-ES"><head><title>Sumas f&aacute;ciles | Mates</title>
    <meta content="Juegos para practicar sumas en 1&ordm; de primaria" name="description">
    <meta property="og:site_name" content="Mates Divertidas"><script>var x = "<h1>no</h1>";</script></head>
    <body><h1>Aprende a sumar</h1><p>Texto del aula.</p></body></html>`;
  const d = extractHtml(html);
  assert.equal(d.title, "Sumas fáciles | Mates");
  assert.equal(d.description, "Juegos para practicar sumas en 1º de primaria");
  assert.equal(d.siteName, "Mates Divertidas");
  assert.equal(d.lang, "es-es");
  assert.deepEqual([...d.headings], ["Aprende a sumar"]);
  assert.ok(!d.text.includes("no</h1>"));
});

test("isPrivateIp detecta redes internas", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "2a00:1450::1"]) assert.ok(!isPrivateIp(ip), ip);
});

test("safeFetch no abre direcciones de la red interna", async () => {
  await assert.rejects(() => safeFetch("http://localhost/"), (e) => e.code === "PRIVATE");
  await assert.rejects(() => safeFetch("http://169.254.169.254/latest/meta-data"), (e) => e.code === "PRIVATE");
  await assert.rejects(() => safeFetch("file:///etc/passwd"), (e) => e.code === "URL");
});

/* ------------------------------ Etiquetas ------------------------------ */
test("etiquetador: cursos, precio y ficha", () => {
  assert.deepEqual([...detectGrades("actividades para 2 de primaria")], ["2º Primaria"]);
  assert.ok(detectGrades("juegos para infantil y primaria").includes("Infantil 4 años"));
  assert.equal(detectCost("es gratis y tiene un plan premium"), "Freemium");
  assert.equal(detectCost("totalmente gratuito"), "Gratuito");
  const rec = buildRecord("https://mates.example.com", { kind: "html", data: extractHtml('<html lang="es"><title>Mates Divertidas - Inicio</title><meta name="description" content="Juegos gratis de matemáticas para primaria."></html>') });
  assert.equal(rec.name, "Mates Divertidas");
  assert.ok(rec.areas.includes("Matemáticas"));
  assert.equal(rec.language, "Español");
  assert.equal(rec.cost, "Gratuito");
});

/* ------------------------------ Cuentas y permisos ------------------------------ */
const cuentas = new Cuentas();
const admin = cuentas.findByUsername("admin");

test("permisos de cada perfil", () => {
  const vip = cuentas.findByUsername("vip");
  const pago = cuentas.findByUsername("pago");
  assert.ok(cuentas.can(admin, "admin"));
  assert.ok(cuentas.can(vip, "resource:all") && !cuentas.can(vip, "course:view") && !cuentas.can(vip, "admin"));
  assert.ok(cuentas.can(pago, "resource:all") && cuentas.can(pago, "course:buy") && !cuentas.can(pago, "course:view"));
  cuentas.grantPaidAccess(pago.id, 12);
  assert.ok(cuentas.can(pago, "course:view"));
  const g = cuentas.inviteGuest({ email: "invitada@example.com", displayName: "Invitada" }, "admin");
  assert.ok(g.ok);
  assert.ok(cuentas.can(g.user, "resource:sample") && !cuentas.can(g.user, "resource:all"));
});

test("invitado: enlace válido, credenciales generadas y caducidad", () => {
  const g = cuentas.inviteGuest({ email: "otro@example.com", displayName: "Otro", days: 3 }, "admin");
  const token = g.link.split("/acceso/")[1];
  assert.equal(cuentas.userFromGuestLink(token).user.id, g.user.id);
  assert.ok(cuentas.login(g.user.username, g.password).ok);
  assert.match(g.password, /\d/);
  // Un enlace nuevo invalida el anterior
  const g2 = cuentas.inviteGuest({ email: "otro@example.com" }, "admin");
  assert.ok(cuentas.userFromGuestLink(token).error);
  // Caducado: no entra
  g2.user.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.ok(cuentas.userFromGuestLink(g2.link.split("/acceso/")[1]).error);
  assert.match(cuentas.login(g2.user.username, g2.password).message, /terminado/);
});

test("contraseñas: se guardan cifradas y se exige un mínimo", () => {
  const r = cuentas.create({ username: "maria.lopez", displayName: "María", role: "vip", password: "corta" }, "admin");
  assert.equal(r.ok, false);
  const ok = cuentas.create({ username: "maria.lopez", displayName: "María", role: "vip", password: "Segura2026" }, "admin");
  assert.ok(ok.ok);
  const raw = fs.readFileSync(path.join(config.privateDir, "usuarios.json"), "utf8");
  assert.ok(!raw.includes("Segura2026"));
  assert.equal(cuentas.create({ username: "x1x", role: "invitado", password: "Segura2026" }, "admin").ok, false);
});

test("sesiones: se guarda solo el resumen del código", () => {
  const s = cuentas.createSession(admin);
  assert.equal(cuentas.userFromToken(s.token).id, admin.id);
  const raw = fs.readFileSync(path.join(config.privateDir, "sesiones.json"), "utf8");
  assert.ok(!raw.includes(s.token));
  cuentas.destroySession(s.token);
  assert.equal(cuentas.userFromToken(s.token), null);
});

/* ------------------------------ Pagos ------------------------------ */
test("Stripe: firma del webhook", () => {
  const pagos = new Pagos(cuentas);
  const body = JSON.stringify({ type: "checkout.session.completed" });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", "whsec_prueba").update(`${t}.${body}`).digest("hex");
  assert.ok(pagos.verifyStripeSignature(body, `t=${t},v1=${sig}`));
  assert.ok(!pagos.verifyStripeSignature(body + " ", `t=${t},v1=${sig}`));
  assert.ok(!pagos.verifyStripeSignature(body, `t=${t - 1000},v1=${crypto.createHmac("sha256", "whsec_prueba").update(`${t - 1000}.${body}`).digest("hex")}`));
  assert.ok(!pagos.verifyStripeSignature(body, `t=${t},v1=${sig}`, "otro_secreto"));
});

test("Stripe: solo se da acceso si está pagado, es del usuario y el importe coincide", () => {
  const pagos = new Pagos(cuentas);
  const u = cuentas.create({ username: "pago2", displayName: "Pago 2", role: "pago", password: "Pago2026x" }, "admin").user;
  const cents = Math.round(config.payments.price * 100);
  const s = { id: "cs_test_1", payment_status: "paid", metadata: { userId: u.id }, amount_total: cents, currency: config.payments.currency };
  assert.equal(pagos._checkStripeSession({ ...s, payment_status: "unpaid" }, u.id).ok, false);
  assert.equal(pagos._checkStripeSession({ ...s, amount_total: 1 }, u.id).ok, false);
  assert.equal(pagos._checkStripeSession(s, "otro").ok, false);
  assert.ok(pagos._checkStripeSession(s, u.id).ok);
  assert.ok(pagos._checkStripeSession(s, u.id).already, "el mismo pago no se cuenta dos veces");
  assert.ok(cuentas.hasPaid(cuentas.findById(u.id)));
});

/* ------------------------------ Catálogo ------------------------------ */
const catalogo = new Catalogo(new SyncGitHub());

test("sanitizeRecord descarta campos desconocidos y valores no permitidos", () => {
  const r = sanitizeRecord({ name: "X", areas: ["Matemáticas", "Inventada"], role: "admin", cost: "Gratis total", dokLevel: 9 });
  assert.deepEqual([...r.areas], ["Matemáticas"]);
  assert.equal(r.role, undefined);
  assert.equal(r.cost, "Por confirmar");
  assert.equal(r.dokLevel, 0);
});

test("publicar: rechaza lo no educativo, avisa de duplicados y crea secciones", () => {
  const sec = { category: "Educación y recursos docentes", subcategory: "Matemáticas" };
  assert.throws(() => catalogo.saveResource({ record: { name: "Zapatillas", url: "https://zapas.example.com", description: "Tienda online con ofertas y descuentos en zapatillas." }, section: sec }, admin), (e) => e.status === 422);
  assert.throws(() => catalogo.saveResource({ record: { name: "ScratchJr", url: "https://www.scratchjr.org", description: "Programación con bloques para infantil y primaria." }, section: sec }, admin), (e) => e.status === 409);
  const ok = catalogo.saveResource({ record: { name: "Sumas Locas", url: "https://sumas-locas.example.com", description: "Juego para practicar sumas en 2º de primaria." }, section: sec }, admin);
  assert.equal(ok.subcategory, "Matemáticas");
  assert.ok(ok.grades.length > 0, "se completan los cursos con los de la sección");
  const nuevo = catalogo.saveResource({
    record: { name: "Flauta Fácil", url: "https://flauta.example.com", description: "Aprende a tocar la flauta en el colegio." },
    newSection: { categoryId: "cat_edu", name: "Música y expresión artística", keywords: ["musica", "flauta"] }
  }, admin);
  assert.equal(nuevo.subcategory, "Música y expresión artística");
  assert.ok(catalogo.findSub("Educación y recursos docentes", "Música y expresión artística"));
});

test("invitados solo reciben la selección de prueba", () => {
  const all = catalogo.visibleFor(true).length;
  const sample = catalogo.visibleFor(false);
  assert.ok(sample.length > 0 && sample.length < all);
  assert.ok(sample.every((r) => r.guestSample));
});

/* ------------------------------ Análisis desde el enlace ------------------------------ */
test("analyzeUrl: lee una página, la clasifica y pone etiquetas", async () => {
  process.env.ALLOW_PRIVATE_FETCH = "1";
  config.allowPrivateFetch = true;
  const { analyzeUrl } = require("../servidor/autoclasificador");
  const pages = {
    "/mates": `<html lang="es"><head><title>Tablas Mágicas | Inicio</title><meta name="description" content="Juegos gratis para practicar las tablas de multiplicar y el cálculo mental en primaria."></head><body><h1>Tablas de multiplicar</h1><p>Actividades para el aula de 3º de primaria.</p></body></html>`,
    "/tienda": `<html lang="es"><head><title>Zapatos Baratos</title><meta name="description" content="Tienda online: ofertas, descuentos y envío gratis en zapatos."></head><body><h1>Comprar zapatos</h1></body></html>`
  };
  const server = http.createServer((req, res) => {
    res.writeHead(pages[req.url] ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pages[req.url] || "no");
  });
  await new Promise((r) => server.listen(0, "127.0.0.2", r));
  const base = `http://127.0.0.2:${server.address().port}`;
  try {
    const ctx = { catalog: catalogo.resources, categories: catalogo.categories };
    const ok = await analyzeUrl({ url: `${base}/mates` }, ctx);
    assert.equal(ok.status, "classified");
    assert.equal(ok.classification.best.subcategoryName, "Matemáticas");
    assert.equal(ok.record.name, "Tablas Mágicas");
    assert.ok(ok.record.grades.includes("3º Primaria"));
    assert.ok(ok.record.tags.length > 0);
    const bad = await analyzeUrl({ url: `${base}/tienda` }, ctx);
    assert.equal(bad.status, "rejected");
    const missing = await analyzeUrl({ url: `${base}/no-existe` }, ctx);
    assert.equal(missing.status, "unreadable");
  } finally {
    server.close();
    config.allowPrivateFetch = false;
  }
});
