/**
 * almacen.js — Guardado en archivos JSON.
 *
 * Decisión documentada (la opción más sencilla): en lugar de una base de
 * datos se usan archivos JSON. Para un centro (cientos de cuentas y
 * recursos) es suficiente, se puede copiar con un solo archivo y el catálogo
 * se puede guardar tal cual en GitHub.
 *
 * - Cada escritura es «atómica»: se escribe un archivo temporal y se
 *   renombra, así un corte de luz no deja un JSON a medias.
 * - Las escrituras se ponen en cola para que no se pisen entre sí.
 */
const fs = require("node:fs");
const path = require("node:path");

class Almacen {
  /**
   * @param {string} file - Ruta del archivo JSON.
   * @param {*} initial - Valor por defecto si el archivo no existe.
   */
  constructor(file, initial) {
    this.file = file;
    this.queue = Promise.resolve();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, "utf8"));
    } else {
      this.data = typeof initial === "function" ? initial() : initial;
      this.saveSync();
    }
  }

  saveSync() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1) + "\n");
    fs.renameSync(tmp, this.file);
  }

  /** Guarda en segundo plano, en orden. Devuelve una promesa. */
  save() {
    this.queue = this.queue.then(() => this.saveSync()).catch((e) => console.error("Error al guardar", this.file, e));
    return this.queue;
  }
}

module.exports = { Almacen };
