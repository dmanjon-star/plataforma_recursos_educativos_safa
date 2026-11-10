/**
 * catalogo.js — Recursos, categorías, secciones y cursos.
 *
 * El catálogo (data/catalogo.json) se guarda en el repositorio. Cada cambio
 * lo marca como pendiente para subirlo a GitHub (github.js).
 * Los cursos son contenido de pago: se guardan en la carpeta privada.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const config = require("./config");
const { Almacen } = require("./almacen");
const { U, C, CFG } = require("./compartido");
const { buildCatalog } = require("./scripts/construir-catalogo");

const MAX_FILE = CFG.MAX_FILE_BYTES;
const FILE_EXT = /\.(pdf|docx?|odt|pptx?|odp|xlsx?|png|jpe?g|gif|mp3|txt)$/i;
const id = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;

/* ---------------------------------------------------------------------- */
/* Limpieza de datos que llegan del navegador                              */
/* ---------------------------------------------------------------------- */
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const list = (v, allowed, maxItems = 12, maxLen = 60) =>
  [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, maxLen)).filter(Boolean))]
    .filter((x) => !allowed || allowed.includes(x))
    .slice(0, maxItems);

/** Deja solo los campos permitidos, con su tipo y tamaño. */
function sanitizeRecord(input, previous = {}) {
  const r = input || {};
  return {
    ...previous,
    name: str(r.name, 120),
    url: str(r.url, 600),
    description: str(r.description, 400),
    areas: list(r.areas, CFG.SUBJECTS),
    grades: list(r.grades, CFG.GRADES),
    udlPrinciples: list(r.udlPrinciples, CFG.UDL_PRINCIPLES),
    dokLevel: [1, 2, 3, 4].includes(Number(r.dokLevel)) ? Number(r.dokLevel) : 0,
    cost: CFG.COSTS.includes(r.cost) ? r.cost : "Por confirmar",
    methodology: str(r.methodology, 120),
    language: str(r.language, 40),
    license: str(r.license, 80),
    accessibilityFeatures: list(r.accessibilityFeatures, null, 10, 60),
    tags: list(r.tags, null, 8, 40),
    linkType: CFG.LINK_TYPES.includes(r.linkType) ? r.linkType : "Página web",
    interest: r.interest === "Alta" ? "Alta" : "Media",
    guestSample: Boolean(r.guestSample)
  };
}

class Catalogo {
  constructor(github) {
    this.github = github;
    this.store = new Almacen(config.catalogFile, buildCatalog);
    this.courses = new Almacen(path.join(config.privateDir, "cursos.json"), seedCourses);
    /** Resultados de análisis recientes (para respetar el criterio de la IA al publicar). */
    this.analysisCache = new Map();
  }

  get categories() {
    return this.store.data.categories;
  }
  get resources() {
    return this.store.data.resources;
  }

  save() {
    this.store.data.updatedAt = new Date().toISOString();
    this.store.saveSync();
    this.github.markDirty(config.catalogFile);
  }

  summary() {
    return `${this.resources.length} recursos en ${this.categories.reduce((n, c) => n + c.subcategories.length, 0)} secciones`;
  }

  findSub(categoryName, subName) {
    const cat = this.categories.find((c) => c.name === categoryName);
    const sub = cat && cat.subcategories.find((s) => s.name === subName);
    return sub ? { cat, sub } : null;
  }

  /** Recursos que puede ver una persona (todos o la selección de prueba). */
  visibleFor(canAll) {
    const list = canAll ? this.resources : this.resources.filter((r) => r.guestSample);
    // El navegador no necesita la ruta interna del archivo
    return list.map((r) => (r.file ? { ...r, file: { name: r.file.name, type: r.file.type, size: r.file.size } } : r));
  }

  rememberAnalysis(url, validation) {
    this.analysisCache.set(U.normalizeUrl(url), { ok: Boolean(validation && validation.ok), at: Date.now() });
    if (this.analysisCache.size > 500) this.analysisCache.delete(this.analysisCache.keys().next().value);
  }

  /** Guarda el archivo subido (data:...;base64) y devuelve sus datos. */
  _storeFile(resourceId, file) {
    if (!file || !file.dataUrl) return null;
    const m = String(file.dataUrl).match(/^data:([\w/+.-]*);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw httpError(400, "El archivo no es válido.");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_FILE) throw httpError(413, "El archivo es demasiado grande (máximo 1,5 MB).");
    const safeName = str(file.name, 100).replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_") || "archivo";
    if (!FILE_EXT.test(safeName)) throw httpError(400, "Ese tipo de archivo no está permitido.");
    const dir = path.join(config.filesDir, resourceId);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, safeName);
    fs.writeFileSync(abs, buf);
    this.github.markDirty(abs);
    return { name: safeName, type: m[1] || "application/octet-stream", size: buf.length, path: path.relative(config.ROOT, abs).split(path.sep).join("/") };
  }

  _deleteFile(resource) {
    if (!resource || !resource.file || !resource.file.path) return;
    const abs = path.join(config.ROOT, resource.file.path);
    if (abs.startsWith(config.filesDir) && fs.existsSync(abs)) {
      fs.rmSync(abs, { force: true });
      this.github.markDirty(abs);
    }
  }

  filePath(resource) {
    if (!resource || !resource.file || !resource.file.path) return null;
    const abs = path.resolve(config.ROOT, resource.file.path);
    return abs.startsWith(config.filesDir + path.sep) && fs.existsSync(abs) ? abs : null;
  }

  /**
   * Publica o modifica un recurso. La validación se repite aquí aunque el
   * navegador ya la haya hecho: el servidor es quien manda.
   * @param {Object} body - { record, section?, newSection?, allowDuplicate?, file? }
   * @param {Object} actor - Usuario administrador.
   * @param {string} [existingId] - Si se está editando.
   */
  saveResource(body, actor, existingId) {
    const previous = existingId ? this.resources.find((r) => r.id === existingId) : null;
    if (existingId && !previous) throw httpError(404, "No se encuentra el recurso.");
    const record = sanitizeRecord(body.record, previous || {});
    record.id = previous ? previous.id : id("rec");

    const hasFile = Boolean((body.file && body.file.dataUrl) || (previous && previous.file && !body.removeFile));
    const errors = C.checkRequired({ ...record, file: hasFile ? { dataUrl: "x" } : null });
    if (errors.length) throw httpError(400, errors.map((e) => e.message).join(" "), { errors });

    // Utilidad educativa: reglas de URL siempre; el resto, según el análisis previo
    const validation = C.validateEducational(record, this.categories);
    const cached = record.url && this.analysisCache.get(U.normalizeUrl(record.url));
    const urlRule = validation.code && validation.code !== "NOT_EDUCATIONAL";
    if (!validation.ok && (urlRule || !(cached && cached.ok && Date.now() - cached.at < 3600e3))) {
      throw httpError(422, `${validation.title}. ${validation.message}`, { validation });
    }

    const duplicate = U.detectDuplicate(record, this.resources, record.id);
    if (duplicate && !body.allowDuplicate) throw httpError(409, duplicate.reason, { duplicate });

    // Sección: existente o nueva (creada tras confirmar la administración)
    let target;
    if (body.newSection) {
      target = this.addSubcategory(body.newSection.categoryId, {
        name: body.newSection.name,
        icon: "🆕",
        keywords: body.newSection.keywords,
        defaults: {
          areas: record.areas.length ? record.areas : ["Todas las áreas"],
          grades: record.grades.length ? record.grades : ["Para el docente"],
          dokLevel: record.dokLevel || 2
        }
      });
    } else {
      target = this.findSub(body.section && body.section.category, body.section && body.section.subcategory);
      if (!target) throw httpError(400, "Elige una sección que exista.");
    }

    const final = C.applyDefaults({ ...record, category: target.cat.name, subcategory: target.sub.name }, target.sub);
    const clean = JSON.parse(JSON.stringify(final));
    if (body.file && body.file.dataUrl) {
      this._deleteFile(previous);
      clean.file = this._storeFile(clean.id, body.file);
      if (!clean.url) clean.linkType = "Archivo subido";
    } else if (body.removeFile && previous) {
      this._deleteFile(previous);
      delete clean.file;
    }
    const now = new Date().toISOString();
    if (previous) {
      Object.assign(clean, { updatedAt: now, updatedBy: actor.username });
      this.resources[this.resources.indexOf(previous)] = clean;
    } else {
      Object.assign(clean, { createdAt: now, createdBy: actor.username });
      this.resources.unshift(clean);
    }
    this.save();
    return clean;
  }

  deleteResource(rid) {
    const r = this.resources.find((x) => x.id === rid);
    if (!r) throw httpError(404, "No se encuentra el recurso.");
    this._deleteFile(r);
    this.store.data.resources = this.resources.filter((x) => x.id !== rid);
    this.save();
    return r;
  }

  setSample(rid, value) {
    const r = this.resources.find((x) => x.id === rid);
    if (!r) throw httpError(404, "No se encuentra el recurso.");
    r.guestSample = Boolean(value);
    this.save();
    return r;
  }

  /* ------------------------- Categorías y secciones ------------------------- */
  _uniqueName(list, name, except) {
    return !list.some((x) => x !== except && U.normalizeText(x.name) === U.normalizeText(name));
  }
  _keywords(v) {
    return [...new Set((Array.isArray(v) ? v : String(v || "").split(",")).map((k) => U.normalizeText(k)).filter(Boolean))].slice(0, 40);
  }

  addCategory({ name, icon, description }) {
    const n = str(name, 70);
    if (!n) throw httpError(400, "Escribe un nombre.");
    if (!this._uniqueName(this.categories, n)) throw httpError(409, "Ya existe una categoría con ese nombre.");
    const cat = { id: id("cat"), name: n, icon: str(icon, 4) || "📁", description: str(description, 140), subcategories: [] };
    this.categories.push(cat);
    this.save();
    return cat;
  }

  updateCategory(cid, { name, icon, description }) {
    const cat = this.categories.find((c) => c.id === cid);
    if (!cat) throw httpError(404, "No se encuentra la categoría.");
    const n = str(name, 70);
    if (!n) throw httpError(400, "Escribe un nombre.");
    if (!this._uniqueName(this.categories, n, cat)) throw httpError(409, "Ya existe una categoría con ese nombre.");
    this.resources.forEach((r) => {
      if (r.category === cat.name) r.category = n;
    });
    Object.assign(cat, { name: n, icon: str(icon, 4) || cat.icon, description: str(description, 140) });
    this.save();
    return cat;
  }

  deleteCategory(cid) {
    const cat = this.categories.find((c) => c.id === cid);
    if (!cat) throw httpError(404, "No se encuentra la categoría.");
    const n = this.resources.filter((r) => r.category === cat.name).length;
    if (n) throw httpError(409, `No se puede borrar «${cat.name}»: tiene ${n} recursos. Primero muévelos o bórralos.`);
    this.store.data.categories = this.categories.filter((c) => c !== cat);
    this.save();
  }

  addSubcategory(cid, { name, icon, keywords, defaults }) {
    const cat = this.categories.find((c) => c.id === cid);
    if (!cat) throw httpError(404, "No se encuentra la categoría.");
    const n = str(name, 70);
    const kw = this._keywords(keywords);
    if (!n) throw httpError(400, "Escribe un nombre para la sección.");
    if (!kw.length) throw httpError(400, "Escribe al menos una palabra clave.");
    if (this.categories.some((c) => !this._uniqueName(c.subcategories, n))) throw httpError(409, "Ya hay una sección con ese nombre.");
    const sub = { id: id("sub"), name: n, icon: str(icon, 4) || "📁", keywords: kw, defaults: defaults || { areas: ["Todas las áreas"], grades: ["Para el docente"], dokLevel: 2 }, createdAt: new Date().toISOString() };
    cat.subcategories.push(sub);
    this.save();
    return { cat, sub };
  }

  updateSubcategory(cid, sid, { name, icon, keywords }) {
    const cat = this.categories.find((c) => c.id === cid);
    const sub = cat && cat.subcategories.find((s) => s.id === sid);
    if (!sub) throw httpError(404, "No se encuentra la sección.");
    const n = str(name, 70);
    const kw = this._keywords(keywords);
    if (!n) throw httpError(400, "Escribe un nombre.");
    if (!kw.length) throw httpError(400, "Escribe al menos una palabra clave.");
    if (!this._uniqueName(cat.subcategories, n, sub)) throw httpError(409, "Ya hay una sección con ese nombre.");
    this.resources.forEach((r) => {
      if (r.category === cat.name && r.subcategory === sub.name) r.subcategory = n;
    });
    Object.assign(sub, { name: n, icon: str(icon, 4) || sub.icon, keywords: kw });
    this.save();
    return sub;
  }

  deleteSubcategory(cid, sid) {
    const cat = this.categories.find((c) => c.id === cid);
    const sub = cat && cat.subcategories.find((s) => s.id === sid);
    if (!sub) throw httpError(404, "No se encuentra la sección.");
    const n = this.resources.filter((r) => r.category === cat.name && r.subcategory === sub.name).length;
    if (n) throw httpError(409, `No se puede borrar «${sub.name}»: tiene ${n} recursos. Primero muévelos (Editar recurso) o bórralos.`);
    cat.subcategories = cat.subcategories.filter((s) => s !== sub);
    this.save();
  }

  /* --------------------------------- Importar -------------------------------- */
  /** Importa recursos uno a uno: se validan y clasifican como si se añadieran a mano. */
  importResources(items, actor) {
    const report = { added: [], rejected: [], duplicated: [], needsCategory: [], invalid: [] };
    for (const raw of (Array.isArray(items) ? items : []).slice(0, 2000)) {
      const record = sanitizeRecord(raw);
      const result = C.analyze(record, { catalog: this.resources, categories: this.categories });
      const name = record.name || "(sin nombre)";
      if (result.status === "invalid") report.invalid.push({ name, why: result.errors.map((e) => e.message).join(" ") });
      else if (result.status === "rejected") report.rejected.push({ name, why: `${result.validation.title}. ${result.validation.message}` });
      else if (result.status === "duplicate") report.duplicated.push({ name, why: result.duplicate.reason });
      else if (result.status === "new-category") report.needsCategory.push({ name, why: `Sección propuesta: «${result.proposal.name}»` });
      else {
        const keep = this.findSub(raw.category, raw.subcategory);
        const best = result.classification.best;
        const target = keep || this.findSub(best.categoryName, best.subcategoryName);
        const final = JSON.parse(JSON.stringify(C.applyDefaults({ ...record, id: id("imp"), category: target.cat.name, subcategory: target.sub.name, interest: raw.interest === "Alta" ? "Alta" : result.validation.interest, createdAt: new Date().toISOString(), createdBy: actor.username }, target.sub)));
        this.resources.push(final);
        report.added.push({ name, why: `→ ${target.sub.name}` });
      }
    }
    if (report.added.length) this.save();
    return report;
  }

  /** Restaura una copia completa (categorías y recursos). */
  restore({ categories, resources }) {
    if (!Array.isArray(categories) || !Array.isArray(resources)) throw httpError(400, "La copia no tiene categorías y recursos.");
    this.store.data.categories = categories;
    this.store.data.resources = resources.map((r) => ({ ...r, file: r.file && r.file.path ? r.file : undefined }));
    this.save();
  }

  /* ---------------------------------- Cursos --------------------------------- */
  listCourses(full) {
    return this.courses.data
      .filter((c) => full || c.published)
      .map((c) => (full ? c : { id: c.id, title: c.title, description: c.description, level: c.level, hours: c.hours, lessonCount: c.lessons.length, locked: true }));
  }

  saveCourse(body, cid) {
    const lessons = (Array.isArray(body.lessons) ? body.lessons : []).slice(0, 60).map((l) => ({
      id: str(l.id, 30) || id("les"),
      title: str(l.title, 120),
      description: str(l.description, 400),
      url: U.isValidUrl(l.url) ? str(l.url, 600) : ""
    })).filter((l) => l.title);
    const course = {
      title: str(body.title, 120),
      description: str(body.description, 600),
      level: str(body.level, 60),
      hours: Math.max(0, Math.min(500, Number(body.hours) || 0)),
      published: body.published !== false,
      lessons
    };
    if (!course.title) throw httpError(400, "Escribe el título del curso.");
    if (cid) {
      const existing = this.courses.data.find((c) => c.id === cid);
      if (!existing) throw httpError(404, "No se encuentra el curso.");
      Object.assign(existing, course, { updatedAt: new Date().toISOString() });
      this.courses.save();
      return existing;
    }
    const created = { id: id("cur"), ...course, createdAt: new Date().toISOString() };
    this.courses.data.push(created);
    this.courses.save();
    return created;
  }

  deleteCourse(cid) {
    const before = this.courses.data.length;
    this.courses.data = this.courses.data.filter((c) => c.id !== cid);
    if (before === this.courses.data.length) throw httpError(404, "No se encuentra el curso.");
    this.courses.save();
  }
}

/** Dos cursos de ejemplo hechos con recursos del catálogo (se pueden editar o borrar). */
function seedCourses() {
  return [
    {
      id: "cur_ia_aula",
      title: "Inteligencia artificial en el aula de Primaria",
      description: "Aprende a usar la IA para preparar clases, adaptar textos y crear materiales, de forma segura y responsable.",
      level: "Inicial",
      hours: 10,
      published: true,
      lessons: [
        { id: "les_1", title: "1. ¿Qué es la IA y cómo se usa en educación?", description: "Guía oficial del INTEF sobre la IA en las aulas.", url: "https://code.intef.es/" },
        { id: "les_2", title: "2. Pedir bien las cosas a la IA (prompts)", description: "Ejemplos de prompts para docentes.", url: "https://sites.google.com/marianosalas.com/ejemplos-gemini-cepjaen/prompts-educaci%C3%B3n" },
        { id: "les_3", title: "3. Preparar materiales con NotebookLM", description: "Resúmenes y guías a partir de tus documentos.", url: "https://notebooklm.google.com/" },
        { id: "les_4", title: "4. Adaptar textos a cada nivel con Diffit", description: "Un mismo texto para distintos niveles de lectura.", url: "https://app.diffit.me/" }
      ],
      createdAt: new Date().toISOString()
    },
    {
      id: "cur_gamificacion",
      title: "Gamificación y DUA: clases que motivan",
      description: "Diseña actividades con juego que incluyan a todo el alumnado, siguiendo el Diseño Universal para el Aprendizaje.",
      level: "Inicial",
      hours: 8,
      published: true,
      lessons: [
        { id: "les_1", title: "1. Principios del DUA", description: "Qué es y cómo se aplica en clase.", url: "https://www.auladesigual.com/situaciones-de-aprendizaje-sin-barreras/" },
        { id: "les_2", title: "2. Juegos de repaso con Wordwall", description: "Ruletas, parejas y sopas de letras.", url: "https://wordwall.net/es/" },
        { id: "les_3", title: "3. Escape rooms con Genially", description: "Crea una aventura para tu clase.", url: "https://genial.ly/es/" }
      ],
      createdAt: new Date().toISOString()
    }
  ];
}

/** Error con código HTTP para responder al navegador. */
function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  e.extra = extra;
  return e;
}

module.exports = { Catalogo, sanitizeRecord, httpError };
