/**
 * Prueba de extremo a extremo con un navegador real (Playwright).
 * Ejecutar:  npm run e2e  [-- carpeta-capturas]
 *
 * Arranca el servidor con datos temporales, una web de ejemplo para analizar
 * y un Stripe y un PayPal SIMULADOS (no se cobra nada), y recorre:
 *  entrar, permisos de cada perfil, invitar (enlace), añadir recursos con
 *  solo el enlace (clasificado, rechazado, sección nueva, duplicado),
 *  crear cuentas VIP y de pago, pagar con Stripe y con PayPal y ver los cursos.
 */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const SHOTS = process.argv[2];
const ROOT = path.join(__dirname, "..");
const PORT = 3200 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;

/* ---------- Web de ejemplo que se va a analizar (127.0.0.2) ---------- */
const PAGES = {
  "/tablas": `<html lang="es"><head><title>Tablas Mágicas | Inicio</title><meta name="description" content="Juegos gratis para practicar las tablas de multiplicar y el cálculo mental en primaria."></head><body><h1>Tablas de multiplicar</h1><p>Actividades para el aula de 3º de primaria.</p></body></html>`,
  "/zapatos": `<html lang="es"><head><title>Zapatos Baratos</title><meta name="description" content="Tienda online: ofertas, descuentos y envío gratis en zapatos."></head><body><h1>Comprar zapatos</h1></body></html>`,
  "/flauta": `<html lang="es"><head><title>Flauta Fácil</title><meta name="description" content="Aprende a tocar la flauta en el colegio con partituras sencillas para el alumnado."></head><body><h1>Flauta para niños</h1></body></html>`
};

/* ---------- Stripe y PayPal simulados (127.0.0.1) ---------- */
const sessions = {};
const orders = {};
function mockPayments(req, res, body) {
  const send = (obj) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
    const f = new URLSearchParams(body);
    const id = "cs_test_" + Object.keys(sessions).length;
    sessions[id] = { id, payment_status: "paid", metadata: { userId: f.get("metadata[userId]") }, amount_total: Number(f.get("line_items[0][price_data][unit_amount]")), currency: f.get("line_items[0][price_data][currency]") };
    // Simula que la persona paga en Stripe y vuelve a la plataforma
    return send({ id, url: f.get("success_url").replace("{CHECKOUT_SESSION_ID}", id) });
  }
  if (req.method === "GET" && req.url.startsWith("/v1/checkout/sessions/")) return send(sessions[req.url.split("/").pop()]);
  if (req.url === "/v1/oauth2/token") return send({ access_token: "tok" });
  if (req.method === "POST" && req.url === "/v2/checkout/orders") {
    const o = JSON.parse(body);
    const id = "ORDER" + (Object.keys(orders).length + 100);
    orders[id] = o.purchase_units[0];
    return send({ id, links: [{ rel: "approve", href: `${o.application_context.return_url}?token=${id}` }] });
  }
  const m = req.url.match(/^\/v2\/checkout\/orders\/(\w+)\/capture$/);
  if (m) {
    const u = orders[m[1]];
    return send({ status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP" + m[1], status: "COMPLETED", custom_id: u.custom_id, amount: u.amount }] } }] });
  }
  res.writeHead(404);
  res.end();
}

function listen(server, host) {
  return new Promise((r) => server.listen(0, host, () => r(server.address().port)));
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "safa-e2e-"));
  fs.copyFileSync(path.join(ROOT, "data", "catalogo.json"), path.join(tmp, "catalogo.json"));
  const pageServer = http.createServer((req, res) => {
    res.writeHead(PAGES[req.url] ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGES[req.url] || "no");
  });
  const pagePort = await listen(pageServer, "127.0.0.2");
  // Segundo «sitio web»: la regla «mismo sitio» no debe mezclar las páginas de prueba
  const pageServer2 = http.createServer(pageServer.listeners("request")[0]);
  const pagePort2 = await listen(pageServer2, "127.0.0.3");
  const payServer = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c)).on("end", () => mockPayments(req, res, b));
  });
  const payPort = await listen(payServer, "127.0.0.1");

  const server = spawn(process.execPath, [path.join(ROOT, "servidor", "servidor.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      BASE_URL: BASE,
      DATA_DIR: path.join(tmp, "privado"),
      CATALOG_FILE: path.join(tmp, "catalogo.json"),
      FILES_DIR: path.join(tmp, "archivos"),
      ADMIN_PASSWORD: "Admin2026!",
      DEMO: "1",
      ALLOW_PRIVATE_FETCH: "1",
      ANTHROPIC_API_KEY: "",
      STRIPE_SECRET_KEY: "sk_test_simulado",
      STRIPE_API_BASE: `http://127.0.0.1:${payPort}`,
      PAYPAL_CLIENT_ID: "id",
      PAYPAL_CLIENT_SECRET: "secreto",
      PAYPAL_API_BASE: `http://127.0.0.1:${payPort}`,
      GITHUB_TOKEN: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  for (let i = 0; i < 50 && !serverLog.includes("Recursos SAFA en"); i++) await new Promise((r) => setTimeout(r, 100));

  const browser = await chromium.launch();
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    return p;
  };
  let page = await newPage();
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const login = async (u, p) => {
    await page.fill("#login-user", u);
    await page.fill("#login-pass", p);
    await page.click("#login-form button[type=submit]");
  };
  const logout = async () => {
    await page.click("#btn-logout");
    await page.waitForSelector("#view-login:not([hidden])");
  };
  const catalogSize = () => page.evaluate(() => window.__eduApp.getCatalog().length);
  /** Pulsa Publicar y espera a que termine; falla si el servidor no lo acepta. */
  const publish = async () => {
    await page.click("#btn-publish");
    await page.waitForFunction(() => document.getElementById("resource-form").hidden || !document.getElementById("publish-error").hidden);
    assert.ok(await page.isHidden("#publish-error"), await page.textContent("#publish-error"));
  };
  const analyze = async (url) => {
    await page.fill("#an-url", url);
    await page.click("#btn-analyze");
    await page.waitForSelector("#analysis-panel:not([hidden])");
  };

  try {
    await page.goto(BASE);
    await page.waitForSelector("#view-login:not([hidden])");
    await shot("01-entrar");

    // 1. Contraseña incorrecta
    await login("docente", "mala");
    await page.waitForSelector("#login-error:not([hidden])");
    assert.match(await page.textContent("#login-error"), /no son correctos/);

    // 2. Docente: todos los recursos, sin administración ni cursos
    await login("docente", "Docente2026!");
    await page.waitForSelector("#view-catalog:not([hidden])");
    assert.ok((await catalogSize()) > 300);
    assert.ok(await page.isHidden('.nav-link[data-route="admin"]'));
    await page.click('.nav-link[data-route="cursos"]');
    await page.waitForSelector(".course-card");
    assert.match(await page.textContent("#courses-access"), /plan de pago/);
    assert.equal(await page.locator(".lesson-list").count(), 0, "el docente no ve las lecciones");
    // La API tampoco deja entrar en administración
    const forbidden = await page.evaluate(() => fetch("/api/admin/usuarios").then((r) => r.status));
    assert.equal(forbidden, 403);
    await logout();

    // 3. Administración: invitar a una persona
    await login("admin", "Admin2026!");
    await page.waitForSelector("#view-catalog:not([hidden])");
    await page.click('.nav-link[data-route="admin"]');
    await page.click("#tab-users");
    await page.fill("#inv-name", "Lucía");
    await page.fill("#inv-email", "lucia@example.com");
    await page.click("#invite-form button[type=submit]");
    await page.waitForSelector("#invite-result:not([hidden])");
    const link = await page.inputValue("#inv-link");
    assert.match(link, /\/acceso\//);
    await shot("02-invitacion");

    // 4. Añadir con solo el enlace: se clasifica y etiqueta sola
    await page.click("#tab-add");
    await analyze(`http://127.0.0.2:${pagePort}/tablas`);
    await page.waitForSelector(".analysis-success");
    assert.match(await page.textContent("#analysis-panel"), /Matemáticas/);
    assert.equal(await page.inputValue("#res-name"), "Tablas Mágicas");
    assert.ok((await page.inputValue("#res-tags")).length > 0, "tiene etiquetas");
    assert.ok(await page.isChecked('#res-grades input[value="3º Primaria"]'), "curso detectado");
    await shot("03-ficha-automatica");
    await publish();
    assert.ok(await page.evaluate(() => window.__eduApp.getCatalog().some((r) => r.name === "Tablas Mágicas" && r.subcategory === "Matemáticas" && r.tags.length)));

    // 5. Sin utilidad educativa: no se publica y se explica el motivo
    await analyze(`http://127.0.0.2:${pagePort}/zapatos`);
    await page.waitForSelector(".analysis-danger");
    assert.match(await page.textContent("#analysis-panel"), /No tiene utilidad educativa/);
    assert.ok(await page.isHidden("#resource-form"));
    await shot("04-rechazado");
    await page.click('[data-analysis="discard"]');

    // 6. Educativo pero sin sección: propone una nueva y la crea al publicar
    await analyze(`http://127.0.0.3:${pagePort2}/flauta`);
    await page.waitForSelector(".analysis-info");
    assert.equal(await page.inputValue("#new-sec-name"), "Música y expresión artística");
    await shot("05-seccion-nueva");
    await publish();
    assert.ok(await page.evaluate(() => window.__eduApp.getCategories()[0].subcategories.some((s) => s.name === "Música y expresión artística")));

    // 7. Duplicado: tres opciones
    await analyze("https://www.scratchjr.org/");
    // scratchjr.org puede no responder en la red de pruebas: se escribe la descripción
    if (await page.isVisible('[data-analysis="write"]')) {
      await page.click('[data-analysis="write"]');
      await page.fill("#an-name", "ScratchJr");
      await page.fill("#an-desc", "Programación con bloques para infantil y primaria.");
      await page.click("#btn-analyze");
      await page.waitForSelector(".analysis-warning >> text=ya exista");
    }
    assert.equal(await page.locator('[data-analysis="variant"], [data-analysis="force"], [data-analysis="discard"]').count(), 3);
    await page.click('[data-analysis="discard"]');

    // 8. Crear cuentas VIP y de pago
    await page.click("#tab-users");
    const createUser = async (name, user, role) => {
      await page.fill("#usr-name", name);
      await page.fill("#usr-username", user);
      await page.fill("#usr-pass", "Clave2026!");
      await page.selectOption("#usr-role", role);
      await page.click("#user-form button[type=submit]");
      await page.waitForSelector("#user-form-msg.alert-success");
    };
    await createUser("Persona VIP", "ana.vip", "vip");
    await createUser("Persona de pago", "luis.pago", "pago");
    await page.waitForSelector("#users-body >> text=luis.pago");
    await shot("06-cuentas");
    await logout();

    // 9. Invitado: entra con el enlace y ve solo la selección
    await page.goto(link);
    await page.waitForSelector("#view-catalog:not([hidden])");
    await page.waitForSelector("#guest-banner:not([hidden])");
    const guestCount = await catalogSize();
    assert.ok(guestCount > 0 && guestCount < 50, `invitado ve ${guestCount}`);
    assert.match(await page.textContent("#guest-banner"), /Estás probando/);
    await shot("07-invitado");
    await logout();

    // 10. VIP: todos los recursos, cursos cerrados
    await login("ana.vip", "Clave2026!");
    await page.waitForSelector("#view-catalog:not([hidden])");
    assert.ok((await catalogSize()) > 300);
    await logout();

    // 11. De pago: paga con Stripe (simulado) y ve los cursos
    await login("luis.pago", "Clave2026!");
    await page.waitForSelector("#view-catalog:not([hidden])");
    await page.click('.nav-link[data-route="cursos"]');
    await page.waitForSelector('[data-pay="stripe"]');
    await shot("08-pagar");
    await page.click('[data-pay="stripe"]');
    await page.waitForSelector("#payment-result.alert-success");
    await page.waitForSelector(".lesson-list");
    await shot("09-cursos-pagados");
    await logout();

    // 12. De pago (demo): paga con PayPal (simulado)
    await login("pago", "Pago2026!");
    await page.waitForSelector("#view-catalog:not([hidden])");
    await page.click('.nav-link[data-route="cursos"]');
    await page.click('[data-pay="paypal"]');
    await page.waitForSelector(".lesson-list");
    await logout();

    // 13. Pagos registrados
    await login("admin", "Admin2026!");
    await page.waitForSelector("#view-catalog:not([hidden])");
    await page.click('.nav-link[data-route="admin"]');
    await page.click("#tab-payments");
    await page.waitForSelector("#payments-body >> text=luis.pago");
    assert.equal(await page.locator("#payments-body tr").count(), 2);

    // 14. Tableta y alto contraste
    await page.click('.nav-link[data-route="catalogo"]');
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.click("header .js-toggle-contrast");
    await shot("10-tableta-contraste");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "sin desplazamiento horizontal");

    assert.deepEqual(errors, [], "sin errores de JavaScript");
    console.log("✅ Prueba de extremo a extremo superada");
  } catch (e) {
    console.error("❌", e);
    console.error(serverLog.slice(-2000));
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
    pageServer.close();
    pageServer2.close();
    payServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
