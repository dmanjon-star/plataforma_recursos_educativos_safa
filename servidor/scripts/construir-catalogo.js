/**
 * construir-catalogo.js — Crea data/catalogo.json a partir de las semillas.
 *
 *   npm run catalogo            (no hace nada si el catálogo ya existe)
 *   npm run catalogo -- --forzar (lo vuelve a crear desde cero)
 *
 * Une los 12 recursos del documento de especificaciones con los del Excel,
 * quita los repetidos y marca una pequeña selección para los invitados
 * (los 2 recursos más recomendados de cada sección educativa).
 */
const fs = require("node:fs");
const path = require("node:path");
const { U, INITIAL_CATEGORIES } = require("../compartido");
const config = require("../config");

function buildCatalog() {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(config.ROOT, "data", "semilla", f), "utf8"));
  const spec = read("recursos-documento.json");
  const excel = read("excel.json");
  const resources = spec.slice();
  for (const item of excel) {
    const repeated = spec.some(
      (s) =>
        U.normalizeUrl(s.url) === U.normalizeUrl(item.url) ||
        (U.getDomain(s.url) === U.getDomain(item.url) && U.stringSimilarityRatio(s.name, item.name) >= 0.7)
    );
    if (!repeated) resources.push(item);
  }
  const now = new Date().toISOString();
  const out = resources.map((r) => ({ createdAt: now, createdBy: "semilla", linkType: "Página web", tags: [], guestSample: false, ...r }));

  // Selección para invitados: 2 recursos «Alta» por sección de la categoría educativa
  const edu = INITIAL_CATEGORIES.find((c) => c.id === "cat_edu");
  for (const sub of edu.subcategories) {
    out
      .filter((r) => r.subcategory === sub.name && r.interest === "Alta")
      .slice(0, 2)
      .forEach((r) => (r.guestSample = true));
  }
  return { version: 1, updatedAt: now, categories: INITIAL_CATEGORIES, resources: out };
}

if (require.main === module) {
  const force = process.argv.includes("--forzar");
  if (fs.existsSync(config.catalogFile) && !force) {
    console.log(`Ya existe ${config.catalogFile}. Usa --forzar para crearlo de nuevo.`);
  } else {
    const cat = buildCatalog();
    fs.mkdirSync(path.dirname(config.catalogFile), { recursive: true });
    fs.writeFileSync(config.catalogFile, JSON.stringify(cat, null, 1) + "\n");
    console.log(`Catálogo creado: ${cat.resources.length} recursos, ${cat.resources.filter((r) => r.guestSample).length} visibles para invitados.`);
  }
}

module.exports = { buildCatalog };
