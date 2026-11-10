/**
 * config.js — Configuración del servidor a partir de variables de entorno.
 *
 * Todas las claves secretas (Stripe, PayPal, GitHub, correo, Claude) se leen
 * SOLO de variables de entorno. Nunca se escriben en el código ni se guardan
 * en el repositorio. Ver docs/DESPLIEGUE.md y el archivo .env.ejemplo.
 */
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");

/** Carga un archivo .env sencillo (CLAVE=valor) si existe. No pisa variables ya definidas. */
function loadDotEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotEnv();

const env = (name, fallback = "") => (process.env[name] ?? fallback).trim();
const num = (name, fallback) => {
  const v = Number(env(name, ""));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const port = num("PORT", 3000);
const baseUrl = env("BASE_URL", `http://localhost:${port}`).replace(/\/+$/, "");

module.exports = {
  ROOT,
  port,
  baseUrl,
  /** true si la web se sirve con https (las cookies se marcan como Secure). */
  secureCookies: baseUrl.startsWith("https://"),

  /** Carpeta de datos privados (cuentas, sesiones, pagos, cursos). NO se sube a GitHub. */
  privateDir: path.resolve(ROOT, env("DATA_DIR", "data/privado")),
  /** Catálogo público (categorías y recursos). SÍ se sube a GitHub. */
  catalogFile: path.resolve(ROOT, env("CATALOG_FILE", "data/catalogo.json")),
  /** Archivos subidos por la administración (fichas, PDF…). Se suben a GitHub. */
  filesDir: path.resolve(ROOT, env("FILES_DIR", "data/archivos")),

  /** Contraseña inicial del administrador (solo la primera vez). */
  adminPassword: env("ADMIN_PASSWORD"),
  /** Si es "1", se crean cuentas de prueba (docente, vip, pago). Solo para demostraciones. */
  demo: env("DEMO") === "1",

  guest: {
    /** Días que dura un acceso de invitado. */
    days: num("GUEST_DAYS", 14),
    /** Si es "1", cualquiera puede pedir un acceso de prueba desde la pantalla de inicio. */
    selfSignup: env("GUEST_SELF_SIGNUP", "1") === "1"
  },

  payments: {
    /** Precio del plan de pago (en euros, con decimales). */
    price: num("PRICE_EUR", 49),
    currency: env("CURRENCY", "eur").toLowerCase(),
    /** Meses de acceso a los cursos por cada pago. */
    months: num("PAID_ACCESS_MONTHS", 12),
    productName: env("PRODUCT_NAME", "Recursos SAFA · Plan de pago con cursos de formación"),
    stripe: {
      secretKey: env("STRIPE_SECRET_KEY"),
      webhookSecret: env("STRIPE_WEBHOOK_SECRET"),
      /** Solo para pruebas automáticas: permite apuntar a un Stripe simulado. */
      apiBase: env("STRIPE_API_BASE", "https://api.stripe.com")
    },
    paypal: {
      clientId: env("PAYPAL_CLIENT_ID"),
      clientSecret: env("PAYPAL_CLIENT_SECRET"),
      apiBase: env("PAYPAL_API_BASE", env("PAYPAL_ENV") === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com")
    }
  },

  mail: {
    host: env("SMTP_HOST"),
    port: num("SMTP_PORT", 587),
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    from: env("MAIL_FROM", "Recursos SAFA <no-responder@example.com>")
  },

  github: {
    token: env("GITHUB_TOKEN"),
    repo: env("GITHUB_REPO"), // "propietario/repositorio"
    branch: env("GITHUB_BRANCH", "main"),
    /** Cada cuántas horas se guardan los cambios del catálogo en GitHub. */
    intervalHours: num("SYNC_INTERVAL_HOURS", 24)
  },

  ai: {
    /** Si hay clave, la ficha automática la redacta Claude; si no, se usan reglas. */
    enabled: Boolean(env("ANTHROPIC_API_KEY")),
    model: env("CLAUDE_MODEL", "claude-opus-5-5")
  },

  /** 1 si el servidor está detrás de un proxy (Render, Nginx…) que añade X-Forwarded-For. */
  trustProxy: env("TRUST_PROXY") === "1",

  /** Solo para pruebas: permite analizar páginas de la red local (127.0.0.1). */
  allowPrivateFetch: env("ALLOW_PRIVATE_FETCH") === "1"
};
