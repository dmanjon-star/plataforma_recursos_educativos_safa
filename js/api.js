/**
 * api.js — Comunicación del navegador con el servidor.
 *
 * Todas las peticiones:
 *  - envían la cookie de sesión (misma web),
 *  - llevan la cabecera «X-Requested-With: SAFA» (el servidor la exige para
 *    cambiar datos: protege contra webs ajenas),
 *  - devuelven el JSON o lanzan un Error con el mensaje en lenguaje sencillo
 *    que manda el servidor (error.status y error.data para más detalle).
 */
window.EduApi = (function () {
  async function request(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "X-Requested-With": "SAFA", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch {
      throw Object.assign(new Error("No hay conexión con el servidor. Revisa tu conexión a Internet."), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Algo ha fallado. Prueba otra vez."), { status: res.status, data });
    return data;
  }

  return {
    get: (url) => request("GET", url),
    post: (url, body = {}) => request("POST", url, body),
    put: (url, body = {}) => request("PUT", url, body),
    del: (url) => request("DELETE", url)
  };
})();
