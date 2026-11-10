/**
 * correo.js — Envío de correos (enlace de invitado).
 *
 * Usa un servidor SMTP (el del centro, Gmail de Google Workspace, etc.)
 * configurado con SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y MAIL_FROM.
 * Si no está configurado, no se envía nada: la administración ve el enlace
 * en pantalla y lo puede copiar y enviar por su cuenta.
 */
const config = require("./config");
const { escapeHtml } = (() => {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  return { escapeHtml: esc };
})();

let transporter = null;

function isConfigured() {
  return Boolean(config.mail.host);
}

function getTransporter() {
  if (!transporter) {
    const nodemailer = require("nodemailer");
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined
    });
  }
  return transporter;
}

/** Correo de invitación con el enlace y las credenciales generadas. */
async function sendGuestInvite({ to, name, link, username, password, days }) {
  if (!isConfigured()) return false;
  const text = [
    `Hola, ${name}:`,
    "",
    "Te invitamos a probar gratis la biblioteca de recursos educativos de SAFA.",
    "",
    `Para entrar, abre este enlace: ${link}`,
    "",
    "También puedes entrar con:",
    `  Usuario: ${username}`,
    `  Contraseña: ${password}`,
    "",
    `Tu acceso de prueba dura ${days} días y muestra una selección de recursos.`,
    "",
    "Un saludo,",
    "Equipo de Recursos SAFA"
  ].join("\n");
  const html = `<p>Hola, ${escapeHtml(name)}:</p>
    <p>Te invitamos a probar gratis la biblioteca de recursos educativos de SAFA.</p>
    <p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#0f4c81;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">Entrar en Recursos SAFA</a></p>
    <p>También puedes entrar con:<br>Usuario: <strong>${escapeHtml(username)}</strong><br>Contraseña: <strong>${escapeHtml(password)}</strong></p>
    <p>Tu acceso de prueba dura ${days} días y muestra una selección de recursos.</p>
    <p>Un saludo,<br>Equipo de Recursos SAFA</p>`;
  await getTransporter().sendMail({ from: config.mail.from, to, subject: "Tu acceso de prueba a Recursos SAFA", text, html });
  return true;
}

module.exports = { isConfigured, sendGuestInvite };
