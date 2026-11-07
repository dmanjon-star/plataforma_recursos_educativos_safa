/**
 * ============================================================================
 *  storage.js — Guardado de datos en el navegador e importación/exportación
 * ============================================================================
 *  Según el documento de especificaciones, la plataforma no usa servidor:
 *  todo se guarda en el LocalStorage del navegador y, si está vacío, se carga
 *  la «semilla» (data.js + data-catalogo.js).
 *
 *  Claves usadas:
 *    eduinclusiva_catalog_store_v1   → recursos (nombre del documento)
 *    eduinclusiva_categories_v1      → categorías y subcategorías
 *    eduinclusiva_users_v1           → cuentas (contraseñas cifradas)
 *    eduinclusiva_prefs_v1           → preferencias (contraste, letra)
 *    sessionStorage: eduinclusiva_session → sesión iniciada
 *
 *  Las funciones de guardado devuelven true/false para que la interfaz
 *  pueda avisar si el navegador se ha quedado sin espacio.
 * ============================================================================
 */
window.EduStorage = {
  STORAGE_KEY: "eduinclusiva_catalog_store_v1",
  CATEGORIES_KEY: "eduinclusiva_categories_v1",
  USERS_KEY: "eduinclusiva_users_v1",
  PREFS_KEY: "eduinclusiva_prefs_v1",
  SESSION_KEY: "eduinclusiva_session",

  /* ------------------------------------------------------------------ */
  /* Utilidades internas                                                  */
  /* ------------------------------------------------------------------ */
  _read(key, store) {
    try {
      const raw = (store || localStorage).getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn("No se pudo leer del almacenamiento local:", key, e);
      return null;
    }
  },

  _write(key, value, store) {
    try {
      (store || localStorage).setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error("No se pudo escribir en el almacenamiento local.", e);
      return false;
    }
  },

  /** Copia profunda sencilla (los datos son JSON puro). */
  _clone(value) {
    return JSON.parse(JSON.stringify(value));
  },

  /* ------------------------------------------------------------------ */
  /* Catálogo                                                             */
  /* ------------------------------------------------------------------ */
  /**
   * Construye el catálogo inicial: recursos del documento + recursos del
   * Excel. Si un recurso del Excel ya está entre los del documento (misma
   * URL canónica, o mismo sitio y nombre parecido), se descarta el del Excel.
   * @returns {Array}
   */
  buildInitialCatalog() {
    const U = window.EduUtils;
    const spec = this._clone(window.SPEC_RESOURCES || []);
    const excel = this._clone(window.EXCEL_RESOURCES || []);
    const result = spec.slice();
    for (const item of excel) {
      const repeated = spec.some(
        (s) =>
          U.normalizeUrl(s.url) === U.normalizeUrl(item.url) ||
          (U.getDomain(s.url) === U.getDomain(item.url) && U.stringSimilarityRatio(s.name, item.name) >= 0.7)
      );
      if (!repeated) result.push(item);
    }
    const now = new Date().toISOString();
    return result.map((r) => ({ createdAt: now, createdBy: "semilla", linkType: "Página web", ...r }));
  },

  /**
   * Carga el catálogo desde LocalStorage o lo inicializa con la semilla.
   * @returns {Array} Listado de recursos.
   */
  loadCatalog() {
    const stored = this._read(this.STORAGE_KEY);
    if (Array.isArray(stored) && stored.length > 0) return stored;
    const seed = this.buildInitialCatalog();
    this.saveCatalog(seed);
    return seed;
  },

  /**
   * Guarda el catálogo completo.
   * @param {Array} catalog
   * @returns {boolean} false si no hay espacio.
   */
  saveCatalog(catalog) {
    return this._write(this.STORAGE_KEY, catalog);
  },

  /* ------------------------------------------------------------------ */
  /* Categorías                                                           */
  /* ------------------------------------------------------------------ */
  loadCategories() {
    const stored = this._read(this.CATEGORIES_KEY);
    if (Array.isArray(stored) && stored.length > 0) return stored;
    const seed = this._clone(window.INITIAL_CATEGORIES);
    this.saveCategories(seed);
    return seed;
  },

  saveCategories(categories) {
    return this._write(this.CATEGORIES_KEY, categories);
  },

  /* ------------------------------------------------------------------ */
  /* Usuarios                                                             */
  /* ------------------------------------------------------------------ */
  /**
   * Cifra una contraseña con una «sal» aleatoria (SHA-256).
   * @returns {{salt:string, passwordHash:string}}
   */
  hashPassword(password, salt) {
    const s = salt || Math.random().toString(36).slice(2) + Date.now().toString(36);
    return { salt: s, passwordHash: window.EduUtils.sha256(`${s}:${password}`) };
  },

  /** Carga las cuentas. La primera vez crea las de demostración. */
  loadUsers() {
    const stored = this._read(this.USERS_KEY);
    if (Array.isArray(stored) && stored.length > 0) return stored;
    const seed = (window.DEMO_USERS || []).map((u) => ({
      id: window.EduUtils.uid("usr"),
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      active: true,
      createdAt: new Date().toISOString(),
      ...this.hashPassword(u.password)
    }));
    this.saveUsers(seed);
    return seed;
  },

  saveUsers(users) {
    return this._write(this.USERS_KEY, users);
  },

  /* ------------------------------------------------------------------ */
  /* Sesión y preferencias                                                */
  /* ------------------------------------------------------------------ */
  loadSession() {
    return this._read(this.SESSION_KEY, sessionStorage);
  },

  saveSession(session) {
    return this._write(this.SESSION_KEY, session, sessionStorage);
  },

  clearSession() {
    try {
      sessionStorage.removeItem(this.SESSION_KEY);
    } catch (e) {
      /* sin acceso a sessionStorage: no hay nada que borrar */
    }
  },

  loadPrefs() {
    return this._read(this.PREFS_KEY) || { highContrast: false, largeText: false };
  },

  savePrefs(prefs) {
    return this._write(this.PREFS_KEY, prefs);
  },

  /**
   * Borra recursos y categorías guardados y vuelve a la semilla original.
   * Las cuentas de usuario NO se borran.
   */
  resetToSeed() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      localStorage.removeItem(this.CATEGORIES_KEY);
    } catch (e) {
      /* ignorado */
    }
  },

  /* ------------------------------------------------------------------ */
  /* Exportar e importar                                                  */
  /* ------------------------------------------------------------------ */
  /** Descarga un texto como archivo. */
  downloadText(text, fileName, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  _today() {
    return new Date().toISOString().split("T")[0];
  },

  /**
   * Descarga un JSON legible con el catálogo y las categorías (copia de
   * seguridad completa para administradores).
   */
  exportToJSON(catalog, categories) {
    const payload = { version: 1, exportedAt: new Date().toISOString(), categories, resources: catalog };
    this.downloadText(JSON.stringify(payload, null, 2), `recursos_safa_${this._today()}.json`, "application/json;charset=utf-8");
  },

  /**
   * Descarga una lista CSV (se abre con Excel) de los recursos indicados.
   * La usan los docentes para llevarse la lista filtrada.
   */
  exportToCSV(resources) {
    const cols = ["Nombre", "Enlace", "Descripción", "Categoría", "Subcategoría", "Materia", "Curso", "Coste"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = resources.map((r) =>
      [
        r.name,
        r.file ? `(archivo: ${r.file.name})` : r.url,
        r.description,
        r.category,
        r.subcategory,
        (r.areas || []).join("; "),
        (r.grades || []).join("; "),
        r.cost
      ]
        .map(esc)
        .join(";")
    );
    // ﻿ hace que Excel reconozca las tildes (UTF-8)
    this.downloadText("﻿" + [cols.map(esc).join(";"), ...rows].join("\r\n"), `lista_recursos_${this._today()}.csv`, "text/csv;charset=utf-8");
  },

  /**
   * Lee un archivo JSON o CSV.
   * @param {File} file
   * @returns {Promise<{resources:Array, categories:Array|null}>}
   */
  importFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const raw = e.target.result;
          const lower = file.name.toLowerCase();
          if (lower.endsWith(".json")) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return resolve({ resources: parsed, categories: null });
            if (parsed && Array.isArray(parsed.resources)) {
              return resolve({ resources: parsed.resources, categories: Array.isArray(parsed.categories) ? parsed.categories : null });
            }
            throw new Error("El archivo JSON no tiene una lista de recursos.");
          } else if (lower.endsWith(".csv")) {
            resolve({ resources: this.parseCSV(raw), categories: null });
          } else {
            throw new Error("Este tipo de archivo no vale. Elige un archivo .json o .csv.");
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
      reader.readAsText(file, "UTF-8");
    });
  },

  /**
   * Divide una línea CSV respetando las comillas. Acepta coma o punto y coma.
   */
  _splitCSVLine(line, sep) {
    const out = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  },

  /**
   * Convierte texto CSV en recursos. Columnas (en este orden, como en el
   * documento): nombre, url, descripción, etapas, áreas, DOK, metodología,
   * accesibilidad, coste. Dentro de una celda, los valores van separados
   * por «;» si el separador de columnas es «,», o por «|» si es «;».
   * @param {string} text
   * @returns {Array}
   */
  parseCSV(text) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];
    const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
    const inner = sep === ";" ? "|" : ";";
    const list = (v) => (v ? v.split(inner).map((s) => s.trim()).filter(Boolean) : []);

    const resources = [];
    for (let i = 1; i < lines.length; i++) {
      const c = this._splitCSVLine(lines[i], sep);
      if (c.length < 3) continue;
      resources.push({
        id: window.EduUtils.uid("imp"),
        name: c[0] || "Recurso sin título",
        url: c[1] || "",
        description: c[2] || "",
        stages: list(c[3]),
        areas: list(c[4]),
        dokLevel: parseInt(c[5], 10) || 0,
        methodology: c[6] || "",
        accessibilityFeatures: list(c[7]),
        cost: c[8] || "Por confirmar",
        language: "Español",
        license: "Por clasificar"
      });
    }
    return resources;
  }
};
