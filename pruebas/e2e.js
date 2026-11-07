/**
 * Prueba de extremo a extremo con un navegador real (Playwright).
 * Ejecutar:  node pruebas/e2e.js  [carpeta-capturas]
 *
 * Recorre los flujos principales: inicio de sesión, búsqueda y filtros,
 * permisos de docente, alta de recurso (clasificado, rechazado, sección
 * nueva y duplicado), edición y borrado. Abre index.html con file://, igual
 * que lo haría un docente.
 */
const { chromium } = require("playwright");
const path = require("node:path");
const assert = require("node:assert/strict");

const INDEX = "file://" + path.join(__dirname, "..", "index.html");
const SHOTS = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  const login = async (u, p) => {
    await page.fill("#login-user", u);
    await page.fill("#login-pass", p);
    await page.click("#login-form button[type=submit]");
  };

  await page.goto(INDEX);
  await shot("01-login");

  // 1. Contraseña incorrecta → mensaje claro
  await login("docente", "mala");
  assert.match(await page.textContent("#login-error"), /no son correctos/);

  // 2. Docente: entra y ve el catálogo
  await login("docente", "Docente2026!");
  await page.waitForSelector("#view-catalog:not([hidden])");
  const total = await page.evaluate(() => window.__eduApp.getCatalog().length);
  assert.ok(total > 300, "catálogo cargado");
  assert.ok(await page.isHidden('.nav-link[data-route="admin"]'), "docente no ve Administrar");
  assert.equal(await page.locator('[data-action="edit"]').count(), 0, "docente no ve Editar");
  await shot("02-catalogo-docente");

  // 3. Búsqueda y filtros (AND)
  await page.fill("#search-input", "sumas");
  await page.click("#search-form button[type=submit]");
  const txt = await page.textContent("#results-count");
  assert.match(txt, /Hemos encontrado \d+/);
  await page.click("#btn-reset-filters");
  await page.selectOption("#filter-area", "Matemáticas");
  await page.selectOption("#filter-grade", "2º Primaria");
  const n = await page.locator(".resource-card").count();
  assert.ok(n > 0, "hay recursos de Matemáticas en 2º");
  await shot("03-filtros");
  await page.click("#btn-reset-filters");

  // 4. Docente intenta entrar en #admin → vuelve al catálogo
  await page.goto(INDEX + "#admin");
  await page.waitForSelector("#view-catalog:not([hidden])");
  assert.ok(await page.isHidden("#view-admin"));

  // 5. Salir y entrar como administración
  await page.click("#btn-logout");
  await login("admin", "Admin2026!");
  await page.waitForSelector("#view-catalog:not([hidden])");
  await page.click('.nav-link[data-route="admin"]');
  await page.waitForSelector("#panel-add:not([hidden])");

  // 6. Recurso educativo que encaja → clasificado y publicado
  await page.fill("#res-name", "Sumas Divertidas");
  await page.fill("#res-url", "https://sumas-divertidas.example.com");
  await page.fill("#res-desc", "Juego para practicar sumas y restas con números hasta el 100 en 2º de primaria.");
  await page.click("#resource-form button[type=submit]");
  await page.waitForSelector(".analysis-success");
  assert.match(await page.textContent("#analysis-panel"), /Matemáticas/);
  await shot("04-clasificado");
  await page.click('[data-analysis="publish"]');
  await page.waitForSelector("#toast:not([hidden])");
  assert.ok(await page.evaluate(() => window.__eduApp.getCatalog().some((r) => r.name === "Sumas Divertidas" && r.subcategory === "Matemáticas")));

  // 7. Recurso sin utilidad educativa → rechazado con motivo
  await page.fill("#res-name", "Zapatillas Baratas");
  await page.fill("#res-url", "https://www.zapatillas-baratas.es");
  await page.fill("#res-desc", "Tienda online con ofertas y descuentos en zapatillas. Envío gratis.");
  await page.click("#resource-form button[type=submit]");
  await page.waitForSelector(".analysis-danger");
  assert.match(await page.textContent("#analysis-panel"), /No tiene utilidad educativa/);
  await shot("05-rechazado");
  await page.click('[data-analysis="discard"]');

  // 8. Recurso educativo sin sección → propuesta de sección nueva
  await page.fill("#res-name", "Flauta Fácil");
  await page.fill("#res-url", "https://flauta-facil.example.com");
  await page.fill("#res-desc", "Aprende a tocar la flauta en el colegio con partituras sencillas para el alumnado.");
  await page.click("#resource-form button[type=submit]");
  await page.waitForSelector(".analysis-info");
  assert.equal(await page.inputValue("#prop-name"), "Música y expresión artística");
  await shot("06-nueva-seccion");
  await page.click('[data-analysis="create-and-publish"]');
  await page.waitForSelector("#toast:not([hidden])");
  assert.ok(await page.evaluate(() => window.__eduApp.getCategories()[0].subcategories.some((s) => s.name === "Música y expresión artística")));

  // 9. Duplicado → tres opciones
  await page.fill("#res-name", "ScratchJr");
  await page.fill("#res-url", "https://www.scratchjr.org/");
  await page.fill("#res-desc", "Programación con bloques para infantil y primaria.");
  await page.click("#resource-form button[type=submit]");
  await page.waitForSelector(".analysis-warning");
  assert.equal(await page.locator('[data-analysis="variant"], [data-analysis="force"], [data-analysis="discard"]').count(), 3);
  await page.click('[data-analysis="discard"]');

  // 10. Formulario vacío → errores en los campos
  await page.click("#resource-form button[type=submit]");
  assert.equal(await page.getAttribute("#res-name", "aria-invalid"), "true");

  // 11. Pestañas de categorías, cuentas y copias se pintan
  await page.click("#tab-categories");
  assert.ok((await page.locator(".sub-admin").count()) > 10);
  await shot("07-categorias");
  await page.click("#tab-users");
  assert.ok((await page.locator("#users-body tr").count()) >= 2);

  // 12. Editar y borrar desde el catálogo
  await page.click('.nav-link[data-route="catalogo"]');
  await page.fill("#search-input", "Sumas Divertidas");
  await page.click("#search-form button[type=submit]");
  await page.click('.resource-card [data-action="delete"]');
  await page.click("#dialog-confirm");
  assert.ok(!(await page.evaluate(() => window.__eduApp.getCatalog().some((r) => r.name === "Sumas Divertidas"))));

  // 13. Tableta (768 px) y alto contraste
  await page.click("#btn-reset-filters");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.click("header .js-toggle-contrast");
  await shot("08-tableta-contraste");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, "sin desplazamiento horizontal en tableta");

  assert.deepEqual(errors, [], "sin errores de JavaScript");
  await browser.close();
  console.log("✅ Prueba de extremo a extremo superada");
})().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
