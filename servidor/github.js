/**
 * github.js — Guarda los cambios del catálogo en el repositorio de GitHub.
 *
 * Cada vez que la administración añade, cambia o borra un recurso o una
 * sección, el catálogo queda marcado como «pendiente». Cada
 * SYNC_INTERVAL_HOURS horas (y cuando se pulsa «Guardar ahora en GitHub»)
 * el servidor sube a GitHub:
 *   - data/catalogo.json (categorías, criterios y recursos)
 *   - los archivos subidos nuevos de data/archivos/
 * Así el repositorio se va actualizando con los recursos nuevos y queda un
 * historial de cada cambio.
 *
 * Usa la API «Contents» de GitHub con un token (GITHUB_TOKEN) que solo
 * necesita permiso de escritura en ese repositorio. Las cuentas, sesiones y
 * pagos NUNCA se suben (son datos personales).
 */
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const { Almacen } = require("./almacen");

const G = config.github;
const API = "https://api.github.com";

class SyncGitHub {
  constructor() {
    // Lista de archivos pendientes de subir; se guarda en disco para no perderla si el servidor se reinicia
    this.store = new Almacen(path.join(config.privateDir, "github-pendiente.json"), []);
    this.pending = new Set(this.store.data); // rutas relativas al repositorio
    this.last = { at: null, ok: null, message: "Todavía no se ha guardado nada en GitHub." };
    this.timer = null;
  }

  isConfigured() {
    return Boolean(G.token && /^[\w.-]+\/[\w.-]+$/.test(G.repo));
  }

  /** Marca un archivo para subirlo en la próxima sincronización. */
  markDirty(absPath) {
    this.pending.add(path.relative(config.ROOT, absPath).split(path.sep).join("/"));
    this._persist();
  }

  _persist() {
    this.store.data = [...this.pending];
    this.store.save();
  }

  status() {
    return { configured: this.isConfigured(), repo: G.repo, branch: G.branch, intervalHours: G.intervalHours, pending: [...this.pending], last: this.last };
  }

  async _request(method, endpoint, body) {
    const res = await fetch(`${API}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${G.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "RecursosSAFA",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  /** Sube (crea o actualiza) un archivo del repositorio. */
  async _putFile(relPath, message) {
    const abs = path.join(config.ROOT, relPath);
    const endpoint = `/repos/${G.repo}/contents/${relPath.split("/").map(encodeURIComponent).join("/")}`;
    const current = await this._request("GET", `${endpoint}?ref=${encodeURIComponent(G.branch)}`);
    if (!fs.existsSync(abs)) {
      // El archivo se ha borrado en la plataforma: se borra también en GitHub
      if (current.status === 200) {
        const del = await this._request("DELETE", endpoint, { message, sha: current.data.sha, branch: G.branch });
        if (del.status >= 300) throw new Error(`GitHub (${del.status}): ${del.data.message || "error al borrar"}`);
      }
      return;
    }
    const content = fs.readFileSync(abs).toString("base64");
    if (current.status === 200 && current.data.content && current.data.content.replace(/\n/g, "") === content) return; // sin cambios
    const put = await this._request("PUT", endpoint, {
      message,
      content,
      branch: G.branch,
      ...(current.status === 200 ? { sha: current.data.sha } : {})
    });
    if (put.status >= 300) throw new Error(`GitHub (${put.status}): ${put.data.message || "error al guardar"}`);
  }

  /**
   * Sube todo lo pendiente.
   * @param {string} summary - Resumen para el mensaje del cambio.
   */
  async syncNow(summary) {
    if (!this.isConfigured()) {
      this.last = { at: new Date().toISOString(), ok: false, message: "Falta configurar GITHUB_TOKEN y GITHUB_REPO en el servidor." };
      return this.last;
    }
    if (!this.pending.size) {
      this.last = { at: new Date().toISOString(), ok: true, message: "No había cambios que guardar." };
      return this.last;
    }
    const files = [...this.pending];
    const date = new Date().toISOString().slice(0, 10);
    try {
      for (const f of files) {
        await this._putFile(f, `Actualización automática del catálogo (${date}): ${summary}`);
        this.pending.delete(f);
        this._persist();
      }
      this.last = { at: new Date().toISOString(), ok: true, message: `Guardados en GitHub ${files.length} archivos.` };
    } catch (e) {
      this.last = { at: new Date().toISOString(), ok: false, message: e.message };
    }
    return this.last;
  }

  /** Arranca la sincronización periódica. */
  start(summaryFn) {
    if (!this.isConfigured() || this.timer) return;
    this.timer = setInterval(() => this.syncNow(summaryFn()).catch(() => {}), G.intervalHours * 3600 * 1000);
    this.timer.unref();
  }
}

module.exports = { SyncGitHub };
