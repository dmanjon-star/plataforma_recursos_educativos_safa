/**
 * pagos.js — Pago del plan con cursos mediante Stripe o PayPal.
 *
 * La plataforma NUNCA ve ni guarda datos de tarjetas: la persona paga en la
 * página segura de Stripe o PayPal y vuelve. El acceso se concede solo
 * cuando el SERVIDOR confirma el pago con Stripe o PayPal:
 *
 *  Stripe
 *   1. createStripeCheckout(): crea una «Checkout Session» y devuelve su URL.
 *   2. Al volver (/pago/stripe/ok?session_id=…) el servidor consulta la
 *      sesión en Stripe y comprueba: pagada, mismo usuario, mismo importe.
 *   3. Además, el webhook (/api/pagos/stripe/webhook) recibe el aviso de
 *      Stripe firmado; la firma se comprueba con STRIPE_WEBHOOK_SECRET.
 *  PayPal
 *   1. createPaypalOrder(): crea un pedido y devuelve el enlace de aprobación.
 *   2. Al volver (/pago/paypal/ok?token=…) el servidor CAPTURA el pedido en
 *      PayPal y comprueba: completado, mismo usuario, mismo importe.
 *
 * Cada pago se apunta una sola vez (aunque llegue el aviso dos veces).
 */
const crypto = require("node:crypto");
const path = require("node:path");
const config = require("./config");
const { Almacen } = require("./almacen");

const P = config.payments;
const amountCents = () => Math.round(P.price * 100);

class Pagos {
  constructor(cuentas) {
    this.cuentas = cuentas;
    this.log = new Almacen(path.join(config.privateDir, "pagos.json"), []);
  }

  providers() {
    return {
      stripe: Boolean(P.stripe.secretKey),
      paypal: Boolean(P.paypal.clientId && P.paypal.clientSecret)
    };
  }

  /** Apunta el pago y da acceso (una sola vez por referencia). */
  _grant({ provider, ref, userId, amount, currency }) {
    if (this.log.data.some((p) => p.provider === provider && p.ref === ref && p.status === "pagado")) {
      return { ok: true, already: true };
    }
    const user = this.cuentas.grantPaidAccess(userId, P.months);
    if (!user) return { ok: false, message: "No se encuentra la cuenta del pago." };
    this.log.data.push({ id: "pay_" + crypto.randomBytes(6).toString("hex"), provider, ref, userId, username: user.username, amount, currency, status: "pagado", paidUntil: user.paidUntil, createdAt: new Date().toISOString() });
    this.log.save();
    return { ok: true, user };
  }

  list() {
    return this.log.data.slice().reverse();
  }

  /* ------------------------------------------------------------------ */
  /* Stripe                                                               */
  /* ------------------------------------------------------------------ */
  async _stripe(method, endpoint, form) {
    const res = await fetch(`${P.stripe.apiBase}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${P.stripe.secretKey}`,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
      },
      body: form ? new URLSearchParams(form).toString() : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || `Stripe respondió ${res.status}`);
    return data;
  }

  async createStripeCheckout(user) {
    const session = await this._stripe("POST", "/v1/checkout/sessions", {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": P.currency,
      "line_items[0][price_data][unit_amount]": String(amountCents()),
      "line_items[0][price_data][product_data][name]": P.productName,
      client_reference_id: user.id,
      "metadata[userId]": user.id,
      ...(user.email ? { customer_email: user.email } : {}),
      success_url: `${config.baseUrl}/pago/stripe/ok?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.baseUrl}/#cursos`
    });
    return session.url;
  }

  /** Comprueba en Stripe una sesión de pago y concede el acceso. */
  async confirmStripeSession(sessionId, expectedUserId) {
    if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId || ""))) return { ok: false, message: "El código de pago no es válido." };
    const s = await this._stripe("GET", `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
    return this._checkStripeSession(s, expectedUserId);
  }

  _checkStripeSession(s, expectedUserId) {
    const userId = (s.metadata && s.metadata.userId) || s.client_reference_id;
    if (s.payment_status !== "paid") return { ok: false, message: "El pago todavía no está completado." };
    if (expectedUserId && userId !== expectedUserId) return { ok: false, message: "Este pago es de otra cuenta." };
    if (Number(s.amount_total) !== amountCents() || String(s.currency).toLowerCase() !== P.currency) {
      return { ok: false, message: "El importe pagado no coincide con el precio." };
    }
    return this._grant({ provider: "stripe", ref: s.id, userId, amount: P.price, currency: P.currency });
  }

  /**
   * Comprueba la firma de un aviso de Stripe (cabecera Stripe-Signature):
   * HMAC-SHA256 de «tiempo.cuerpo» con el secreto del webhook, y que el
   * aviso no tenga más de 5 minutos.
   */
  verifyStripeSignature(rawBody, header, secret = P.stripe.webhookSecret, toleranceSec = 300) {
    if (!secret || !header) return false;
    const parts = Object.fromEntries(
      String(header)
        .split(",")
        .map((kv) => kv.split("="))
        .filter((kv) => kv.length === 2)
        .map(([k, v]) => [k.trim(), v.trim()])
    );
    const signatures = String(header)
      .split(",")
      .filter((kv) => kv.trim().startsWith("v1="))
      .map((kv) => kv.trim().slice(3));
    const t = Number(parts.t);
    if (!t || !signatures.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
    const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
    return signatures.some((sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
  }

  /** Procesa un aviso (webhook) de Stripe ya verificado. */
  handleStripeEvent(event) {
    if (event && event.type === "checkout.session.completed" && event.data && event.data.object) {
      return this._checkStripeSession(event.data.object, null);
    }
    return { ok: true, ignored: true };
  }

  /* ------------------------------------------------------------------ */
  /* PayPal                                                               */
  /* ------------------------------------------------------------------ */
  async _paypalToken() {
    const auth = Buffer.from(`${P.paypal.clientId}:${P.paypal.clientSecret}`).toString("base64");
    const res = await fetch(`${P.paypal.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials"
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error("No se ha podido conectar con PayPal.");
    return data.access_token;
  }

  async _paypal(method, endpoint, body) {
    const token = await this._paypalToken();
    const res = await fetch(`${P.paypal.apiBase}${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.message) || `PayPal respondió ${res.status}`);
    return data;
  }

  async createPaypalOrder(user) {
    const order = await this._paypal("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: user.id,
          description: P.productName.slice(0, 127),
          amount: { currency_code: P.currency.toUpperCase(), value: P.price.toFixed(2) }
        }
      ],
      application_context: {
        brand_name: "Recursos SAFA",
        user_action: "PAY_NOW",
        return_url: `${config.baseUrl}/pago/paypal/ok`,
        cancel_url: `${config.baseUrl}/#cursos`
      }
    });
    const approve = (order.links || []).find((l) => l.rel === "approve" || l.rel === "payer-action");
    if (!approve) throw new Error("PayPal no ha devuelto el enlace de pago.");
    return approve.href;
  }

  /** Captura (cobra) el pedido aprobado y concede el acceso. */
  async capturePaypalOrder(orderId, expectedUserId) {
    if (!/^[A-Z0-9]{5,40}$/.test(String(orderId || ""))) return { ok: false, message: "El código de pago no es válido." };
    const data = await this._paypal("POST", `/v2/checkout/orders/${orderId}/capture`, {});
    const unit = (data.purchase_units || [])[0] || {};
    const capture = ((unit.payments || {}).captures || [])[0] || {};
    const userId = capture.custom_id || unit.custom_id;
    if (data.status !== "COMPLETED" || capture.status !== "COMPLETED") return { ok: false, message: "El pago no se ha completado." };
    if (expectedUserId && userId !== expectedUserId) return { ok: false, message: "Este pago es de otra cuenta." };
    const amount = capture.amount || {};
    if (Number(amount.value) !== Number(P.price.toFixed(2)) || String(amount.currency_code).toLowerCase() !== P.currency) {
      return { ok: false, message: "El importe pagado no coincide con el precio." };
    }
    return this._grant({ provider: "paypal", ref: capture.id || orderId, userId, amount: P.price, currency: P.currency });
  }
}

module.exports = { Pagos };
