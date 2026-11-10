/**
 * etiquetador.js — Etiquetas automáticas por reglas (sin inteligencia artificial).
 *
 * A partir del texto de la página propone: nombre, descripción breve,
 * materias, cursos, precio, idioma, tipo de enlace y etiquetas.
 * Lo que no se puede deducir se deja vacío y luego lo completan los valores
 * por defecto de la sección (EduClassifier.applyDefaults).
 */
const { U, CFG } = require("./compartido");

/** Palabras que indican cada materia (sin tildes, en minúscula). */
const SUBJECT_KEYWORDS = {
  "Matemáticas": ["matematicas", "matematica", "math", "maths", "mathematics", "numeros", "sumas", "restas", "fracciones", "geometria", "calculo", "multiplicacion"],
  "Lengua Castellana y Literatura": ["lengua", "lectura", "leer", "escritura", "ortografia", "gramatica", "cuentos", "poesia", "literatura", "lectoescritura", "reading", "literacy", "comprension lectora"],
  "Conocimiento del Medio": ["ciencias", "ciencia", "naturaleza", "animales", "plantas", "cuerpo humano", "historia", "geografia", "mapas", "science", "experimentos", "medio ambiente", "planetas"],
  "Educación Artística": ["musica", "arte", "dibujo", "pintura", "plastica", "music", "art", "drawing", "canciones", "ritmo", "instrumentos"],
  "Lengua Extranjera (Inglés)": ["ingles", "english", "phonics", "vocabulary", "esl", "efl"],
  "Educación Física": ["educacion fisica", "deporte", "deportes", "psicomotricidad", "movimiento"],
  "Educación Emocional": ["emociones", "emocional", "convivencia", "mindfulness", "sentimientos", "valores"],
  "Competencia digital": ["programacion", "coding", "robotica", "inteligencia artificial", "competencia digital", "tecnologia", "scratch"]
};

const INF = ["Infantil 3 años", "Infantil 4 años", "Infantil 5 años"];
const PRIM = ["1º Primaria", "2º Primaria", "3º Primaria", "4º Primaria", "5º Primaria", "6º Primaria"];

function detectAreas(norm) {
  return Object.entries(SUBJECT_KEYWORDS)
    .map(([area, words]) => [area, U.countMatches(norm, words).length])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([area]) => area);
}

function detectGrades(norm) {
  const out = new Set();
  // Cursos concretos: «1º de primaria», «primero de primaria», «1st grade»
  const ordinals = { 1: ["primero", "1st"], 2: ["segundo", "2nd"], 3: ["tercero", "3rd"], 4: ["cuarto", "4th"], 5: ["quinto", "5th"], 6: ["sexto", "6th"] };
  for (const [n, words] of Object.entries(ordinals)) {
    const re = new RegExp(`\\b(${n}o?|${words.join("|")})\\s+(de\\s+)?(primaria|grade|curso)\\b`);
    if (re.test(norm)) out.add(`${n}º Primaria`);
  }
  if (out.size) return [...out];
  const infantil = /\b(infantil|preescolar|preschool|kindergarten|toddlers?|3 a 5 anos)\b/.test(norm);
  const primaria = /\b(primaria|primary|elementary|ninos de 6|6 a 12 anos)\b/.test(norm);
  if (infantil) INF.forEach((g) => out.add(g));
  if (primaria) PRIM.forEach((g) => out.add(g));
  if (!out.size && /\b(docentes?|profesorado|teachers?|maestros?)\b/.test(norm)) out.add("Para el docente");
  return [...out];
}

function detectCost(norm) {
  const free = /\b(gratis|gratuito|gratuita|free|sin coste|open source|codigo abierto)\b/.test(norm);
  const paid = /\b(precios?|pricing|premium|suscripcion|subscription|planes|plans|comprar|buy|pro)\b/.test(norm);
  if (free && paid) return "Freemium";
  if (free) return "Gratuito";
  if (paid) return "De pago";
  return "Por confirmar";
}

const LANGS = { es: "Español", en: "Inglés", fr: "Francés", pt: "Portugués", de: "Alemán", it: "Italiano", ca: "Catalán", eu: "Euskera", gl: "Gallego" };
function detectLanguage(lang, norm) {
  const code = String(lang || "").slice(0, 2);
  if (LANGS[code]) return LANGS[code];
  const es = U.countMatches(norm, ["el", "la", "de", "que", "para", "con", "los", "las"]).length;
  const en = U.countMatches(norm, ["the", "and", "for", "with", "your", "you", "are"]).length;
  return es > en ? "Español" : en > es ? "Inglés" : "Por confirmar";
}

function linkTypeOf(url, kind) {
  if (kind === "pdf" || /\.pdf($|\?)/i.test(url)) return "Documento PDF";
  if (/youtube\.com|youtu\.be|vimeo\.com/i.test(url)) return "Vídeo";
  if (/github\.com/i.test(url)) return "Repositorio de código";
  return "Página web";
}

/** Nombre corto: el del sitio o la primera parte del título. */
function pickName(data, url) {
  const site = (data.siteName || "").trim();
  if (site && site.length <= 40) return site;
  const title = (data.ogTitle || data.title || "").trim();
  const parts = title.split(/\s+[|–—·:-]\s+/).map((p) => p.trim()).filter((p) => p.length >= 3);
  if (parts.length) return parts[0].slice(0, 80);
  const host = U.getDomain(url).replace(/\.(com|org|net|es|edu|io|app)$/, "");
  return host ? host.charAt(0).toUpperCase() + host.slice(1) : "Recurso sin nombre";
}

/** Descripción breve (máximo ~220 caracteres, cortando en frase o palabra). */
function pickDescription(data) {
  let d = (data.description || "").trim();
  if (d.length < 15) {
    const sentences = (data.text || "").split(/(?<=[.!?])\s+/).filter((s) => s.length > 30 && s.length < 260);
    d = sentences.slice(0, 2).join(" ");
  }
  if (d.length > 220) {
    const cut = d.slice(0, 220);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    d = end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
  }
  return d;
}

/**
 * Crea la ficha del recurso a partir de los datos de la página.
 * @param {string} url
 * @param {{kind:string, data:Object}} page
 */
function buildRecord(url, page) {
  const data = page.data;
  const norm = U.normalizeText([data.title, data.ogTitle, data.description, data.keywords, data.headings.join(" "), data.text].join(" "));
  return {
    name: pickName(data, url),
    url,
    description: pickDescription(data),
    areas: detectAreas(norm),
    grades: detectGrades(norm),
    cost: detectCost(norm),
    language: detectLanguage(data.lang, norm),
    linkType: linkTypeOf(url, page.kind),
    // Texto extra que el clasificador usa como pista (no se guarda)
    keywords: [data.keywords, ...data.headings].filter(Boolean),
    _pageText: norm.slice(0, 4000)
  };
}

/** Etiquetas visibles en la ficha (máximo 8, sin repetir). */
function buildTags(record, classification) {
  const tags = [];
  const add = (t) => {
    const v = String(t || "").trim();
    if (v && !tags.some((x) => U.normalizeText(x) === U.normalizeText(v))) tags.push(v);
  };
  (record.areas || []).filter((a) => a !== "Todas las áreas").forEach(add);
  if (classification && classification.best) {
    classification.best.words.filter((w) => !w.includes(":")).slice(0, 4).forEach((w) => add(w.charAt(0).toUpperCase() + w.slice(1)));
  }
  if (record.cost === "Gratuito") add("Gratuito");
  if (record.linkType && record.linkType !== "Página web") add(record.linkType);
  if (record.grades && record.grades.includes("Para el docente")) add("Para el docente");
  return tags.slice(0, 8);
}

module.exports = { buildRecord, buildTags, detectAreas, detectGrades, detectCost, pickName, pickDescription, SUBJECT_KEYWORDS, GRADES: CFG.GRADES };
