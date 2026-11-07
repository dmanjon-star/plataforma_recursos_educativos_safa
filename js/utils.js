/**
 * ============================================================================
 *  utils.js — Utilidades de texto, similitud y detección de duplicados
 * ============================================================================
 *  Sigue el documento de especificaciones (sección 4):
 *   - normalizeUrl: quita protocolo, «www», parámetros y barra final.
 *   - levenshteinDistance / stringSimilarityRatio: parecido entre nombres.
 *   - diceCoefficient: parecido entre descripciones (bigramas).
 *   - detectDuplicate: 3 fases (URL exacta, nombre ≥ 0,85, nombre ≥ 0,70 y
 *     descripción ≥ 0,65).
 *  Añadidos para esta plataforma:
 *   - escapeHtml: evita que un texto escrito por un usuario se convierta en
 *     código HTML (seguridad).
 *   - sha256: resumen criptográfico para guardar contraseñas sin texto plano.
 *   - countMatches / slugify: ayudas para el clasificador.
 * ============================================================================
 */
window.EduUtils = {
  /** Umbrales configurables de la detección de duplicados (documento). */
  DUPLICATE_THRESHOLDS: {
    name: 0.85,
    nameCombined: 0.7,
    descriptionCombined: 0.65
  },

  /**
   * Normaliza una URL removiendo protocolo, www, parámetros de consulta y barra final.
   * @param {string} rawUrl - URL ingresada.
   * @returns {string} URL canónica.
   */
  normalizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    try {
      let cleaned = rawUrl.trim().toLowerCase();
      if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
        cleaned = "https://" + cleaned;
      }
      const parsed = new URL(cleaned);
      const host = parsed.hostname.replace(/^www\./, "");
      const pathname = parsed.pathname.replace(/\/+$/, "");
      return `${host}${pathname}`;
    } catch {
      return rawUrl
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("?")[0]
        .replace(/\/+$/, "");
    }
  },

  /**
   * Devuelve solo el dominio (sin «www») de una URL, o "" si no es válida.
   * @param {string} rawUrl
   * @returns {string}
   */
  getDomain(rawUrl) {
    return this.normalizeUrl(rawUrl).split("/")[0] || "";
  },

  /**
   * Comprueba que el texto sea una dirección web http/https válida.
   * @param {string} value
   * @returns {boolean}
   */
  isValidUrl(value) {
    try {
      const u = new URL(String(value).trim());
      return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
    } catch {
      return false;
    }
  },

  /**
   * Elimina diacríticos, puntuación y mayúsculas para comparaciones léxicas.
   * Nota: se conserva el espacio para poder buscar palabras y frases.
   * @param {string} text - Cadena original.
   * @returns {string} Cadena normalizada.
   */
  normalizeText(text) {
    if (!text) return "";
    return String(text)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },

  /**
   * Calcula la Distancia de Levenshtein entre dos cadenas (programación dinámica).
   * @param {string} a
   * @param {string} b
   * @returns {number} Número mínimo de operaciones de edición.
   */
  levenshteinDistance(a, b) {
    const s1 = this.normalizeText(a);
    const s2 = this.normalizeText(b);
    const m = s1.length;
    const n = s2.length;

    if (m === 0) return n;
    if (n === 0) return m;

    const matrix = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = 0; i <= m; i++) matrix[i][0] = i;
    for (let j = 0; j <= n; j++) matrix[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // Borrado
          matrix[i][j - 1] + 1, // Inserción
          matrix[i - 1][j - 1] + cost // Sustitución
        );
      }
    }
    return matrix[m][n];
  },

  /**
   * Similitud normalizada (0.0 a 1.0) derivada de la distancia de Levenshtein.
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  stringSimilarityRatio(a, b) {
    const s1 = this.normalizeText(a);
    const s2 = this.normalizeText(b);
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    const dist = this.levenshteinDistance(s1, s2);
    return 1 - dist / maxLen;
  },

  /**
   * Coeficiente de Sørensen-Dice sobre bigramas de caracteres.
   * @param {string} a
   * @param {string} b
   * @returns {number} Coeficiente Dice (0.0 a 1.0).
   */
  diceCoefficient(a, b) {
    const s1 = this.normalizeText(a);
    const s2 = this.normalizeText(b);
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return 0.0;

    const getBigrams = (str) => {
      const map = new Map();
      for (let i = 0; i < str.length - 1; i++) {
        const bg = str.substring(i, i + 2);
        map.set(bg, (map.get(bg) || 0) + 1);
      }
      return map;
    };

    const b1 = getBigrams(s1);
    const b2 = getBigrams(s2);
    let intersection = 0;
    for (const [bg, count1] of b1.entries()) {
      if (b2.has(bg)) intersection += Math.min(count1, b2.get(bg));
    }
    const totalBigrams = s1.length - 1 + (s2.length - 1);
    return (2.0 * intersection) / totalBigrams;
  },

  /**
   * Evalúa si un recurso candidato coincide con otro del catálogo.
   * @param {Object} candidate - Recurso que se desea dar de alta.
   * @param {Array} catalog - Colección existente.
   * @param {string} [ignoreId] - Id a ignorar (al editar un recurso).
   * @returns {Object|null} Descripción de la coincidencia o null.
   */
  detectDuplicate(candidate, catalog, ignoreId) {
    const t = this.DUPLICATE_THRESHOLDS;
    const candUrlNorm = this.normalizeUrl(candidate.url);

    for (const existing of catalog) {
      if (ignoreId && existing.id === ignoreId) continue;
      const existUrlNorm = this.normalizeUrl(existing.url);

      // Fase 1: la dirección web es la misma
      if (candUrlNorm && existUrlNorm && candUrlNorm === existUrlNorm) {
        return {
          type: "EXACT_URL",
          matchResource: existing,
          confidence: 1.0,
          reason: `La dirección web es la misma que la de «${existing.name}».`
        };
      }

      // Fase 2: el nombre es casi igual
      const nameSim = this.stringSimilarityRatio(candidate.name, existing.name);
      if (nameSim >= t.name) {
        return {
          type: "HIGH_NAME_SIMILARITY",
          matchResource: existing,
          confidence: nameSim,
          reason: `El nombre se parece un ${Math.round(nameSim * 100)} % a «${existing.name}».`
        };
      }

      // Fase 3: nombre y descripción parecidos a la vez
      const descSim = this.diceCoefficient(candidate.description, existing.description);
      if (nameSim >= t.nameCombined && descSim >= t.descriptionCombined) {
        return {
          type: "CONCEPTUAL_SIMILARITY",
          matchResource: existing,
          confidence: (nameSim + descSim) / 2,
          reason: `El nombre (${Math.round(nameSim * 100)} %) y la descripción (${Math.round(descSim * 100)} %) se parecen mucho a «${existing.name}».`
        };
      }
    }
    return null;
  },

  /**
   * Cuenta qué palabras o frases de una lista aparecen en un texto ya
   * normalizado. Compara palabras completas (no trozos de palabra).
   * @param {string} normText - Texto normalizado.
   * @param {string[]} keywords - Palabras sin tildes y en minúscula.
   * @returns {string[]} Palabras encontradas (sin repetir).
   */
  countMatches(normText, keywords) {
    const padded = ` ${normText} `;
    const found = [];
    for (const kw of keywords) {
      const k = this.normalizeText(kw);
      // Se acepta también el plural sencillo: «ruleta» encuentra «ruletas»
      // y «actividad» encuentra «actividades».
      const hit = k && (padded.includes(` ${k} `) || padded.includes(` ${k}s `) || padded.includes(` ${k}es `));
      // No se repite una palabra que ya está en singular o en plural
      const repeated = found.some((f) => f === k || k === `${f}s` || k === `${f}es` || f === `${k}s` || f === `${k}es`);
      if (hit && !repeated) found.push(k);
    }
    return found;
  },

  /**
   * Convierte un texto en identificador seguro: «Música y arte» → «musica-y-arte».
   * @param {string} text
   * @returns {string}
   */
  slugify(text) {
    return this.normalizeText(text).replace(/\s+/g, "-").slice(0, 40) || "item";
  },

  /**
   * Escapa caracteres especiales de HTML. SIEMPRE se usa antes de pintar
   * texto escrito por usuarios con innerHTML.
   * @param {*} value
   * @returns {string}
   */
  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

  /**
   * Devuelve una URL segura para un enlace (solo http/https o archivo
   * subido en formato data:). Cualquier otra cosa («javascript:»…) se anula.
   * @param {string} url
   * @returns {string}
   */
  safeHref(url) {
    const value = String(url || "").trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (/^data:[\w/+.-]+;base64,/i.test(value)) return value;
    return "#";
  },

  /** Genera un identificador único y corto. */
  uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  },

  /**
   * SHA-256 en JavaScript puro (funciona también al abrir index.html con
   * file://, donde a veces no hay crypto.subtle). Devuelve hexadecimal.
   * @param {string} message
   * @returns {string}
   */
  sha256(message) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const bytes = new TextEncoder().encode(String(message));
    const bitLen = bytes.length * 8;
    const total = ((bytes.length + 9 + 63) >> 6) << 6;
    const data = new Uint8Array(total);
    data.set(bytes);
    data[bytes.length] = 0x80;
    const view = new DataView(data.buffer);
    view.setUint32(total - 4, bitLen >>> 0);
    view.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map((x) => x.toString(16).padStart(8, "0")).join("");
  }
};
