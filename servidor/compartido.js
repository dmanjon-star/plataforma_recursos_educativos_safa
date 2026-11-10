/**
 * compartido.js — Carga en el servidor la misma lógica que usa el navegador.
 *
 * js/data.js (criterios y categorías), js/utils.js (similitud y duplicados) y
 * js/classifier.js (validación y clasificación) están escritos para el
 * navegador (usan `window`). Aquí se ejecutan dentro de un contexto aislado
 * para tener UNA sola versión de las reglas, sin copiarlas.
 */
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const ctx = { console, TextEncoder, URL };
ctx.window = ctx;
vm.createContext(ctx);
for (const file of ["data.js", "utils.js", "classifier.js"]) {
  const full = path.join(__dirname, "..", "js", file);
  vm.runInContext(fs.readFileSync(full, "utf8"), ctx, { filename: full });
}

/** Copia «limpia» (objetos del contexto del servidor, no del aislado). */
const plain = (v) => JSON.parse(JSON.stringify(v));

module.exports = {
  U: ctx.EduUtils,
  C: ctx.EduClassifier,
  CFG: plain(ctx.EDU_CONFIG),
  RULES: ctx.EDU_RULES,
  INITIAL_CATEGORIES: plain(ctx.INITIAL_CATEGORIES),
  plain
};
