/**
 * Pruebas automáticas de la lógica (sin navegador).
 * Ejecutar:  node --test pruebas/
 *
 * Carga los mismos archivos que index.html dentro de un contexto aislado
 * (vm) para comprobar la validación educativa, la clasificación, la
 * propuesta de secciones nuevas, los duplicados y el cifrado.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function loadPlatform() {
  const ctx = { console, TextEncoder, URL };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["data.js", "utils.js", "classifier.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx, { filename: f });
  }
  return ctx;
}

const W = loadPlatform();
const C = W.EduClassifier;
const U = W.EduUtils;
const categories = W.INITIAL_CATEGORIES;
// Catálogo inicial (el mismo que usa el servidor)
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "catalogo.json"), "utf8")).resources;

const base = { areas: [], grades: [] };
const analyze = (r) => C.analyze({ ...base, ...r }, { catalog, categories });

test("SHA-256 coincide con el valor estándar", () => {
  assert.equal(U.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(U.sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("normalizeUrl quita protocolo, www, parámetros y barra final", () => {
  assert.equal(U.normalizeUrl("https://www.Ejemplo.com/ruta/?utm_source=x"), "ejemplo.com/ruta");
});

test("escapeHtml y safeHref impiden inyectar código", () => {
  assert.equal(U.escapeHtml('<img src=x onerror="a">'), "&lt;img src=x onerror=&quot;a&quot;&gt;");
  assert.equal(U.safeHref("javascript:alert(1)"), "#");
  assert.equal(U.safeHref("https://arasaac.org"), "https://arasaac.org");
});

test("todos los recursos del catálogo inicial tienen utilidad educativa", () => {
  const rejected = catalog.filter((r) => !C.validateEducational(r, categories).ok).map((r) => r.name);
  assert.equal(rejected.length, 0, `Rechazados: ${rejected.join(", ")}`);
});

test("faltan datos → estado «invalid» con mensajes claros", () => {
  const r = analyze({ name: "", url: "hola", description: "corta" });
  assert.equal(r.status, "invalid");
  assert.equal(r.errors.length, 3);
});

test("una tienda online se rechaza por no tener utilidad educativa", () => {
  const r = analyze({
    name: "Zapatillas Baratas",
    url: "https://www.zapatillas-baratas.es",
    description: "Tienda online con ofertas y descuentos en zapatillas. Envío gratis y cupones."
  });
  assert.equal(r.status, "rejected");
  assert.equal(r.validation.code, "NOT_EDUCATIONAL");
  assert.match(r.validation.message, /compras y ofertas/);
});

test("una web de vuelos se rechaza aunque diga «clase»… si domina el viaje", () => {
  const r = analyze({
    name: "Vuelos Low Cost",
    url: "https://vuelos.example.com",
    description: "Reserva vuelos y hoteles al mejor precio. Billetes en clase turista."
  });
  assert.equal(r.status, "rejected");
});

test("contenido de riesgo (piratería) se rechaza siempre", () => {
  const r = analyze({
    name: "Libros gratis",
    url: "https://descargas.example.com",
    description: "Descarga libros de texto de primaria con crack y torrent para el aula."
  });
  assert.equal(r.status, "rejected");
  assert.equal(r.validation.code, "RISK");
});

test("enlace temporal (inicio de sesión) se rechaza", () => {
  const r = analyze({
    name: "Plataforma de fichas",
    url: "https://fichas.example.com/login",
    description: "Fichas de matemáticas para practicar sumas en primaria."
  });
  assert.equal(r.validation.code, "TEMPORARY");
});

test("enlace con datos personales se rechaza, pero «/editor» no", () => {
  const personal = analyze({
    name: "Mi presentación",
    url: "https://docs.example.com/presentation/abc/edit",
    description: "Presentación para explicar el ciclo del agua en clase de ciencias."
  });
  assert.equal(personal.validation.code, "PERSONAL");
  const editor = analyze({
    name: "Editor de cuentos",
    url: "https://cuentos.example.com/editor",
    description: "Crea cuentos ilustrados con tu alumnado de primaria."
  });
  assert.notEqual(editor.status, "rejected");
});

test("un recurso de matemáticas se coloca en «Matemáticas»", () => {
  const r = analyze({
    name: "Sumas Divertidas",
    url: "https://sumas-divertidas.example.com",
    description: "Juego para practicar sumas y restas con números hasta el 100 en 2º de primaria."
  });
  assert.equal(r.status, "classified");
  assert.equal(r.classification.best.subcategoryName, "Matemáticas");
});

test("un recurso de mapas se coloca en «Historia, geografía y mapas»", () => {
  const r = analyze({
    name: "Atlas de ríos",
    url: "https://rios.example.com",
    description: "Mapa interactivo para aprender los ríos y el relieve de España en primaria."
  });
  assert.equal(r.classification.best.subcategoryName, "Historia, geografía y mapas");
});

test("recurso educativo sin sección → propone una nueva con nombre y criterios", () => {
  const r = analyze({
    name: "Flauta Fácil",
    url: "https://flauta-facil.example.com",
    description: "Aprende a tocar la flauta en el colegio con partituras sencillas para el alumnado."
  });
  assert.equal(r.status, "new-category");
  assert.equal(r.proposal.name, "Música y expresión artística");
  assert.ok(r.proposal.keywords.includes("flauta"));
});

test("propuesta por palabras frecuentes cuando no hay tema conocido", () => {
  const r = analyze({
    name: "Ajedrez escolar",
    url: "https://ajedrez.example.com",
    description: "Ajedrez para el colegio: aperturas, jaque y estrategia para el alumnado."
  });
  assert.equal(r.status, "new-category");
  assert.match(r.proposal.name, /Ajedrez/);
  assert.ok(r.proposal.keywords.length > 0);
});

test("duplicado por URL canónica", () => {
  const r = analyze({
    name: "Scratch Junior",
    url: "http://scratchjr.org/?utm_source=boletin",
    description: "Programación con bloques para infantil y primaria."
  });
  assert.equal(r.status, "duplicate");
  assert.equal(r.duplicate.type, "EXACT_URL");
});

test("al editar, el propio recurso no cuenta como duplicado", () => {
  const original = catalog.find((x) => x.id === "rec_001");
  const r = C.analyze({ ...original }, { catalog, categories, ignoreId: "rec_001" });
  assert.notEqual(r.status, "duplicate");
});

test("applyDefaults rellena materia, curso y etapa desde la sección", () => {
  const sub = categories[0].subcategories.find((s) => s.name === "Matemáticas");
  const out = C.applyDefaults({ name: "x", areas: [], grades: [] }, sub);
  assert.deepEqual([...out.areas], ["Matemáticas"]);
  assert.ok(out.grades.includes("2º Primaria"));
  assert.deepEqual([...out.stages], ["Primaria"]);
});
