/**
 * extractor.js — Descarga segura de una página web y lectura de sus datos.
 *
 * Para clasificar un recurso con SOLO su dirección, el servidor abre la
 * página y lee: título, descripción, palabras clave, idioma, títulos (h1, h2)
 * y un trozo del texto.
 *
 * Protecciones (la dirección la escribe una persona, así que se desconfía):
 *  - Solo http y https, puertos 80 y 443.
 *  - No se permite abrir direcciones de la red interna (127.0.0.1, 10.x,
 *    192.168.x, etc.). Se comprueba la IP real y se conecta a ESA IP, para
 *    que un truco de DNS no pueda cambiarla entre la comprobación y la conexión.
 *  - Máximo 4 redirecciones (cada una se vuelve a comprobar), 10 segundos y 2 MB.
 */
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns").promises;
const net = require("node:net");
const config = require("./config");

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 4;

class FetchError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** ¿Es una IP privada, local o reservada? */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Resuelve el nombre y devuelve una IP pública permitida. */
async function resolveSafe(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  if (!addresses.length) throw new FetchError("No se encuentra esa dirección web.", "DNS");
  if (!config.allowPrivateFetch && addresses.some((a) => isPrivateIp(a.address))) {
    throw new FetchError("Esa dirección es de una red interna y no se puede abrir.", "PRIVATE");
  }
  return addresses[0];
}

/** Una petición GET a una IP ya comprobada. */
function requestOnce(url, target) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        // Se conecta a la IP comprobada, no a lo que diga un DNS después
        lookup: (_h, _o, cb) => cb(null, target.address, target.family),
        headers: {
          "User-Agent": `RecursosSAFA/2.0 (+${config.baseUrl})`,
          Accept: "text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.5",
          "Accept-Language": "es-ES,es;q=0.9,en;q=0.6"
        },
        timeout: TIMEOUT_MS
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy();
            // Basta con el principio de la página para leer sus datos
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated: true });
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new FetchError("La página tarda demasiado en responder.", "TIMEOUT")));
    req.on("error", (e) => reject(e instanceof FetchError ? e : new FetchError("No se ha podido abrir la página.", "NETWORK")));
    req.end();
  });
}

/**
 * Descarga una dirección con todas las protecciones.
 * @returns {Promise<{url:string, status:number, contentType:string, body:Buffer}>}
 */
async function safeFetch(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError("La dirección no es correcta.", "URL");
  }
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!["http:", "https:"].includes(url.protocol)) throw new FetchError("Solo se pueden abrir direcciones http o https.", "URL");
    if (url.port && !["80", "443"].includes(url.port) && !config.allowPrivateFetch) throw new FetchError("Ese puerto no está permitido.", "URL");
    if (url.username || url.password) throw new FetchError("La dirección no puede llevar usuario ni contraseña.", "URL");
    const target = await resolveSafe(url.hostname);
    const res = await requestOnce(url, target);
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      url = new URL(res.headers.location, url);
      continue;
    }
    if (res.status >= 400) throw new FetchError(`La página responde con un error (${res.status}).`, "HTTP");
    return { url: url.toString(), status: res.status, contentType: String(res.headers["content-type"] || ""), body: res.body };
  }
  throw new FetchError("La página redirige demasiadas veces.", "REDIRECTS");
}

/* ---------------------------------------------------------------------- */
/* Lectura del HTML (sin librerías: expresiones regulares sencillas)       */
/* ---------------------------------------------------------------------- */
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó",
  uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü",
  iexcl: "¡", iquest: "¿", laquo: "«", raquo: "»", ordm: "º", ordf: "ª", middot: "·", hellip: "…", ndash: "–", mdash: "—", copy: "©"
};
function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
}
const clean = (s) => decodeEntities(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Pasa los bytes a texto respetando la codificación de la página. */
function decodeBody(body, contentType) {
  let charset = (contentType.match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = body.subarray(0, 2048).toString("latin1");
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** Valor de una etiqueta <meta name|property="..." content="...">. */
function meta(html, key) {
  const re = new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${key}["'][^>]*>`, "i");
  const tag = (html.match(re) || [])[0];
  if (!tag) return "";
  return clean((tag.match(/content\s*=\s*"([^"]*)"/i) || tag.match(/content\s*=\s*'([^']*)'/i) || [])[1]);
}

/**
 * Saca los datos útiles de una página HTML.
 * @returns {{title, siteName, description, keywords, lang, headings:string[], text:string}}
 */
function extractHtml(html) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ");
  const headings = [...body.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => clean(m[1])).filter(Boolean).slice(0, 12);
  const mainPart = (body.match(/<main\b[\s\S]*?<\/main>/i) || body.match(/<body\b[\s\S]*<\/body>/i) || [body])[0];
  return {
    title: clean((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]),
    siteName: meta(html, "og:site_name") || meta(html, "application-name"),
    description: meta(html, "description") || meta(html, "og:description") || meta(html, "twitter:description"),
    ogTitle: meta(html, "og:title"),
    keywords: meta(html, "keywords"),
    lang: ((html.match(/<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z-]+)/i) || [])[1] || "").toLowerCase(),
    headings,
    text: clean(mainPart).slice(0, 8000)
  };
}

/**
 * Abre una dirección y devuelve sus datos.
 * @returns {Promise<{finalUrl, kind:"html"|"pdf"|"other", data}>}
 */
async function readPage(url) {
  const res = await safeFetch(url);
  const type = res.contentType.toLowerCase();
  if (type.includes("pdf") || /\.pdf($|\?)/i.test(res.url)) {
    const fileName = decodeURIComponent(new URL(res.url).pathname.split("/").pop() || "documento.pdf");
    return { finalUrl: res.url, kind: "pdf", data: { title: fileName.replace(/\.pdf$/i, "").replace(/[-_]+/g, " "), description: "", keywords: "", lang: "", headings: [], text: "" } };
  }
  if (!type.includes("html") && !type.includes("xml") && type) {
    return { finalUrl: res.url, kind: "other", data: { title: "", description: "", keywords: "", lang: "", headings: [], text: "" } };
  }
  return { finalUrl: res.url, kind: "html", data: extractHtml(decodeBody(res.body, res.contentType)) };
}

module.exports = { readPage, extractHtml, isPrivateIp, safeFetch, FetchError, decodeEntities };
