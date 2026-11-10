/**
 * autoclasificador.js — Del enlace a la ficha completa, sin escribir nada más.
 *
 * Pasos:
 *  1. Comprueba la dirección con las reglas de seguridad (riesgo, enlace
 *     temporal, datos personales). Si falla, se rechaza sin abrir la página.
 *  2. Abre la página (extractor.js) y lee título, descripción, textos…
 *  3. Crea la ficha por reglas (etiquetador.js).
 *  4. Si hay clave de Claude, Claude mejora la ficha (ia.js).
 *  5. Valida la utilidad educativa, busca duplicados y elige sección
 *     (classifier.js, las mismas reglas de antes) o propone una nueva.
 *
 * Si la página no se puede abrir (muchas webs bloquean a los robots), se
 * devuelve status "unreadable" para que la administración escriba el nombre
 * y una descripción; con eso se vuelve a clasificar.
 */
const { U, C, plain } = require("./compartido");
const { readPage } = require("./extractor");
const { buildRecord, buildTags } = require("./etiquetador");
const { enrichWithClaude } = require("./ia");

/** Reglas de URL que se aplican ANTES de abrir la página. */
function urlPrecheck(url, categories) {
  const v = C.validateEducational({ name: "x", url, description: "" }, categories);
  return v.code && v.code !== "NOT_EDUCATIONAL" ? v : null;
}

/**
 * Analiza un recurso a partir de su dirección.
 * @param {{url:string, name?:string, description?:string}} input
 * @param {{catalog:Array, categories:Array, ignoreId?:string}} ctx
 */
async function analyzeUrl(input, ctx) {
  const url = String(input.url || "").trim();
  // Recurso sin enlace (solo archivo): se clasifica con el nombre y la descripción escritos
  if (!url && (input.name || input.description)) {
    const record = { name: String(input.name || "").trim(), url: "", description: String(input.description || "").trim(), areas: [], grades: [], file: { dataUrl: "x" } };
    const r = plain(C.analyze(record, { catalog: ctx.catalog, categories: ctx.categories, ignoreId: ctx.ignoreId }));
    delete record.file;
    record.tags = buildTags(record, r.classification);
    record.interest = (r.validation && r.validation.interest) || "Media";
    return { source: "reglas", ...r, record };
  }
  if (!U.isValidUrl(url)) {
    return { status: "invalid", errors: [{ field: "res-url", message: "El enlace no es correcto. Debe empezar por https://" }] };
  }
  const pre = urlPrecheck(url, ctx.categories);
  if (pre) return { status: "rejected", validation: plain(pre), record: { url } };

  // 2-3. Abrir la página y crear la ficha por reglas
  let page = null;
  let fetchError = null;
  try {
    page = await readPage(url);
  } catch (e) {
    fetchError = e.message || "No se ha podido abrir la página.";
  }
  const manual = Boolean(input.name || input.description);
  if (!page && !manual) {
    return { status: "unreadable", fetchError, record: { url } };
  }
  const emptyPage = { kind: "html", data: { title: "", description: "", keywords: "", lang: "", headings: [], text: "" } };
  let record = buildRecord(page ? page.finalUrl : url, page || emptyPage);
  if (input.name) record.name = String(input.name).trim();
  if (input.description) record.description = String(input.description).trim();

  // 4. Inteligencia artificial (opcional)
  let source = "reglas";
  let aiSection = null;
  const sections = ctx.categories.flatMap((c) => c.subcategories.map((s) => `${c.name} › ${s.name}`));
  const ai = page && !manual ? await enrichWithClaude({ url: record.url, page: page.data, sections }) : null;
  if (ai) {
    source = "ia";
    record = {
      ...record,
      name: ai.nombre || record.name,
      description: ai.descripcion || record.description,
      areas: ai.materias.length ? ai.materias : record.areas,
      grades: ai.cursos.length ? ai.cursos : record.grades,
      cost: ai.coste || record.cost,
      language: ai.idioma || record.language,
      dokLevel: ai.dok >= 1 && ai.dok <= 4 ? ai.dok : record.dokLevel
    };
    aiSection = ai.seccion;
  }

  const forValidation = { ...record, description: `${record.description} ${record._pageText || ""}` };
  const finish = (result) => {
    delete record._pageText;
    record.keywords = undefined;
    return { source, fetchError, ...result, record: plain(record) };
  };

  // 5a. Utilidad educativa
  let validation = C.validateEducational(forValidation, ctx.categories);
  if (ai && !ai.esEducativo) {
    validation = { ok: false, code: "NOT_EDUCATIONAL", title: "No tiene utilidad educativa", message: ai.motivo, tip: "Si sí sirve para clase, escribe tú la descripción explicando para qué la usarías y vuelve a analizar.", eduScore: 0, eduWords: [] };
  } else if (ai && ai.esEducativo && !validation.ok && validation.code === "NOT_EDUCATIONAL") {
    // Claude ha leído la página entera: su criterio educativo prevalece sobre las palabras sueltas
    validation = { ok: true, eduScore: 1, eduWords: [], interest: "Media", reason: ai.motivo };
  }
  if (!validation.ok) return finish({ status: "rejected", validation: plain(validation) });

  // 5b. Duplicados
  const duplicate = U.detectDuplicate(record, ctx.catalog, ctx.ignoreId);

  // 5c. Sección
  const classification = plain(C.classify(forValidation, ctx.categories, ctx.catalog));
  if (aiSection && aiSection !== "NINGUNA") {
    const [catName, subName] = aiSection.split(" › ");
    const cat = ctx.categories.find((c) => c.name === catName);
    const sub = cat && cat.subcategories.find((s) => s.name === subName);
    if (sub) {
      const words = classification.best && classification.best.subcategoryName === sub.name ? classification.best.words : ["elegida por la IA"];
      classification.best = { categoryId: cat.id, categoryName: cat.name, subcategoryId: sub.id, subcategoryName: sub.name, icon: sub.icon, score: 10, words, confidence: 90, source: "ia" };
      classification.fits = true;
    }
  } else if (aiSection === "NINGUNA") {
    classification.fits = false;
  }

  record.tags = buildTags(record, classification);
  record.interest = validation.interest || "Media";
  validation = plain(validation);
  if (duplicate) return finish({ status: "duplicate", validation, duplicate: plain(duplicate), classification });
  if (classification.fits) return finish({ status: "classified", validation, classification });

  let proposal = plain(C.proposeCategory(forValidation, ctx.categories));
  if (ai && ai.seccionNuevaNombre) {
    proposal = { ...proposal, name: ai.seccionNuevaNombre, keywords: ai.seccionNuevaPalabras.slice(0, 8), reason: "Es un recurso educativo, pero no encaja en ninguna sección. La IA propone esta sección nueva." };
  }
  return finish({ status: "new-category", validation, classification, proposal });
}

module.exports = { analyzeUrl };
