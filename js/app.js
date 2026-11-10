/**
 * ============================================================================
 *  app.js — Interfaz de Recursos SAFA (navegador)
 * ============================================================================
 *  El navegador solo MUESTRA. Los datos, los permisos, la clasificación y
 *  los pagos los decide el servidor (carpeta servidor/). Cada perfil recibe
 *  del servidor únicamente lo que puede ver.
 *
 *  Partes:
 *    A. Estado, utilidades de interfaz (avisos, diálogo)
 *    B. Sesión: entrar, salir, prueba gratis, navegación
 *    C. Catálogo: búsqueda, filtros (AND) y fichas agrupadas
 *    D. Cursos y pago (Stripe / PayPal)
 *    E. Administración · añadir recurso con solo el enlace (análisis automático)
 *    F. Administración · lista, categorías, cuentas, cursos, pagos, copias
 *
 *  Seguridad: todo texto se pinta con EduUtils.escapeHtml() y todo enlace
 *  con EduUtils.safeHref().
 * ============================================================================
 */
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const U = window.EduUtils;
  const API = window.EduApi;
  const esc = U.escapeHtml;
  const $ = (id) => document.getElementById(id);

  /* ==========================================================================
   * A. ESTADO Y UTILIDADES
   * ======================================================================== */
  let CFG = null; // listas fijas (cursos, materias…) que manda el servidor
  let SERVER = null; // configuración pública (pagos, invitados, IA)
  let me = null; // usuario con sesión
  let catalog = { categories: [], resources: [], total: 0, limited: false };
  let prefs = loadPrefs();

  const ui = {
    expanded: new Set(),
    adminLimit: 25,
    editingId: null, // recurso en edición
    analysis: null, // último resultado del análisis
    pendingFile: null,
    allowDuplicate: false,
    users: []
  };
  const CARDS_PER_SECTION = 6;

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem("eduinclusiva_prefs_v1")) || {};
    } catch {
      return {};
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem("eduinclusiva_prefs_v1", JSON.stringify(prefs));
    } catch {
      /* sin almacenamiento: las preferencias duran solo esta visita */
    }
  }

  function announce(text) {
    const box = $("sr-announcer");
    box.textContent = "";
    setTimeout(() => (box.textContent = text), 60);
  }

  let toastTimer = null;
  function toast(text, type = "ok") {
    const box = $("toast");
    box.className = `toast toast-${type}`;
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (box.hidden = true), 6000);
  }

  /** Muestra el error de una petición; si la sesión terminó, vuelve al inicio. */
  function handleError(err) {
    if (err.status === 401) {
      me = null;
      showLogin();
      toast("Tu sesión ha terminado. Vuelve a entrar.", "error");
      return;
    }
    toast(err.message, "error");
  }

  /**
   * Ventana de diálogo reutilizable. onConfirm puede ser asíncrona; si
   * devuelve un texto, se muestra como error y no se cierra.
   */
  function openDialog(o) {
    const dialog = $("app-dialog");
    const returnFocus = document.activeElement;
    $("dialog-title").textContent = o.title;
    $("dialog-body").innerHTML = o.bodyHtml;
    $("dialog-error").hidden = true;
    const confirm = $("dialog-confirm");
    confirm.textContent = o.confirmText || "Aceptar";
    confirm.className = `btn btn-lg ${o.danger ? "btn-danger" : "btn-primary"}`;
    confirm.disabled = false;
    $("dialog-cancel").hidden = Boolean(o.hideCancel);
    const close = () => {
      dialog.close();
      if (returnFocus && document.body.contains(returnFocus)) returnFocus.focus();
    };
    $("dialog-cancel").onclick = close;
    $("dialog-close").onclick = close;
    $("dialog-form").onsubmit = async (e) => {
      e.preventDefault();
      confirm.disabled = true;
      let error = null;
      try {
        error = o.onConfirm ? await o.onConfirm() : null;
      } catch (err) {
        error = err.message;
      }
      confirm.disabled = false;
      if (error) {
        $("dialog-error").textContent = error;
        $("dialog-error").hidden = false;
        return;
      }
      close();
    };
    dialog.showModal();
    const first = dialog.querySelector("#dialog-body input, #dialog-body select, #dialog-body textarea");
    (first || confirm).focus();
  }

  function confirmAction(title, message, confirmText, onYes) {
    openDialog({ title, bodyHtml: `<p class="dialog-message">${esc(message)}</p>`, confirmText, danger: true, onConfirm: onYes });
  }

  function findSub(categoryName, subName) {
    const cat = catalog.categories.find((c) => c.name === categoryName);
    const sub = cat && cat.subcategories.find((s) => s.name === subName);
    return sub ? { cat, sub } : null;
  }

  function gradeSummary(grades) {
    const g = grades || [];
    const parts = [];
    const inf = g.filter((x) => x.startsWith("Infantil")).map((x) => parseInt(x.replace(/\D/g, ""), 10)).sort();
    if (inf.length === 3) parts.push("Infantil (3 a 5 años)");
    else if (inf.length) parts.push(`Infantil ${inf.join(", ")} años`);
    const prim = g.filter((x) => x.includes("Primaria")).map((x) => parseInt(x, 10)).sort((a, b) => a - b);
    if (prim.length) {
      const contiguous = prim.every((n, i) => i === 0 || n === prim[i - 1] + 1);
      if (prim.length === 1) parts.push(`${prim[0]}º Primaria`);
      else if (contiguous) parts.push(`${prim[0]}º a ${prim[prim.length - 1]}º Primaria`);
      else parts.push(`${prim.map((n) => n + "º").join(", ")} Primaria`);
    }
    if (g.includes("Para el docente")) parts.push("Para el docente");
    return parts.join(" · ") || "Sin indicar";
  }

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "");
  const money = (n, cur) => new Intl.NumberFormat("es-ES", { style: "currency", currency: (cur || "eur").toUpperCase() }).format(n);

  function fillSelect(select, options, firstLabel) {
    const current = select.value;
    select.innerHTML =
      (firstLabel !== undefined ? `<option value="">${esc(firstLabel)}</option>` : "") +
      options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
    if ([...select.options].some((opt) => opt.value === current)) select.value = current;
  }

  function fillChecks(container, name, values) {
    container.innerHTML = values
      .map((v, i) => `<label class="check-item" for="${name}-${i}"><input type="checkbox" id="${name}-${i}" name="${name}" value="${esc(v)}"> <span>${esc(v)}</span></label>`)
      .join("");
  }
  const checkedValues = (c) => [...c.querySelectorAll("input:checked")].map((i) => i.value);
  const setChecked = (c, values) => c.querySelectorAll("input").forEach((i) => (i.checked = (values || []).includes(i.value)));
  const splitList = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

  /* ==========================================================================
   * B. SESIÓN Y NAVEGACIÓN
   * ======================================================================== */
  function applyPrefs() {
    document.body.classList.toggle("high-contrast", Boolean(prefs.highContrast));
    document.documentElement.classList.toggle("large-text", Boolean(prefs.largeText));
    document.querySelectorAll(".js-toggle-contrast").forEach((b) => b.setAttribute("aria-pressed", String(Boolean(prefs.highContrast))));
    document.querySelectorAll(".js-toggle-text").forEach((b) => b.setAttribute("aria-pressed", String(Boolean(prefs.largeText))));
  }

  function showLogin() {
    $("view-loading").hidden = true;
    $("toast").hidden = true;
    $("app-shell").hidden = true;
    $("view-login").hidden = false;
    $("guest-request").hidden = !(SERVER && SERVER.guest.selfSignup);
    document.title = "Entrar | Recursos SAFA";
    $("login-user").focus();
  }

  async function loadCatalog() {
    catalog = await API.get("/api/catalogo");
    populateFilters();
  }

  async function enterApp(user) {
    me = user;
    await loadCatalog();
    $("view-loading").hidden = true;
    $("view-login").hidden = true;
    $("app-shell").hidden = false;
    const icon = { invitado: "🎁", vip: "⭐", pago: "💳", docente: "👩‍🏫", admin: "⚙️" }[me.role] || "👤";
    $("user-badge").innerHTML = `<span aria-hidden="true">👤</span> ${esc(me.displayName)} <span class="role-tag"><span aria-hidden="true">${icon}</span> ${esc(me.roleLabel)}</span>`;
    document.querySelectorAll("[data-admin-only]").forEach((el) => (el.hidden = !me.can.admin));
    $("btn-my-password").hidden = me.role === "invitado";
    route();
  }

  /** Muestra la vista que indica la dirección (#catalogo, #cursos, #admin, #ayuda). */
  function route() {
    if (!me) return showLogin();
    let [view, query] = (location.hash || "#catalogo").slice(1).split("?");
    if (view === "admin" && !me.can.admin) {
      toast("Esa parte es solo para administración.", "error");
      view = "catalogo";
      history.replaceState(null, "", "#catalogo");
    }
    if (!["catalogo", "cursos", "admin", "ayuda"].includes(view)) view = "catalogo";
    const views = { catalogo: "view-catalog", cursos: "view-courses", admin: "view-admin", ayuda: "view-help" };
    const titles = { catalogo: "Catálogo", cursos: "Cursos", admin: "Administrar", ayuda: "Ayuda" };
    Object.entries(views).forEach(([k, id]) => ($(id).hidden = k !== view));
    document.querySelectorAll(".nav-link").forEach((a) => (a.dataset.route === view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    document.title = `${titles[view]} | Recursos SAFA`;
    if (view === "catalogo") renderCatalog();
    if (view === "cursos") renderCourses(new URLSearchParams(query || ""));
    if (view === "admin") renderAdmin();
  }

  function setupSession() {
    $("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("login-error");
      try {
        const r = await API.post("/api/login", { username: $("login-user").value, password: $("login-pass").value });
        err.hidden = true;
        $("login-form").reset();
        if (!location.hash) history.replaceState(null, "", "#catalogo");
        await enterApp(r.user);
        $("main-content").focus();
        announce(`Hola, ${r.user.displayName}. Estás en el catálogo de recursos.`);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        $("login-pass").value = "";
        $("login-pass").focus();
      }
    });

    $("btn-toggle-pass").addEventListener("click", (e) => {
      const show = $("login-pass").type === "password";
      $("login-pass").type = show ? "text" : "password";
      e.currentTarget.setAttribute("aria-pressed", String(show));
      e.currentTarget.querySelector(".btn-label").textContent = show ? "Ocultar" : "Ver";
    });

    $("guest-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const box = $("guest-msg");
      try {
        const r = await API.post("/api/invitados/solicitar", { email: $("guest-email").value, name: $("guest-name").value });
        box.className = "alert alert-success";
        box.textContent = r.message;
        $("guest-form").reset();
      } catch (ex) {
        box.className = "alert alert-danger";
        box.textContent = ex.message;
      }
      box.hidden = false;
    });

    $("btn-logout").addEventListener("click", async () => {
      await API.post("/api/logout").catch(() => {});
      me = null;
      history.replaceState(null, "", location.pathname);
      showLogin();
      announce("Has salido de la plataforma.");
    });

    $("btn-my-password").addEventListener("click", () => {
      openDialog({
        title: "Cambiar mi contraseña",
        bodyHtml: `
          <div class="form-field"><label for="dlg-cur" class="field-label">Contraseña actual</label>
            <input type="password" id="dlg-cur" class="form-control" autocomplete="current-password"></div>
          <div class="form-field"><label for="dlg-pass1" class="field-label">Contraseña nueva</label>
            <input type="password" id="dlg-pass1" class="form-control" autocomplete="new-password" aria-describedby="dlg-pass-hint">
            <p id="dlg-pass-hint" class="field-hint">8 caracteres o más, con algún número.</p></div>
          <div class="form-field"><label for="dlg-pass2" class="field-label">Repite la contraseña nueva</label>
            <input type="password" id="dlg-pass2" class="form-control" autocomplete="new-password"></div>`,
        confirmText: "Guardar contraseña",
        onConfirm: async () => {
          if ($("dlg-pass1").value !== $("dlg-pass2").value) return "Las dos contraseñas nuevas no son iguales.";
          const r = await API.post("/api/cuenta/contrasena", { current: $("dlg-cur").value, password: $("dlg-pass1").value });
          toast(r.message);
          return null;
        }
      });
    });

    document.querySelectorAll(".js-toggle-contrast").forEach((b) =>
      b.addEventListener("click", () => {
        prefs.highContrast = !prefs.highContrast;
        savePrefs();
        applyPrefs();
        announce(prefs.highContrast ? "Alto contraste activado." : "Alto contraste desactivado.");
      })
    );
    document.querySelectorAll(".js-toggle-text").forEach((b) =>
      b.addEventListener("click", () => {
        prefs.largeText = !prefs.largeText;
        savePrefs();
        applyPrefs();
        announce(prefs.largeText ? "Letra grande activada." : "Letra normal.");
      })
    );
    window.addEventListener("hashchange", route);
  }

  /* ==========================================================================
   * C. CATÁLOGO
   * ======================================================================== */
  const filterIds = ["filter-category", "filter-subcategory", "filter-area", "filter-grade", "filter-stage", "filter-dok", "filter-udl", "filter-cost"];

  function populateFilters() {
    fillSelect($("filter-category"), catalog.categories.map((c) => ({ value: c.name, label: `${c.icon} ${c.name}` })), "Todas las categorías");
    populateSubFilter();
    fillSelect($("filter-area"), CFG.SUBJECTS.map((s) => ({ value: s, label: s })), "Todas las materias");
    fillSelect($("filter-grade"), CFG.GRADES.map((g) => ({ value: g, label: g })), "Todos los cursos");
    fillSelect($("filter-dok"), Object.entries(CFG.DOK_LEVELS).map(([v, l]) => ({ value: v, label: l })), "Cualquier tipo");
    fillSelect($("filter-udl"), CFG.UDL_PRINCIPLES.map((p) => ({ value: p, label: p })), "Todos los principios");
    fillSelect($("filter-cost"), CFG.COSTS.map((c) => ({ value: c, label: c })), "Cualquier precio");
  }

  function populateSubFilter() {
    const catName = $("filter-category").value;
    const cats = catName ? catalog.categories.filter((c) => c.name === catName) : catalog.categories;
    fillSelect($("filter-subcategory"), cats.flatMap((c) => c.subcategories.map((s) => ({ value: `${c.name}|||${s.name}`, label: `${s.icon} ${s.name}` }))), "Todas las secciones");
  }

  function getFilters() {
    const [subCat, subName] = ($("filter-subcategory").value || "").split("|||");
    return {
      text: U.normalizeText($("search-input").value),
      category: $("filter-category").value,
      subCategory: subName ? subCat : "",
      subcategory: subName || "",
      area: $("filter-area").value,
      grade: $("filter-grade").value,
      stage: $("filter-stage").value,
      dok: $("filter-dok").value,
      udl: $("filter-udl").value,
      cost: $("filter-cost").value
    };
  }

  const corpusCache = new WeakMap();
  function searchCorpus(r) {
    if (!corpusCache.has(r)) {
      corpusCache.set(r, U.normalizeText([r.name, r.description, r.category, r.subcategory, r.methodology, r.activityType, r.linkType,
        ...(r.tags || []), ...(r.areas || []), ...(r.grades || []), ...(r.supportNeeds || []), ...(r.accessibilityFeatures || [])].join(" ")));
    }
    return corpusCache.get(r);
  }

  /** Filtrado facetado: se muestran los recursos que cumplen TODOS los filtros (AND). */
  function applyFilters(list, f, ignoreCategory = false) {
    const words = f.text ? f.text.split(" ") : [];
    return list.filter((r) => {
      if (words.length && !words.every((w) => searchCorpus(r).includes(w))) return false;
      if (!ignoreCategory && f.category && r.category !== f.category) return false;
      if (f.subcategory && (r.subcategory !== f.subcategory || r.category !== f.subCategory)) return false;
      if (f.area && !(r.areas || []).includes(f.area)) return false;
      if (f.grade && !(r.grades || []).includes(f.grade)) return false;
      if (f.stage && !(r.stages || []).includes(f.stage)) return false;
      if (f.dok && Number(r.dokLevel) !== Number(f.dok)) return false;
      if (f.udl && !(r.udlPrinciples || []).includes(f.udl)) return false;
      if (f.cost && (r.cost || "Por confirmar") !== f.cost) return false;
      return true;
    });
  }

  function renderCategoryTiles(f) {
    const base = applyFilters(catalog.resources, { ...f, subcategory: "", subCategory: "" }, true);
    const tiles = [{ name: "", icon: "🌈", label: "Todas", count: base.length }].concat(
      catalog.categories.map((c) => ({ name: c.name, icon: c.icon, label: c.name, count: base.filter((r) => r.category === c.name).length }))
    );
    $("category-tiles").innerHTML = tiles
      .map((t) => `<li><button type="button" class="category-tile" data-category="${esc(t.name)}" aria-pressed="${f.category === t.name}">
          <span class="tile-icon" aria-hidden="true">${esc(t.icon)}</span><span class="tile-name">${esc(t.label)}</span>
          <span class="tile-count">${t.count} recursos</span></button></li>`)
      .join("");
  }

  function cardHtml(r) {
    const typeIcon = { "Documento PDF": "📄", "Vídeo": "🎬", "Repositorio de código": "💻", "Archivo subido": "📎" }[r.linkType] || "🌐";
    const sub = findSub(r.category, r.subcategory);
    const details = [
      r.dokLevel ? ["Tipo de pensamiento", CFG.DOK_LEVELS[r.dokLevel] || `DOK ${r.dokLevel}`] : null,
      r.methodology ? ["Metodología", r.methodology] : null,
      (r.udlPrinciples || []).length ? ["Principios DUA", r.udlPrinciples.join(", ")] : null,
      (r.accessibilityFeatures || []).length ? ["Accesibilidad", r.accessibilityFeatures.join(", ")] : null,
      (r.supportNeeds || []).length ? ["Atención a la diversidad", r.supportNeeds.join(", ")] : null,
      ["Precio", r.cost || "Por confirmar"],
      r.language ? ["Idioma", r.language] : null,
      r.license ? ["Licencia", r.license] : null
    ].filter(Boolean);
    const open = r.url
      ? `<a class="btn btn-primary btn-lg" href="${esc(U.safeHref(r.url))}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">🔗</span> Abrir<span class="visually-hidden"> ${esc(r.name)} (se abre en una pestaña nueva)</span></a>`
      : "";
    const download = r.file
      ? `<a class="btn btn-success btn-lg" href="/api/archivos/${encodeURIComponent(r.id)}" download><span aria-hidden="true">⬇️</span> Descargar archivo<span class="visually-hidden"> de ${esc(r.name)}</span></a>`
      : "";
    const adminButtons = me.can.admin
      ? `<button type="button" class="btn btn-outline" data-action="edit" data-id="${esc(r.id)}"><span aria-hidden="true">✏️</span> Editar<span class="visually-hidden"> ${esc(r.name)}</span></button>
         <button type="button" class="btn btn-outline btn-outline-danger" data-action="delete" data-id="${esc(r.id)}"><span aria-hidden="true">🗑️</span> Borrar<span class="visually-hidden"> ${esc(r.name)}</span></button>`
      : "";
    const tags = (r.tags || []).length ? `<p class="card-tags"><span class="visually-hidden">Etiquetas: </span>${r.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join(" ")}</p>` : "";
    return `<article class="card resource-card" aria-labelledby="h-${esc(r.id)}">
      <div class="card-top">
        <span class="card-type"><span aria-hidden="true">${typeIcon}</span> ${esc(r.file && !r.url ? "Archivo" : r.linkType || "Página web")}</span>
        ${r.interest === "Alta" ? '<span class="badge badge-star"><span aria-hidden="true">⭐</span> Muy recomendado</span>' : ""}
      </div>
      <h4 class="card-title" id="h-${esc(r.id)}">${esc(r.name)}</h4>
      <p class="card-description">${esc(r.description)}</p>
      ${tags}
      <ul class="card-meta">
        <li><span aria-hidden="true">🎒</span> <span class="meta-label">Curso:</span> ${esc(gradeSummary(r.grades))}</li>
        <li><span aria-hidden="true">📖</span> <span class="meta-label">Materia:</span> ${esc((r.areas || []).join(", ") || "Sin indicar")}</li>
        <li><span aria-hidden="true">${esc(sub ? sub.sub.icon : "📂")}</span> <span class="meta-label">Sección:</span> ${esc(r.subcategory || "Sin sección")}</li>
      </ul>
      <details class="card-details"><summary>Más información</summary>
        <dl>${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></details>
      <div class="card-actions">${open}${download}${adminButtons}</div>
    </article>`;
  }

  function renderCatalog() {
    const f = getFilters();
    const banner = $("guest-banner");
    banner.hidden = !catalog.limited;
    if (catalog.limited) {
      banner.innerHTML = `<p><strong><span aria-hidden="true">🎁</span> Estás probando la plataforma.</strong> Ves ${catalog.resources.length} de los ${catalog.total} recursos.
        ${me.expiresAt ? `Tu prueba termina el ${esc(fmtDate(me.expiresAt))}.` : ""}</p>
        <p>¿Te gusta? Pide una cuenta completa (VIP o de pago) al equipo de administración.</p>`;
    }
    renderCategoryTiles(f);
    const results = applyFilters(catalog.resources, f);
    const anyFilter = Object.values(f).some(Boolean);
    const showAll = results.length <= 24;
    $("results-count").textContent = anyFilter
      ? `Hemos encontrado ${results.length} de ${catalog.resources.length} recursos.`
      : `Hay ${catalog.resources.length} recursos. Busca o elige una categoría.`;

    if (!results.length) {
      $("catalog-results").innerHTML = `<div class="empty-state"><p class="empty-icon" aria-hidden="true">🔎</p>
        <p><strong>No hay recursos con estos filtros.</strong></p><p>Prueba con otra palabra o quita algún filtro.</p>
        <button type="button" class="btn btn-primary btn-lg" data-action="reset-filters"><span aria-hidden="true">🧹</span> Quitar filtros</button></div>`;
      return;
    }
    const known = new Set();
    let html = "";
    for (const cat of catalog.categories) {
      const inCat = results.filter((r) => r.category === cat.name);
      if (!inCat.length) continue;
      html += `<section class="category-block" aria-labelledby="cat-${esc(cat.id)}">
        <h2 class="category-heading" id="cat-${esc(cat.id)}"><span aria-hidden="true">${esc(cat.icon)}</span> ${esc(cat.name)} <span class="count-pill">${inCat.length}</span></h2>`;
      for (const sub of cat.subcategories) {
        const items = inCat.filter((r) => r.subcategory === sub.name).sort((a, b) => (b.interest === "Alta") - (a.interest === "Alta") || a.name.localeCompare(b.name, "es"));
        if (!items.length) continue;
        items.forEach((r) => known.add(r.id));
        const key = `${cat.id}/${sub.id}`;
        const visible = showAll || ui.expanded.has(key) ? items : items.slice(0, CARDS_PER_SECTION);
        html += `<section class="sub-block" aria-labelledby="sub-${esc(sub.id)}">
          <h3 class="sub-heading" id="sub-${esc(sub.id)}"><span aria-hidden="true">${esc(sub.icon)}</span> ${esc(sub.name)} <span class="count-pill">${items.length}</span></h3>
          <div class="resources-grid">${visible.map(cardHtml).join("")}</div>
          ${visible.length < items.length ? `<button type="button" class="btn btn-outline btn-lg btn-more" data-action="expand" data-key="${esc(key)}"><span aria-hidden="true">👀</span> Ver los ${items.length} recursos de «${esc(sub.name)}»</button>` : ""}
        </section>`;
      }
      html += "</section>";
    }
    const orphans = results.filter((r) => !known.has(r.id));
    if (orphans.length) {
      html += `<section class="category-block" aria-labelledby="cat-otros"><h2 class="category-heading" id="cat-otros"><span aria-hidden="true">📦</span> Otros <span class="count-pill">${orphans.length}</span></h2>
        <div class="resources-grid">${orphans.map(cardHtml).join("")}</div></section>`;
    }
    $("catalog-results").innerHTML = html;
  }

  function resetFilters() {
    $("search-input").value = "";
    filterIds.forEach((id) => ($(id).value = ""));
    populateSubFilter();
    ui.expanded.clear();
    renderCatalog();
    announce($("results-count").textContent);
    $("search-input").focus();
  }

  /** Lista en CSV (se abre con Excel) de lo que se está viendo. */
  function downloadCSV(list) {
    const cols = ["Nombre", "Enlace", "Descripción", "Categoría", "Sección", "Materia", "Curso", "Etiquetas", "Precio"];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = list.map((r) => [r.name, r.url || `(archivo: ${r.file ? r.file.name : ""})`, r.description, r.category, r.subcategory, (r.areas || []).join("; "), (r.grades || []).join("; "), (r.tags || []).join("; "), r.cost].map(q).join(";"));
    const blob = new Blob(["﻿" + [cols.map(q).join(";"), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lista_recursos_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function setupCatalog() {
    $("search-form").addEventListener("submit", (e) => {
      e.preventDefault();
      renderCatalog();
      announce($("results-count").textContent);
    });
    let t = null;
    $("search-input").addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        renderCatalog();
        announce($("results-count").textContent);
      }, 350);
    });
    filterIds.forEach((id) =>
      $(id).addEventListener("change", () => {
        if (id === "filter-category") populateSubFilter();
        renderCatalog();
        announce($("results-count").textContent);
      })
    );
    $("btn-reset-filters").addEventListener("click", resetFilters);
    $("btn-download-list").addEventListener("click", () => {
      const list = applyFilters(catalog.resources, getFilters());
      downloadCSV(list);
      toast(`Descargando una lista con ${list.length} recursos.`);
    });
    $("category-tiles").addEventListener("click", (e) => {
      const tile = e.target.closest(".category-tile");
      if (!tile) return;
      $("filter-category").value = tile.dataset.category;
      populateSubFilter();
      renderCatalog();
      announce($("results-count").textContent);
      const again = $("category-tiles").querySelector(`[data-category="${CSS.escape(tile.dataset.category)}"]`);
      if (again) again.focus();
    });
    $("catalog-results").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id, key } = btn.dataset;
      if (action === "expand") {
        ui.expanded.add(key);
        renderCatalog();
        announce("Se muestran todos los recursos de la sección.");
      } else if (action === "reset-filters") resetFilters();
      else if (action === "edit") startEdit(id);
      else if (action === "delete") askDeleteResource(id);
    });
  }

  /* ==========================================================================
   * D. CURSOS Y PAGO
   * ======================================================================== */
  async function renderCourses(query) {
    const result = $("payment-result");
    result.hidden = true;
    if (query.get("pago") === "ok") {
      result.className = "alert alert-success";
      result.textContent = "✅ ¡Pago recibido! Ya puedes ver todos los cursos.";
      result.hidden = false;
      const s = await API.get("/api/sesion").catch(() => null);
      if (s) me = s.user;
    } else if (query.get("pago") === "error") {
      result.className = "alert alert-danger";
      result.textContent = `⛔ El pago no se ha completado. ${query.get("motivo") || ""} No se ha cobrado nada que no se vea aquí. Puedes probar otra vez.`;
      result.hidden = false;
    }
    let data;
    try {
      data = await API.get("/api/cursos");
    } catch (err) {
      return handleError(err);
    }
    const access = $("courses-access");
    if (data.unlocked) {
      access.innerHTML = me.paidUntil
        ? `<p class="help-box"><span aria-hidden="true">✅</span> Tienes acceso a los cursos hasta el <strong>${esc(fmtDate(me.paidUntil))}</strong>.</p>`
        : "";
    } else if (data.canBuy) {
      const p = SERVER.payments;
      const anyProvider = p.stripe || p.paypal;
      access.innerHTML = `<section class="card pay-box" aria-labelledby="pay-title">
        <h2 id="pay-title" class="card-heading"><span aria-hidden="true">🔓</span> Desbloquea los cursos</h2>
        <p>Con el plan de pago ves todos los cursos durante <strong>${p.months} meses</strong> por <strong>${esc(money(p.price, p.currency))}</strong>.</p>
        <p class="field-hint"><span aria-hidden="true">🔒</span> Pagas en la página segura de Stripe o PayPal. Nosotros nunca vemos los datos de tu tarjeta.</p>
        ${anyProvider ? "" : '<p class="alert alert-danger">El pago todavía no está configurado. Habla con el equipo de administración.</p>'}
        <div class="form-actions">
          ${p.stripe ? '<button type="button" class="btn btn-primary btn-lg" data-pay="stripe"><span aria-hidden="true">💳</span> Pagar con tarjeta</button>' : ""}
          ${p.paypal ? '<button type="button" class="btn btn-outline btn-lg" data-pay="paypal"><span aria-hidden="true">🅿️</span> Pagar con PayPal</button>' : ""}
        </div></section>`;
    } else {
      access.innerHTML = `<p class="help-box"><span aria-hidden="true">ℹ️</span> Los cursos están incluidos en el <strong>plan de pago</strong>. Si te interesan, habla con el equipo de administración.</p>`;
    }
    $("courses-list").innerHTML = data.courses.length
      ? data.courses
          .map((c) => `<article class="card course-card" aria-labelledby="c-${esc(c.id)}">
            <h2 class="card-heading" id="c-${esc(c.id)}"><span aria-hidden="true">${c.locked ? "🔒" : "🎓"}</span> ${esc(c.title)}</h2>
            <p>${esc(c.description)}</p>
            <p class="field-hint">${c.level ? `Nivel: ${esc(c.level)} · ` : ""}${c.hours ? `${c.hours} horas · ` : ""}${c.locked ? c.lessonCount : c.lessons.length} lecciones</p>
            ${c.locked ? "" : `<ol class="lesson-list">${c.lessons.map((l) => `<li><strong>${esc(l.title)}</strong>${l.description ? `<br><span>${esc(l.description)}</span>` : ""}
              ${l.url ? `<br><a href="${esc(U.safeHref(l.url))}" target="_blank" rel="noopener noreferrer">Abrir la lección<span class="visually-hidden"> ${esc(l.title)} (se abre en una pestaña nueva)</span></a>` : ""}</li>`).join("")}</ol>`}
          </article>`)
          .join("")
      : '<p class="empty-state">Todavía no hay cursos.</p>';
  }

  function setupCourses() {
    $("courses-access").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-pay]");
      if (!btn) return;
      btn.disabled = true;
      try {
        const r = await API.post(`/api/pagos/${btn.dataset.pay}`);
        announce("Te llevamos a la página segura de pago.");
        location.assign(r.url);
      } catch (err) {
        btn.disabled = false;
        handleError(err);
      }
    });
  }

  /* ==========================================================================
   * E. AÑADIR RECURSO CON SOLO EL ENLACE
   * ======================================================================== */
  function setupResourceForm() {
    fillChecks($("res-areas"), "res-area", CFG.SUBJECTS);
    fillChecks($("res-grades"), "res-grade", CFG.GRADES);
    fillChecks($("res-udl"), "res-udl", CFG.UDL_PRINCIPLES);
    fillSelect($("res-dok"), Object.entries(CFG.DOK_LEVELS).map(([v, l]) => ({ value: v, label: l })), "Que lo proponga el sistema");
    fillSelect($("res-cost"), CFG.COSTS.map((c) => ({ value: c, label: c })));

    $("res-desc").addEventListener("input", () => ($("res-desc-count").textContent = `${$("res-desc").value.length} / 400`));
    document.querySelectorAll('input[name="section-mode"]').forEach((r) => r.addEventListener("change", updateSectionMode));

    $("res-file").addEventListener("change", () => {
      const file = $("res-file").files[0];
      ui.pendingFile = null;
      $("res-file-info").textContent = "";
      if (!file) return;
      if (file.size > CFG.MAX_FILE_BYTES) {
        $("res-file").value = "";
        $("res-file-info").textContent = "⚠️ El archivo es demasiado grande (máximo 1,5 MB). Súbelo a Drive y pega aquí el enlace.";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        ui.pendingFile = { name: file.name, type: file.type, dataUrl: reader.result };
        $("res-file-info").textContent = `✅ Archivo listo: ${file.name} (${Math.round(file.size / 1024)} KB)`;
      };
      reader.readAsDataURL(file);
    });

    $("analyze-form").addEventListener("submit", (e) => {
      e.preventDefault();
      runAnalysis({ url: $("an-url").value.trim(), name: $("an-name").value.trim(), description: $("an-desc").value.trim() });
    });
    $("btn-reanalyze").addEventListener("click", () =>
      runAnalysis({ url: $("res-url").value.trim(), name: $("res-name").value.trim(), description: $("res-desc").value.trim() }, true)
    );
    $("btn-discard").addEventListener("click", () => {
      resetEditor(true);
      toast("Recurso descartado. No se ha guardado nada.", "info");
    });
    $("resource-form").addEventListener("submit", (e) => {
      e.preventDefault();
      publish();
    });
    $("analysis-panel").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-analysis]");
      if (!btn) return;
      const act = btn.dataset.analysis;
      if (act === "write") {
        $("an-manual").open = true;
        $("analysis-panel").hidden = true;
        $("an-desc").focus();
      } else if (act === "discard") {
        resetEditor(true);
        toast("Recurso descartado. No se ha guardado nada.", "info");
      } else if (act === "variant" || act === "force") {
        ui.allowDuplicate = true;
        if (act === "variant" && !/\(Variante de uso\)$/.test($("res-name").value)) $("res-name").value += " (Variante de uso)";
        $("analysis-panel").querySelector(".analysis-actions").innerHTML = `<p class="analysis-note">De acuerdo: se guardará aunque se parezca a otro. Revisa la ficha y pulsa Publicar.</p>`;
        $("res-name").focus();
      }
    });
  }

  function updateSectionMode() {
    const isNew = document.querySelector('input[name="section-mode"]:checked').value === "new";
    $("section-existing").hidden = isNew;
    $("section-new").hidden = !isNew;
  }

  function sectionOptions(selCat, selSub) {
    $("res-section").innerHTML = catalog.categories
      .map((c) => `<optgroup label="${esc(c.icon + " " + c.name)}">${c.subcategories
        .map((s) => `<option value="${esc(`${c.name}|||${s.name}`)}" ${c.name === selCat && s.name === selSub ? "selected" : ""}>${esc(s.icon + " " + s.name)}</option>`)
        .join("")}</optgroup>`)
      .join("");
    fillSelect($("new-sec-cat"), catalog.categories.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` })));
  }

  function setSectionMode(mode) {
    document.querySelector(`input[name="section-mode"][value="${mode}"]`).checked = true;
    updateSectionMode();
  }

  /** Rellena la ficha editable con un recurso. */
  function fillForm(r) {
    $("res-name").value = r.name || "";
    $("res-url").value = r.url || "";
    $("res-desc").value = r.description || "";
    $("res-desc-count").textContent = `${(r.description || "").length} / 400`;
    $("res-tags").value = (r.tags || []).join(", ");
    setChecked($("res-areas"), r.areas);
    setChecked($("res-grades"), r.grades);
    setChecked($("res-udl"), r.udlPrinciples);
    $("res-dok").value = r.dokLevel ? String(r.dokLevel) : "";
    $("res-cost").value = CFG.COSTS.includes(r.cost) ? r.cost : "Por confirmar";
    $("res-language").value = r.language && r.language !== "Por confirmar" ? r.language : "";
    $("res-methodology").value = r.methodology || "";
    $("res-accessibility").value = (r.accessibilityFeatures || []).join(", ");
    $("res-license").value = r.license || "";
    $("res-guest").checked = Boolean(r.guestSample);
    $("res-file").value = "";
    $("res-file-info").textContent = r.file ? `📎 Archivo actual: ${r.file.name}. Sube otro solo si quieres cambiarlo.` : "";
  }

  function readForm() {
    const base = ui.editingId ? catalog.resources.find((r) => r.id === ui.editingId) || {} : (ui.analysis && ui.analysis.record) || {};
    return {
      ...base,
      name: $("res-name").value.trim(),
      url: $("res-url").value.trim(),
      description: $("res-desc").value.trim(),
      tags: splitList($("res-tags").value),
      areas: checkedValues($("res-areas")),
      grades: checkedValues($("res-grades")),
      udlPrinciples: checkedValues($("res-udl")),
      dokLevel: parseInt($("res-dok").value, 10) || 0,
      cost: $("res-cost").value,
      language: $("res-language").value.trim(),
      methodology: $("res-methodology").value.trim(),
      accessibilityFeatures: splitList($("res-accessibility").value),
      license: $("res-license").value.trim(),
      guestSample: $("res-guest").checked
    };
  }

  function resetEditor(focus) {
    ui.editingId = null;
    ui.analysis = null;
    ui.pendingFile = null;
    ui.allowDuplicate = false;
    $("analyze-form").reset();
    $("an-status").textContent = "";
    $("an-url-error").hidden = true;
    $("resource-form").reset();
    $("resource-form").hidden = true;
    $("analysis-panel").hidden = true;
    $("publish-error").hidden = true;
    $("add-start").hidden = false;
    $("btn-publish").innerHTML = '<span aria-hidden="true">📤</span> Publicar recurso';
    $("resource-form-title").textContent = "Ficha del recurso";
    if (focus) $("an-url").focus();
  }

  /** Paso principal: el servidor lee la página, la valida y la clasifica. */
  async function runAnalysis(input, fromEditor) {
    if (!input.url && !input.name && !input.description) {
      $("an-url-error").textContent = "⚠️ Pega el enlace del recurso.";
      $("an-url-error").hidden = false;
      $("an-url").focus();
      return;
    }
    $("an-url-error").hidden = true;
    const status = $("an-status");
    status.textContent = "⏳ Leyendo la página y clasificando… (puede tardar unos segundos)";
    $("btn-analyze").disabled = true;
    $("btn-reanalyze").disabled = true;
    try {
      const result = await API.post("/api/admin/analizar", { ...input, ignoreId: ui.editingId });
      status.textContent = "";
      if (result.status === "invalid") {
        $("an-url-error").textContent = `⚠️ ${result.errors.map((e) => e.message).join(" ")}`;
        $("an-url-error").hidden = false;
        $("an-url").focus();
        return;
      }
      ui.analysis = result;
      ui.allowDuplicate = false;
      showAnalysis(result, fromEditor);
    } catch (err) {
      status.textContent = "";
      handleError(err);
    } finally {
      $("btn-analyze").disabled = false;
      $("btn-reanalyze").disabled = false;
    }
  }

  /** Pinta el resultado del análisis y, si procede, la ficha editable. */
  function showAnalysis(result, fromEditor) {
    const panel = $("analysis-panel");
    const rec = result.record || {};
    const editing = ui.editingId && catalog.resources.find((r) => r.id === ui.editingId);
    const sourceNote = result.source === "ia" ? "Ficha redactada con inteligencia artificial y revisada por reglas." : "Ficha creada con las reglas de la plataforma.";
    let html = "";
    let showForm = true;

    if (result.status === "unreadable") {
      panel.className = "analysis-panel analysis-warning";
      html = `<div role="alert"><h3 id="analysis-title" class="analysis-title"><span aria-hidden="true">❓</span> No hemos podido leer la página</h3>
        <p><strong>Motivo:</strong> ${esc(result.fetchError || "La página no responde.")}</p>
        <p><strong><span aria-hidden="true">💡</span> ¿Qué puedo hacer?</strong> Escribe tú el nombre y una descripción corta. Con eso la clasificamos.</p></div>
        <div class="analysis-actions"><button type="button" class="btn btn-primary btn-lg" data-analysis="write"><span aria-hidden="true">✏️</span> Escribir nombre y descripción</button>
        <button type="button" class="btn btn-outline btn-lg" data-analysis="discard"><span aria-hidden="true">🗑️</span> Descartar</button></div>`;
      showForm = false;
    } else if (result.status === "rejected") {
      const v = result.validation;
      panel.className = "analysis-panel analysis-danger";
      html = `<div role="alert"><h3 id="analysis-title" class="analysis-title"><span aria-hidden="true">⛔</span> ${esc(v.title)}</h3>
        <p><strong>Motivo:</strong> ${esc(v.message)}</p>
        <p><strong><span aria-hidden="true">💡</span> ¿Qué puedo hacer?</strong> ${esc(v.tip)}</p>
        <p class="analysis-note">El recurso <strong>no se ha publicado</strong>.</p></div>
        <div class="analysis-actions"><button type="button" class="btn btn-primary btn-lg" data-analysis="write"><span aria-hidden="true">✏️</span> Explicar para qué sirve en clase</button>
        <button type="button" class="btn btn-outline btn-lg" data-analysis="discard"><span aria-hidden="true">🗑️</span> Descartar</button></div>`;
      showForm = false;
    } else if (result.status === "duplicate") {
      const d = result.duplicate;
      panel.className = "analysis-panel analysis-warning";
      html = `<div role="alert"><h3 id="analysis-title" class="analysis-title"><span aria-hidden="true">⚠️</span> Puede que este recurso ya exista</h3>
        <p>${esc(d.reason)}</p>
        <div class="duplicate-matches"><p><strong>Recurso que ya está:</strong> ${esc(d.matchResource.name)}</p>
        <p><strong>Enlace:</strong> <code>${esc(d.matchResource.url || "(archivo)")}</code></p>
        <p><strong>Sección:</strong> ${esc(d.matchResource.subcategory || "")}</p></div><p>¿Qué quieres hacer?</p></div>
        <div class="analysis-actions">
          <button type="button" class="btn btn-outline btn-lg" data-analysis="discard"><span aria-hidden="true">🗑️</span> Descartar</button>
          <button type="button" class="btn btn-primary btn-lg" data-analysis="variant"><span aria-hidden="true">🔀</span> Guardar como variante</button>
          <button type="button" class="btn btn-danger btn-lg" data-analysis="force"><span aria-hidden="true">💾</span> Guardar igualmente</button></div>`;
    } else if (result.status === "classified") {
      const b = result.classification.best;
      panel.className = "analysis-panel analysis-success";
      html = `<h3 id="analysis-title" class="analysis-title"><span aria-hidden="true">✅</span> ¡Todo bien! Este recurso sirve para clase</h3>
        <p class="placement">Lo colocamos en:<br><strong class="placement-path">${esc(b.categoryName)} › <span aria-hidden="true">${esc(b.icon)}</span> ${esc(b.subcategoryName)}</strong></p>
        <p class="analysis-note">Seguridad: ${b.confidence} %. Pistas: ${esc((b.words || []).join(", "))}. ${esc(sourceNote)}</p>
        ${editing && (editing.category !== b.categoryName || editing.subcategory !== b.subcategoryName) ? `<p class="analysis-note">Ahora está en «${esc(editing.subcategory)}». Se mantiene salvo que elijas otra sección abajo.</p>` : ""}`;
    } else if (result.status === "new-category") {
      const p = result.proposal;
      panel.className = "analysis-panel analysis-info";
      html = `<h3 id="analysis-title" class="analysis-title"><span aria-hidden="true">💡</span> Es educativo, pero no encaja en ninguna sección</h3>
        <p>${esc(p.reason)}</p>
        <p><strong>Te proponemos una sección nueva:</strong> «${esc(p.name)}». Revisa abajo el nombre y los criterios. Se creará al publicar.</p>
        <p class="analysis-note">${esc(sourceNote)}</p>`;
    }
    panel.innerHTML = html;
    panel.hidden = false;

    $("resource-form").hidden = !showForm;
    if (showForm) {
      $("add-start").hidden = true;
      if (!fromEditor || !editing) fillForm({ ...rec, guestSample: editing ? editing.guestSample : false });
      else {
        // Al volver a clasificar en edición, solo se actualizan las etiquetas
        $("res-tags").value = (rec.tags || []).join(", ");
      }
      const best = result.classification && result.classification.best;
      const selCat = editing ? editing.category : best ? best.categoryName : "";
      const selSub = editing ? editing.subcategory : best ? best.subcategoryName : "";
      sectionOptions(selCat, selSub);
      if (result.status === "new-category" && !editing) {
        setSectionMode("new");
        $("new-sec-name").value = result.proposal.name;
        $("new-sec-cat").value = result.proposal.categoryId;
        $("new-sec-keywords").value = result.proposal.keywords.join(", ");
      } else setSectionMode("existing");
      $("btn-publish").innerHTML = editing ? '<span aria-hidden="true">💾</span> Guardar cambios' : '<span aria-hidden="true">📤</span> Publicar recurso';
    }
    panel.focus();
    panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    if (!["rejected", "duplicate", "unreadable"].includes(result.status)) announce($("analysis-title").textContent);
  }

  /** Abre la ficha de un recurso existente para editarlo. */
  function startEdit(id) {
    const r = catalog.resources.find((x) => x.id === id);
    if (!r) return;
    location.hash = "#admin";
    selectTab("tab-add");
    resetEditor(false);
    ui.editingId = id;
    ui.allowDuplicate = false;
    fillForm(r);
    sectionOptions(r.category, r.subcategory);
    setSectionMode("existing");
    $("add-start").hidden = true;
    $("resource-form").hidden = false;
    $("resource-form-title").textContent = `Editar: ${r.name}`;
    $("btn-publish").innerHTML = '<span aria-hidden="true">💾</span> Guardar cambios';
    $("res-name").focus();
    announce(`Editando ${r.name}.`);
  }

  async function publish() {
    const record = readForm();
    const isNew = document.querySelector('input[name="section-mode"]:checked').value === "new";
    const body = { record, allowDuplicate: ui.allowDuplicate };
    if (isNew) body.newSection = { categoryId: $("new-sec-cat").value, name: $("new-sec-name").value.trim(), keywords: splitList($("new-sec-keywords").value) };
    else {
      const [category, subcategory] = $("res-section").value.split("|||");
      body.section = { category, subcategory };
    }
    if (ui.pendingFile) body.file = ui.pendingFile;
    const errBox = $("publish-error");
    errBox.hidden = true;
    $("btn-publish").disabled = true;
    try {
      const r = ui.editingId ? await API.put(`/api/admin/recursos/${encodeURIComponent(ui.editingId)}`, body) : await API.post("/api/admin/recursos", body);
      const verb = ui.editingId ? "guardado" : "publicado";
      toast(`✅ «${r.resource.name}» se ha ${verb} en «${r.resource.subcategory}».`);
      announce(`Recurso ${verb} en la sección ${r.resource.subcategory}.`);
      await loadCatalog();
      resetEditor(true);
    } catch (err) {
      if (err.status === 401) return handleError(err);
      errBox.textContent = err.status === 409 && err.data && err.data.duplicate
        ? `⚠️ ${err.message} Pulsa «Volver a clasificar» y elige «Guardar igualmente» si quieres guardarlo.`
        : `⛔ ${err.message}`;
      errBox.hidden = false;
      errBox.focus();
    } finally {
      $("btn-publish").disabled = false;
    }
  }

  function askDeleteResource(id) {
    const r = catalog.resources.find((x) => x.id === id);
    if (!r) return;
    confirmAction("¿Borrar este recurso?", `Vas a borrar «${r.name}». Nadie lo verá ya. No se puede deshacer.`, "Sí, borrar", async () => {
      await API.del(`/api/admin/recursos/${encodeURIComponent(id)}`);
      await loadCatalog();
      renderCatalog();
      renderAdminList();
      toast(`«${r.name}» se ha borrado.`, "info");
      return null;
    });
  }

  /* ==========================================================================
   * F. RESTO DEL PANEL DE ADMINISTRACIÓN
   * ======================================================================== */
  const tabs = () => [...document.querySelectorAll('[role="tab"]')];

  function selectTab(tabId) {
    tabs().forEach((t) => {
      const on = t.id === tabId;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    });
    const loaders = { "tab-list": renderAdminList, "tab-categories": renderCategoriesAdmin, "tab-users": renderUsers, "tab-courses": renderCoursesAdmin, "tab-payments": renderPayments, "tab-backup": renderGithub };
    if (loaders[tabId]) loaders[tabId]();
  }

  function setupTabs() {
    tabs().forEach((t, i, all) => {
      t.addEventListener("click", () => selectTab(t.id));
      t.addEventListener("keydown", (e) => {
        const next = { ArrowRight: all[(i + 1) % all.length], ArrowLeft: all[(i - 1 + all.length) % all.length], Home: all[0], End: all[all.length - 1] }[e.key];
        if (next) {
          e.preventDefault();
          selectTab(next.id);
          next.focus();
        }
      });
    });
  }

  function renderAdmin() {
    const active = tabs().find((t) => t.getAttribute("aria-selected") === "true");
    selectTab(active ? active.id : "tab-add");
  }

  /* ---- Lista de recursos ---- */
  function renderAdminList() {
    if (!me || !me.can.admin) return;
    const q = U.normalizeText($("admin-search").value);
    const list = catalog.resources.filter((r) => !q || U.normalizeText(`${r.name} ${r.subcategory} ${r.category}`).includes(q));
    const visible = list.slice(0, ui.adminLimit);
    $("admin-list-count").textContent = `${list.length} recursos${q ? " encontrados" : " en total"}. ${catalog.resources.filter((r) => r.guestSample).length} visibles para invitados.`;
    $("admin-list-body").innerHTML = visible
      .map((r) => `<tr><th scope="row">${esc(r.name)}</th><td>${esc(r.subcategory || "—")}</td>
        <td><label class="check-item check-inline"><input type="checkbox" data-sample="${esc(r.id)}" ${r.guestSample ? "checked" : ""}> <span>Sí<span class="visually-hidden">, ${esc(r.name)} visible para invitados</span></span></label></td>
        <td class="row-actions">
          <button type="button" class="btn btn-outline btn-sm" data-action="edit" data-id="${esc(r.id)}"><span aria-hidden="true">✏️</span> Editar<span class="visually-hidden"> ${esc(r.name)}</span></button>
          <button type="button" class="btn btn-outline btn-outline-danger btn-sm" data-action="delete" data-id="${esc(r.id)}"><span aria-hidden="true">🗑️</span> Borrar<span class="visually-hidden"> ${esc(r.name)}</span></button>
        </td></tr>`)
      .join("");
    $("btn-admin-more").hidden = visible.length >= list.length;
  }

  function setupAdminList() {
    $("admin-search").addEventListener("input", () => {
      ui.adminLimit = 25;
      renderAdminList();
    });
    $("btn-admin-more").addEventListener("click", () => {
      ui.adminLimit += 50;
      renderAdminList();
    });
    $("admin-list-body").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "edit") startEdit(btn.dataset.id);
      if (btn.dataset.action === "delete") askDeleteResource(btn.dataset.id);
    });
    $("admin-list-body").addEventListener("change", async (e) => {
      const box = e.target.closest("[data-sample]");
      if (!box) return;
      try {
        await API.put(`/api/admin/recursos/${encodeURIComponent(box.dataset.sample)}/muestra`, { guestSample: box.checked });
        const r = catalog.resources.find((x) => x.id === box.dataset.sample);
        if (r) r.guestSample = box.checked;
        toast(box.checked ? "Ahora lo ven los invitados." : "Los invitados ya no lo ven.");
        renderAdminList();
      } catch (err) {
        box.checked = !box.checked;
        handleError(err);
      }
    });
  }

  /* ---- Categorías y secciones ---- */
  const countIn = (catName, subName) => catalog.resources.filter((r) => r.category === catName && (!subName || r.subcategory === subName)).length;

  function renderCategoriesAdmin() {
    $("categories-admin").innerHTML = catalog.categories
      .map((c) => `<section class="card category-admin" aria-labelledby="ca-${esc(c.id)}">
        <div class="category-admin-head">
          <h3 class="card-heading" id="ca-${esc(c.id)}"><span aria-hidden="true">${esc(c.icon)}</span> ${esc(c.name)} <span class="count-pill">${countIn(c.name)}</span></h3>
          <div class="row-actions">
            <button type="button" class="btn btn-primary btn-sm" data-cat-action="new-sub" data-cat="${esc(c.id)}"><span aria-hidden="true">➕</span> Nueva sección<span class="visually-hidden"> en ${esc(c.name)}</span></button>
            <button type="button" class="btn btn-outline btn-sm" data-cat-action="edit-cat" data-cat="${esc(c.id)}"><span aria-hidden="true">✏️</span> Renombrar<span class="visually-hidden"> ${esc(c.name)}</span></button>
            <button type="button" class="btn btn-outline btn-outline-danger btn-sm" data-cat-action="delete-cat" data-cat="${esc(c.id)}"><span aria-hidden="true">🗑️</span> Borrar<span class="visually-hidden"> ${esc(c.name)}</span></button>
          </div></div>
        ${c.description ? `<p class="field-hint">${esc(c.description)}</p>` : ""}
        <ul class="sub-admin-list">${c.subcategories
          .map((s) => `<li class="sub-admin"><div>
            <p class="sub-admin-name"><span aria-hidden="true">${esc(s.icon)}</span> ${esc(s.name)} <span class="count-pill">${countIn(c.name, s.name)}</span></p>
            <p class="keywords"><span class="meta-label">Criterios:</span> ${s.keywords.map((k) => `<span class="chip">${esc(k)}</span>`).join(" ")}</p></div>
            <div class="row-actions">
              <button type="button" class="btn btn-outline btn-sm" data-cat-action="edit-sub" data-cat="${esc(c.id)}" data-sub="${esc(s.id)}"><span aria-hidden="true">✏️</span> Editar<span class="visually-hidden"> ${esc(s.name)}</span></button>
              <button type="button" class="btn btn-outline btn-outline-danger btn-sm" data-cat-action="delete-sub" data-cat="${esc(c.id)}" data-sub="${esc(s.id)}"><span aria-hidden="true">🗑️</span> Borrar<span class="visually-hidden"> ${esc(s.name)}</span></button>
            </div></li>`)
          .join("")}</ul></section>`)
      .join("");
  }

  function categoryDialog({ title, name = "", icon = "📁", keywords = null, description = "", onSave }) {
    openDialog({
      title,
      bodyHtml: `
        <div class="form-field"><label for="dlg-name" class="field-label required">Nombre</label>
          <input type="text" id="dlg-name" class="form-control" value="${esc(name)}" maxlength="70"></div>
        <div class="form-field"><label for="dlg-icon" class="field-label">Icono (un emoji)</label>
          <input type="text" id="dlg-icon" class="form-control input-icon" value="${esc(icon)}" maxlength="4"></div>
        ${keywords !== null
          ? `<div class="form-field"><label for="dlg-keywords" class="field-label required">Criterios: palabras clave (separadas por comas)</label>
              <p id="dlg-kw-hint" class="field-hint">Palabras que suelen aparecer en estos recursos.</p>
              <textarea id="dlg-keywords" class="form-control" rows="3" aria-describedby="dlg-kw-hint">${esc(keywords.join(", "))}</textarea></div>`
          : `<div class="form-field"><label for="dlg-desc" class="field-label">Descripción breve</label>
              <input type="text" id="dlg-desc" class="form-control" value="${esc(description)}" maxlength="140"></div>`}`,
      confirmText: "Guardar",
      onConfirm: async () => {
        const v = { name: $("dlg-name").value.trim(), icon: $("dlg-icon").value.trim(), keywords: keywords !== null ? splitList($("dlg-keywords").value) : undefined, description: $("dlg-desc") ? $("dlg-desc").value.trim() : "" };
        if (!v.name) return "Escribe un nombre.";
        await onSave(v);
        await loadCatalog();
        renderCategoriesAdmin();
        toast("Cambios guardados.");
        return null;
      }
    });
  }

  function setupCategoriesAdmin() {
    $("btn-new-category").addEventListener("click", () => categoryDialog({ title: "Nueva categoría", onSave: (v) => API.post("/api/admin/categorias", v) }));
    $("categories-admin").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat-action]");
      if (!btn) return;
      const cat = catalog.categories.find((c) => c.id === btn.dataset.cat);
      const sub = cat && cat.subcategories.find((s) => s.id === btn.dataset.sub);
      const base = `/api/admin/categorias/${encodeURIComponent(cat.id)}`;
      const after = async (msg) => {
        await loadCatalog();
        renderCategoriesAdmin();
        toast(msg);
        return null;
      };
      switch (btn.dataset.catAction) {
        case "new-sub":
          return categoryDialog({ title: `Nueva sección en «${cat.name}»`, keywords: [], onSave: (v) => API.post(`${base}/secciones`, v) });
        case "edit-cat":
          return categoryDialog({ title: `Renombrar «${cat.name}»`, name: cat.name, icon: cat.icon, description: cat.description || "", onSave: (v) => API.put(base, v) });
        case "edit-sub":
          return categoryDialog({ title: `Editar sección «${sub.name}»`, name: sub.name, icon: sub.icon, keywords: sub.keywords, onSave: (v) => API.put(`${base}/secciones/${encodeURIComponent(sub.id)}`, v) });
        case "delete-cat":
          return confirmAction("¿Borrar esta categoría?", `Vas a borrar «${cat.name}» y sus secciones vacías.`, "Sí, borrar", async () => {
            await API.del(base);
            return after("Categoría borrada.");
          });
        case "delete-sub":
          return confirmAction("¿Borrar esta sección?", `Vas a borrar la sección «${sub.name}».`, "Sí, borrar", async () => {
            await API.del(`${base}/secciones/${encodeURIComponent(sub.id)}`);
            return after("Sección borrada.");
          });
      }
    });
  }

  /* ---- Cuentas ---- */
  function userState(u) {
    if (!u.active) return "Desactivada";
    if (u.role === "invitado") return u.expiresAt && Date.parse(u.expiresAt) < Date.now() ? `Prueba terminada (${fmtDate(u.expiresAt)})` : `Prueba hasta el ${fmtDate(u.expiresAt)}`;
    if (u.role === "pago") return u.hasPaid ? `Pagado hasta el ${fmtDate(u.paidUntil)}` : "Pendiente de pago";
    return "Activa";
  }

  async function renderUsers() {
    try {
      ui.users = (await API.get("/api/admin/usuarios")).users;
    } catch (err) {
      return handleError(err);
    }
    const filter = $("users-filter").value;
    $("users-body").innerHTML = ui.users
      .filter((u) => !filter || u.role === filter)
      .map((u) => `<tr><th scope="row">${esc(u.displayName)}${u.id === me.id ? " <em>(tú)</em>" : ""}${u.email ? `<br><span class="field-hint">${esc(u.email)}</span>` : ""}</th>
        <td><code>${esc(u.username)}</code></td><td>${esc(u.roleLabel)}</td><td>${esc(userState(u))}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-outline btn-sm" data-user-action="edit" data-id="${esc(u.id)}"><span aria-hidden="true">✏️</span> Editar<span class="visually-hidden"> ${esc(u.username)}</span></button>
          ${u.role === "invitado"
            ? `<button type="button" class="btn btn-outline btn-sm" data-user-action="relink" data-id="${esc(u.id)}"><span aria-hidden="true">🔗</span> Nuevo enlace<span class="visually-hidden"> para ${esc(u.username)}</span></button>`
            : `<button type="button" class="btn btn-outline btn-sm" data-user-action="password" data-id="${esc(u.id)}"><span aria-hidden="true">🔑</span> Contraseña<span class="visually-hidden"> de ${esc(u.username)}</span></button>`}
          ${u.id !== me.id ? `<button type="button" class="btn btn-outline btn-outline-danger btn-sm" data-user-action="delete" data-id="${esc(u.id)}"><span aria-hidden="true">🗑️</span> Borrar<span class="visually-hidden"> ${esc(u.username)}</span></button>` : ""}
        </td></tr>`)
      .join("");
  }

  function showInviteResult(r) {
    const box = $("invite-result");
    box.innerHTML = `<p class="alert ${r.emailed ? "alert-success" : "alert-info"}">${r.emailed ? "✅ Invitación enviada por correo." : `ℹ️ ${esc(r.mailError || "El correo no está configurado: copia estos datos y envíalos tú.")}`}</p>
      <p><strong>Enlace para entrar:</strong></p>
      <div class="input-with-button"><input type="text" id="inv-link" class="form-control" readonly value="${esc(r.link)}" aria-label="Enlace de invitado">
        <button type="button" class="btn btn-outline" data-copy="inv-link"><span aria-hidden="true">📋</span> Copiar</button></div>
      <p><strong>Usuario:</strong> <code>${esc(r.username)}</code> · <strong>Contraseña:</strong> <code>${esc(r.password)}</code></p>
      <p class="field-hint">La prueba dura ${r.days} días. La contraseña solo se muestra ahora.</p>`;
    box.hidden = false;
    box.focus();
  }

  function setupUsers() {
    $("users-filter").addEventListener("change", renderUsers);
    $("invite-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const r = await API.post("/api/admin/invitados", { email: $("inv-email").value, name: $("inv-name").value, days: $("inv-days").value });
        showInviteResult(r);
        $("inv-email").value = "";
        $("inv-name").value = "";
        renderUsers();
      } catch (err) {
        handleError(err);
      }
    });
    $("invite-result").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-copy]");
      if (!btn) return;
      const input = $(btn.dataset.copy);
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand("copy");
      }
      toast("Enlace copiado.");
    });
    $("user-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("user-form-msg");
      try {
        const r = await API.post("/api/admin/usuarios", { displayName: $("usr-name").value, username: $("usr-username").value, email: $("usr-email").value, password: $("usr-pass").value, role: $("usr-role").value });
        msg.className = "alert alert-success";
        msg.textContent = r.message;
        $("user-form").reset();
        renderUsers();
      } catch (err) {
        if (err.status === 401) return handleError(err);
        msg.className = "alert alert-danger";
        msg.textContent = err.message;
      }
      msg.hidden = false;
    });
    $("users-body").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-user-action]");
      if (!btn) return;
      const u = ui.users.find((x) => x.id === btn.dataset.id);
      const path = `/api/admin/usuarios/${encodeURIComponent(u.id)}`;
      if (btn.dataset.userAction === "edit") {
        const roleOpts = Object.entries(SERVER.roles).map(([v, l]) => `<option value="${v}" ${u.role === v ? "selected" : ""}>${esc(l)}</option>`).join("");
        openDialog({
          title: `Editar «${u.username}»`,
          bodyHtml: `
            <div class="form-field"><label for="dlg-uname" class="field-label">Nombre</label><input type="text" id="dlg-uname" class="form-control" value="${esc(u.displayName)}" maxlength="80"></div>
            <div class="form-field"><label for="dlg-uemail" class="field-label">Correo</label><input type="email" id="dlg-uemail" class="form-control" value="${esc(u.email)}"></div>
            <div class="form-field"><label for="dlg-urole" class="field-label">Tipo de cuenta</label><select id="dlg-urole" class="form-control">${roleOpts}</select></div>
            ${u.role === "invitado" ? `<div class="form-field"><label for="dlg-uexp" class="field-label">Fin de la prueba</label><input type="date" id="dlg-uexp" class="form-control" value="${esc((u.expiresAt || "").slice(0, 10))}"></div>` : ""}
            ${u.role === "pago" ? `<div class="form-field"><label for="dlg-upaid" class="field-label">Acceso a cursos hasta (vacío = sin acceso)</label><input type="date" id="dlg-upaid" class="form-control" value="${esc((u.paidUntil || "").slice(0, 10))}"></div>` : ""}
            <label class="check-item"><input type="checkbox" id="dlg-uactive" ${u.active ? "checked" : ""}> <span>Cuenta activa</span></label>`,
          confirmText: "Guardar",
          onConfirm: async () => {
            const changes = { displayName: $("dlg-uname").value, email: $("dlg-uemail").value, role: $("dlg-urole").value, active: $("dlg-uactive").checked };
            if ($("dlg-uexp") && $("dlg-uexp").value) changes.expiresAt = $("dlg-uexp").value + "T23:59:59";
            if ($("dlg-upaid")) changes.paidUntil = $("dlg-upaid").value ? $("dlg-upaid").value + "T23:59:59" : null;
            const r = await API.put(path, changes);
            toast(r.message);
            renderUsers();
            return null;
          }
        });
      } else if (btn.dataset.userAction === "password") {
        openDialog({
          title: `Nueva contraseña para «${u.username}»`,
          bodyHtml: `<div class="form-field"><label for="dlg-pass1" class="field-label">Contraseña nueva</label>
            <input type="password" id="dlg-pass1" class="form-control" autocomplete="new-password" aria-describedby="dlg-pass-hint">
            <p id="dlg-pass-hint" class="field-hint">8 caracteres o más, con algún número. Díselo a la persona en privado.</p></div>`,
          confirmText: "Guardar",
          onConfirm: async () => {
            const r = await API.post(`${path}/contrasena`, { password: $("dlg-pass1").value });
            toast(r.message);
            return null;
          }
        });
      } else if (btn.dataset.userAction === "relink") {
        confirmAction("¿Crear un enlace nuevo?", `Se crea un enlace y una contraseña nuevos para «${u.email}». El enlace anterior deja de funcionar.`, "Sí, crear", async () => {
          const r = await API.post("/api/admin/invitados", { email: u.email, name: u.displayName });
          selectTab("tab-users");
          showInviteResult(r);
          return null;
        });
      } else if (btn.dataset.userAction === "delete") {
        confirmAction("¿Borrar esta cuenta?", `La persona «${u.displayName}» ya no podrá entrar.`, "Sí, borrar", async () => {
          const r = await API.del(path);
          toast(r.message);
          renderUsers();
          return null;
        });
      }
    });
  }

  /* ---- Cursos (administración) ---- */
  let adminCourses = [];
  async function renderCoursesAdmin() {
    try {
      adminCourses = (await API.get("/api/admin/cursos")).courses;
    } catch (err) {
      return handleError(err);
    }
    $("courses-admin").innerHTML = adminCourses
      .map((c) => `<section class="card category-admin" aria-labelledby="ac-${esc(c.id)}"><div class="category-admin-head">
        <h3 class="card-heading" id="ac-${esc(c.id)}"><span aria-hidden="true">🎓</span> ${esc(c.title)} ${c.published ? "" : '<span class="chip">Oculto</span>'}</h3>
        <div class="row-actions">
          <button type="button" class="btn btn-outline btn-sm" data-course="edit" data-id="${esc(c.id)}"><span aria-hidden="true">✏️</span> Editar<span class="visually-hidden"> ${esc(c.title)}</span></button>
          <button type="button" class="btn btn-outline btn-outline-danger btn-sm" data-course="delete" data-id="${esc(c.id)}"><span aria-hidden="true">🗑️</span> Borrar<span class="visually-hidden"> ${esc(c.title)}</span></button>
        </div></div><p>${esc(c.description)}</p><p class="field-hint">${c.lessons.length} lecciones${c.hours ? ` · ${c.hours} horas` : ""}</p></section>`)
      .join("") || '<p class="empty-state">Todavía no hay cursos.</p>';
  }

  function courseDialog(c) {
    const lessonsText = (c ? c.lessons : []).map((l) => [l.title, l.url, l.description].join(" | ")).join("\n");
    openDialog({
      title: c ? `Editar «${c.title}»` : "Nuevo curso",
      bodyHtml: `
        <div class="form-field"><label for="dlg-ctitle" class="field-label required">Título</label><input type="text" id="dlg-ctitle" class="form-control" maxlength="120" value="${esc(c ? c.title : "")}"></div>
        <div class="form-field"><label for="dlg-cdesc" class="field-label">Descripción</label><textarea id="dlg-cdesc" class="form-control" rows="3" maxlength="600">${esc(c ? c.description : "")}</textarea></div>
        <div class="form-row">
          <div class="form-field"><label for="dlg-clevel" class="field-label">Nivel</label><input type="text" id="dlg-clevel" class="form-control" value="${esc(c ? c.level : "Inicial")}"></div>
          <div class="form-field"><label for="dlg-chours" class="field-label">Horas</label><input type="number" id="dlg-chours" class="form-control" min="0" max="500" value="${esc(c ? c.hours : 5)}"></div>
        </div>
        <div class="form-field"><label for="dlg-clessons" class="field-label">Lecciones (una por línea)</label>
          <p id="dlg-cl-hint" class="field-hint">Escribe: Título | enlace | descripción. Ejemplo: 1. Qué es el DUA | https://… | Vídeo de 10 minutos</p>
          <textarea id="dlg-clessons" class="form-control" rows="6" aria-describedby="dlg-cl-hint">${esc(lessonsText)}</textarea></div>
        <label class="check-item"><input type="checkbox" id="dlg-cpub" ${!c || c.published ? "checked" : ""}> <span>Publicado (lo ven las cuentas de pago)</span></label>`,
      confirmText: "Guardar curso",
      onConfirm: async () => {
        const lessons = $("dlg-clessons").value.split("\n").map((line) => line.split("|").map((s) => s.trim())).filter((p) => p[0]).map(([title, url, description]) => ({ title, url: url || "", description: description || "" }));
        const body = { title: $("dlg-ctitle").value, description: $("dlg-cdesc").value, level: $("dlg-clevel").value, hours: $("dlg-chours").value, published: $("dlg-cpub").checked, lessons };
        if (c) await API.put(`/api/admin/cursos/${encodeURIComponent(c.id)}`, body);
        else await API.post("/api/admin/cursos", body);
        renderCoursesAdmin();
        toast("Curso guardado.");
        return null;
      }
    });
  }

  function setupCoursesAdmin() {
    $("btn-new-course").addEventListener("click", () => courseDialog(null));
    $("courses-admin").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-course]");
      if (!btn) return;
      const c = adminCourses.find((x) => x.id === btn.dataset.id);
      if (btn.dataset.course === "edit") courseDialog(c);
      else
        confirmAction("¿Borrar este curso?", `Vas a borrar «${c.title}».`, "Sí, borrar", async () => {
          await API.del(`/api/admin/cursos/${encodeURIComponent(c.id)}`);
          renderCoursesAdmin();
          toast("Curso borrado.", "info");
          return null;
        });
    });
  }

  /* ---- Pagos ---- */
  async function renderPayments() {
    const p = SERVER.payments;
    $("payments-config").textContent = `Precio: ${money(p.price, p.currency)} por ${p.months} meses de cursos. Tarjeta (Stripe): ${p.stripe ? "activada" : "sin configurar"}. PayPal: ${p.paypal ? "activado" : "sin configurar"}.`;
    try {
      const list = (await API.get("/api/admin/pagos")).payments;
      $("payments-body").innerHTML = list.length
        ? list.map((x) => `<tr><td>${esc(fmtDate(x.createdAt))}</td><th scope="row">${esc(x.username)}</th><td>${x.provider === "stripe" ? "Tarjeta (Stripe)" : "PayPal"}</td><td>${esc(money(x.amount, x.currency))}</td><td>${esc(fmtDate(x.paidUntil))}</td></tr>`).join("")
        : '<tr><td colspan="5">Todavía no hay pagos.</td></tr>';
    } catch (err) {
      handleError(err);
    }
  }

  /* ---- Copias y GitHub ---- */
  async function renderGithub() {
    try {
      const s = await API.get("/api/admin/github");
      $("github-status").innerHTML = s.configured
        ? `Repositorio: <code>${esc(s.repo)}</code> (rama <code>${esc(s.branch)}</code>). Se guarda solo cada ${s.intervalHours} horas.<br>
           Cambios pendientes: <strong>${s.pending.length}</strong>.<br>Última vez: ${s.last.at ? esc(fmtDate(s.last.at)) + " — " : ""}${esc(s.last.message)}`
        : "El guardado en GitHub no está configurado en el servidor (faltan GITHUB_TOKEN y GITHUB_REPO). Los cambios se guardan en el servidor igualmente.";
      $("btn-github-sync").disabled = !s.configured;
    } catch (err) {
      handleError(err);
    }
  }

  function renderImportReport(report) {
    const block = (title, icon, list, cls) =>
      list.length ? `<section class="report-block ${cls}"><h3><span aria-hidden="true">${icon}</span> ${esc(title)} (${list.length})</h3><ul>${list.map((i) => `<li><strong>${esc(i.name)}</strong> ${esc(i.why)}</li>`).join("")}</ul></section>` : "";
    const box = $("import-report");
    box.innerHTML = `<h2 class="section-title">Resultado de la carga</h2>
      ${block("Publicados", "✅", report.added, "report-ok")}
      ${block("No publicados: sin utilidad educativa o enlace no válido", "⛔", report.rejected, "report-bad")}
      ${block("No publicados: ya existían", "⚠️", report.duplicated, "report-warn")}
      ${block("Necesitan una sección nueva: añádelos uno a uno en «Añadir recurso»", "💡", report.needsCategory, "report-info")}
      ${block("Les faltan datos", "✏️", report.invalid, "report-warn")}`;
    box.hidden = false;
    box.focus();
  }

  /** Convierte un CSV (nombre, url, descripción, etapas, áreas, DOK, metodología, accesibilidad, coste) en recursos. */
  function parseCSV(text) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
    const inner = sep === ";" ? "|" : ";";
    const split = (line) => {
      const out = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === sep) {
          out.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const list = (v) => (v ? v.split(inner).map((s) => s.trim()).filter(Boolean) : []);
    return lines.slice(1).map(split).filter((c) => c.length >= 3).map((c) => ({ name: c[0], url: c[1], description: c[2], areas: list(c[4]), dokLevel: parseInt(c[5], 10) || 0, methodology: c[6] || "", accessibilityFeatures: list(c[7]), cost: c[8] || "Por confirmar" }));
  }

  function setupBackup() {
    $("btn-github-sync").addEventListener("click", async () => {
      $("btn-github-sync").disabled = true;
      try {
        const r = await API.post("/api/admin/github/sincronizar");
        toast(r.ok ? `✅ ${r.message}` : `⛔ ${r.message}`, r.ok ? "ok" : "error");
      } catch (err) {
        handleError(err);
      }
      renderGithub();
    });
    $("import-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        let payload;
        if (file.name.toLowerCase().endsWith(".csv")) payload = { resources: parseCSV(text) };
        else {
          const data = JSON.parse(text);
          payload = Array.isArray(data) ? { resources: data } : data;
        }
        if (!payload.resources || !payload.resources.length) throw new Error("El archivo no tiene recursos.");
        if (Array.isArray(payload.categories)) {
          confirmAction("¿Restaurar esta copia de seguridad?", `La copia tiene ${payload.resources.length} recursos y ${payload.categories.length} categorías. Se cambiará todo el catálogo actual por la copia.`, "Sí, restaurar", async () => {
            await API.post("/api/admin/importar", { restore: true, categories: payload.categories, resources: payload.resources });
            await loadCatalog();
            toast("Copia restaurada.");
            return null;
          });
        } else {
          const r = await API.post("/api/admin/importar", { resources: payload.resources });
          await loadCatalog();
          renderImportReport(r.report);
        }
      } catch (err) {
        if (err.status) handleError(err);
        else toast(`No se pudo cargar el archivo: ${err.message}`, "error");
      } finally {
        e.target.value = "";
      }
    });
  }

  /* ==========================================================================
   * ARRANQUE
   * ======================================================================== */
  async function start() {
    applyPrefs();
    setupSession();
    try {
      SERVER = await API.get("/api/config");
    } catch (err) {
      $("view-loading").textContent = `⛔ ${err.message}`;
      return;
    }
    CFG = SERVER.config;
    setupCatalog();
    setupCourses();
    setupResourceForm();
    setupTabs();
    setupAdminList();
    setupCategoriesAdmin();
    setupUsers();
    setupCoursesAdmin();
    setupBackup();
    try {
      const s = await API.get("/api/sesion");
      await enterApp(s.user);
    } catch {
      showLogin();
    }
    // Acceso para las pruebas automáticas (no se usa en la interfaz)
    window.__eduApp = { getCatalog: () => catalog.resources, getCategories: () => catalog.categories, getUser: () => me };
  }
  start();
});
