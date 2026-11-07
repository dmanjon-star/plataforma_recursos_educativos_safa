/**
 * ============================================================================
 *  app.js — Controlador de la interfaz
 * ============================================================================
 *  Partes:
 *    A. Estado y arranque
 *    B. Utilidades de interfaz (avisos, diálogo, notificación breve)
 *    C. Navegación entre vistas (#catalogo, #admin, #ayuda) e inicio de sesión
 *    D. Catálogo: búsqueda, filtros (AND) y fichas agrupadas por categoría
 *    E. Administración · formulario de recurso y revisión automática
 *    F. Administración · lista de recursos
 *    G. Administración · categorías y secciones
 *    H. Administración · cuentas
 *    I. Administración · copias, importación y restauración
 *
 *  Regla de seguridad: todo texto que viene de usuarios o de archivos se
 *  pinta con EduUtils.escapeHtml() y todo enlace con EduUtils.safeHref().
 *  Regla de permisos: cada acción que cambia datos llama a EduAuth.require().
 * ============================================================================
 */
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const U = window.EduUtils;
  const S = window.EduStorage;
  const A = window.EduAuth;
  const C = window.EduClassifier;
  const CFG = window.EDU_CONFIG;
  const esc = U.escapeHtml;
  const $ = (id) => document.getElementById(id);

  /* ==========================================================================
   * A. ESTADO Y ARRANQUE
   * ======================================================================== */
  let catalog = [];
  let categories = [];
  let prefs = S.loadPrefs();

  const ui = {
    expanded: new Set(), // secciones del catálogo abiertas con «Ver todos»
    adminLimit: 25, // filas visibles en la lista de administración
    editingId: null, // id del recurso que se está editando
    pending: null, // recurso revisado pendiente de publicar
    pendingFile: null // archivo subido en el formulario
  };

  /** Número de fichas que se ven por sección antes de pulsar «Ver todos». */
  const CARDS_PER_SECTION = 6;

  function loadData() {
    A.init();
    catalog = S.loadCatalog();
    categories = S.loadCategories();
  }

  /* ==========================================================================
   * B. UTILIDADES DE INTERFAZ
   * ======================================================================== */

  /** Anuncia un mensaje a los lectores de pantalla. */
  function announce(text) {
    const box = $("sr-announcer");
    box.textContent = "";
    setTimeout(() => (box.textContent = text), 60);
  }

  /** Muestra una notificación breve en pantalla (y la anuncia). */
  let toastTimer = null;
  function toast(text, type = "ok") {
    const box = $("toast");
    box.className = `toast toast-${type}`;
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (box.hidden = true), 5000);
  }

  /**
   * Abre la ventana de diálogo reutilizable.
   * @param {Object} o
   * @param {string} o.title - Título.
   * @param {string} o.bodyHtml - Contenido (HTML ya escapado).
   * @param {string} [o.confirmText] - Texto del botón principal.
   * @param {boolean} [o.danger] - Botón principal en rojo.
   * @param {boolean} [o.hideCancel] - Solo un botón.
   * @param {Function} [o.onConfirm] - Recibe el <form>. Si devuelve un texto,
   *        se muestra como error y la ventana NO se cierra.
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
    $("dialog-cancel").hidden = Boolean(o.hideCancel);

    const close = () => {
      dialog.close();
      if (returnFocus && document.body.contains(returnFocus)) returnFocus.focus();
    };
    $("dialog-cancel").onclick = close;
    $("dialog-close").onclick = close;
    $("dialog-form").onsubmit = (e) => {
      e.preventDefault();
      let error = null;
      try {
        error = o.onConfirm ? o.onConfirm($("dialog-form")) : null;
      } catch (err) {
        error = err.message;
      }
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

  /** Pregunta Sí/No antes de hacer algo que no se puede deshacer. */
  function confirmAction(title, message, confirmText, onYes) {
    openDialog({
      title,
      bodyHtml: `<p class="dialog-message">${esc(message)}</p>`,
      confirmText,
      danger: true,
      onConfirm: () => {
        onYes();
        return null;
      }
    });
  }

  /** Guarda el catálogo y avisa si el navegador no tiene espacio. */
  function persistCatalog() {
    if (!S.saveCatalog(catalog)) {
      toast("No se ha podido guardar: el navegador no tiene espacio. Borra archivos grandes o descarga una copia.", "error");
      return false;
    }
    return true;
  }

  function persistCategories() {
    if (!S.saveCategories(categories)) {
      toast("No se han podido guardar las categorías.", "error");
      return false;
    }
    return true;
  }

  /** Busca una subcategoría por nombres. */
  function findSub(categoryName, subName) {
    const cat = categories.find((c) => c.name === categoryName);
    const sub = cat && cat.subcategories.find((s) => s.name === subName);
    return sub ? { cat, sub } : null;
  }

  /** Resume una lista de cursos: «1º a 3º Primaria», «Infantil (3 a 5 años)». */
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

  /** Rellena un <select> con opciones. */
  function fillSelect(select, options, firstLabel) {
    const current = select.value;
    select.innerHTML =
      (firstLabel !== undefined ? `<option value="">${esc(firstLabel)}</option>` : "") +
      options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
    if ([...select.options].some((opt) => opt.value === current)) select.value = current;
  }

  /** Crea casillas de verificación. */
  function fillChecks(container, name, values) {
    container.innerHTML = values
      .map((v, i) => {
        const id = `${name}-${i}`;
        return `<label class="check-item" for="${id}"><input type="checkbox" id="${id}" name="${name}" value="${esc(v)}"> <span>${esc(v)}</span></label>`;
      })
      .join("");
  }

  const checkedValues = (container) => [...container.querySelectorAll("input:checked")].map((i) => i.value);
  const setChecked = (container, values) =>
    container.querySelectorAll("input").forEach((i) => (i.checked = (values || []).includes(i.value)));

  /* ==========================================================================
   * C. NAVEGACIÓN E INICIO DE SESIÓN
   * ======================================================================== */

  /** Aplica alto contraste y letra grande. */
  function applyPrefs() {
    document.body.classList.toggle("high-contrast", Boolean(prefs.highContrast));
    // La letra grande se aplica en <html> para que todos los tamaños en rem crezcan
    document.documentElement.classList.toggle("large-text", Boolean(prefs.largeText));
    document.querySelectorAll(".js-toggle-contrast").forEach((b) => b.setAttribute("aria-pressed", String(Boolean(prefs.highContrast))));
    document.querySelectorAll(".js-toggle-text").forEach((b) => b.setAttribute("aria-pressed", String(Boolean(prefs.largeText))));
  }

  function showLogin() {
    $("toast").hidden = true;
    $("app-shell").hidden = true;
    $("view-login").hidden = false;
    document.title = "Entrar | Recursos SAFA";
    document.querySelector(".demo-accounts").hidden = !A.demoAccountsActive();
    $("login-user").focus();
  }

  /** Muestra la vista que indica la dirección (#catalogo, #admin, #ayuda). */
  function route() {
    const user = A.currentUser();
    if (!user) return showLogin();

    $("view-login").hidden = true;
    $("app-shell").hidden = false;
    $("user-badge").innerHTML = `<span aria-hidden="true">👤</span> ${esc(user.displayName)} <span class="role-tag">${A.isAdmin() ? "Administración" : "Docente"}</span>`;
    document.querySelectorAll("[data-admin-only]").forEach((el) => (el.hidden = !A.isAdmin()));

    let view = (location.hash || "#catalogo").slice(1);
    if (view === "admin" && !A.isAdmin()) {
      toast("Esa parte es solo para administración.", "error");
      view = "catalogo";
      history.replaceState(null, "", "#catalogo");
    }
    if (!["catalogo", "admin", "ayuda"].includes(view)) view = "catalogo";

    const views = { catalogo: "view-catalog", admin: "view-admin", ayuda: "view-help" };
    const titles = { catalogo: "Catálogo", admin: "Administrar", ayuda: "Ayuda" };
    Object.entries(views).forEach(([k, id]) => ($(id).hidden = k !== view));
    document.querySelectorAll(".nav-link").forEach((a) => {
      if (a.dataset.route === view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.title = `${titles[view]} | Recursos SAFA`;

    if (view === "catalogo") renderCatalog();
    if (view === "admin") renderAdmin();
  }

  function setupLogin() {
    $("login-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const result = A.login($("login-user").value, $("login-pass").value);
      const err = $("login-error");
      if (!result.ok) {
        err.textContent = result.message;
        err.hidden = false;
        $("login-pass").value = "";
        $("login-pass").focus();
        return;
      }
      err.hidden = true;
      $("toast").hidden = true;
      $("login-form").reset();
      if (!location.hash) history.replaceState(null, "", "#catalogo");
      route();
      $("main-content").focus();
      announce(`Hola, ${result.user.displayName}. Estás en el catálogo de recursos.`);
    });

    $("btn-toggle-pass").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const show = $("login-pass").type === "password";
      $("login-pass").type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", String(show));
      btn.querySelector(".btn-label").textContent = show ? "Ocultar" : "Ver";
    });

    $("btn-logout").addEventListener("click", () => {
      A.logout();
      history.replaceState(null, "", location.pathname);
      showLogin();
      announce("Has salido de la plataforma.");
    });

    $("btn-my-password").addEventListener("click", () => {
      const user = A.currentUser();
      openDialog({
        title: "Cambiar mi contraseña",
        bodyHtml: `
          <div class="form-field">
            <label for="dlg-pass1" class="field-label">Contraseña nueva</label>
            <input type="password" id="dlg-pass1" class="form-control" autocomplete="new-password" aria-describedby="dlg-pass-hint">
            <p id="dlg-pass-hint" class="field-hint">8 caracteres o más, con algún número.</p>
          </div>
          <div class="form-field">
            <label for="dlg-pass2" class="field-label">Repite la contraseña</label>
            <input type="password" id="dlg-pass2" class="form-control" autocomplete="new-password">
          </div>`,
        confirmText: "Guardar contraseña",
        onConfirm: () => {
          if ($("dlg-pass1").value !== $("dlg-pass2").value) return "Las dos contraseñas no son iguales.";
          const r = A.changePassword(user.userId, $("dlg-pass1").value);
          if (!r.ok) return r.message;
          toast(r.message);
          return null;
        }
      });
    });

    document.querySelectorAll(".js-toggle-contrast").forEach((b) =>
      b.addEventListener("click", () => {
        prefs.highContrast = !prefs.highContrast;
        S.savePrefs(prefs);
        applyPrefs();
        announce(prefs.highContrast ? "Alto contraste activado." : "Alto contraste desactivado.");
      })
    );
    document.querySelectorAll(".js-toggle-text").forEach((b) =>
      b.addEventListener("click", () => {
        prefs.largeText = !prefs.largeText;
        S.savePrefs(prefs);
        applyPrefs();
        announce(prefs.largeText ? "Letra grande activada." : "Letra normal.");
      })
    );

    window.addEventListener("hashchange", route);
  }

  /* ==========================================================================
   * D. CATÁLOGO
   * ======================================================================== */
  const filterIds = ["filter-category", "filter-subcategory", "filter-area", "filter-grade", "filter-stage", "filter-dok", "filter-udl", "filter-cost"];

  /** Rellena los desplegables de filtros. */
  function populateFilters() {
    fillSelect($("filter-category"), categories.map((c) => ({ value: c.name, label: `${c.icon} ${c.name}` })), "Todas las categorías");
    populateSubFilter();
    fillSelect($("filter-area"), CFG.SUBJECTS.map((s) => ({ value: s, label: s })), "Todas las materias");
    fillSelect($("filter-grade"), CFG.GRADES.map((g) => ({ value: g, label: g })), "Todos los cursos");
    fillSelect($("filter-dok"), Object.entries(CFG.DOK_LEVELS).map(([v, l]) => ({ value: v, label: l })), "Cualquier tipo");
    fillSelect($("filter-udl"), CFG.UDL_PRINCIPLES.map((p) => ({ value: p, label: p })), "Todos los principios");
    fillSelect($("filter-cost"), CFG.COSTS.map((c) => ({ value: c, label: c })), "Cualquier precio");
  }

  /** La lista de secciones depende de la categoría elegida. */
  function populateSubFilter() {
    const catName = $("filter-category").value;
    const cats = catName ? categories.filter((c) => c.name === catName) : categories;
    const options = cats.flatMap((c) => c.subcategories.map((s) => ({ value: `${c.name}|||${s.name}`, label: `${s.icon} ${s.name}` })));
    fillSelect($("filter-subcategory"), options, "Todas las secciones");
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

  /** Texto en el que se busca (nombre, descripción, sección, materia…). */
  function searchCorpus(r) {
    if (!r._corpus) {
      Object.defineProperty(r, "_corpus", {
        enumerable: false, // no se guarda en LocalStorage
        writable: true,
        value: U.normalizeText(
          [r.name, r.description, r.category, r.subcategory, r.methodology, r.activityType, r.linkType,
            ...(r.areas || []), ...(r.grades || []), ...(r.supportNeeds || []), ...(r.accessibilityFeatures || [])].join(" ")
        )
      });
    }
    return r._corpus;
  }

  /**
   * Filtrado facetado: un recurso se muestra solo si cumple TODOS los
   * filtros activos (conjunción AND, como dice el documento).
   */
  function applyFilters(list, f, ignoreCategory = false) {
    const words = f.text ? f.text.split(" ") : [];
    return list.filter((r) => {
      if (words.length) {
        const corpus = searchCorpus(r);
        if (!words.every((w) => corpus.includes(w))) return false;
      }
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

  /** Botones grandes de categorías con su número de recursos. */
  function renderCategoryTiles(f) {
    const base = applyFilters(catalog, { ...f, subcategory: "", subCategory: "" }, true);
    const tiles = [{ name: "", icon: "🌈", label: "Todas", count: base.length }].concat(
      categories.map((c) => ({ name: c.name, icon: c.icon, label: c.name, count: base.filter((r) => r.category === c.name).length }))
    );
    $("category-tiles").innerHTML = tiles
      .map(
        (t) => `<li><button type="button" class="category-tile" data-category="${esc(t.name)}" aria-pressed="${f.category === t.name}">
          <span class="tile-icon" aria-hidden="true">${esc(t.icon)}</span>
          <span class="tile-name">${esc(t.label)}</span>
          <span class="tile-count">${t.count} recursos</span></button></li>`
      )
      .join("");
  }

  /** HTML de una ficha de recurso. */
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
      ? `<a class="btn btn-primary btn-lg" href="${esc(U.safeHref(r.url))}" target="_blank" rel="noopener noreferrer">
           <span aria-hidden="true">🔗</span> Abrir<span class="visually-hidden"> ${esc(r.name)} (se abre en una pestaña nueva)</span></a>`
      : "";
    const download = r.file
      ? `<button type="button" class="btn btn-success btn-lg" data-action="download" data-id="${esc(r.id)}">
           <span aria-hidden="true">⬇️</span> Descargar archivo<span class="visually-hidden"> de ${esc(r.name)}</span></button>`
      : "";
    const adminButtons = A.isAdmin()
      ? `<button type="button" class="btn btn-outline" data-action="edit" data-id="${esc(r.id)}"><span aria-hidden="true">✏️</span> Editar<span class="visually-hidden"> ${esc(r.name)}</span></button>
         <button type="button" class="btn btn-outline btn-outline-danger" data-action="delete" data-id="${esc(r.id)}"><span aria-hidden="true">🗑️</span> Borrar<span class="visually-hidden"> ${esc(r.name)}</span></button>`
      : "";

    return `<article class="card resource-card" aria-labelledby="h-${esc(r.id)}">
      <div class="card-top">
        <span class="card-type"><span aria-hidden="true">${typeIcon}</span> ${esc(r.file && !r.url ? "Archivo" : r.linkType || "Página web")}</span>
        ${r.interest === "Alta" ? '<span class="badge badge-star"><span aria-hidden="true">⭐</span> Muy recomendado</span>' : ""}
      </div>
      <h4 class="card-title" id="h-${esc(r.id)}">${esc(r.name)}</h4>
      <p class="card-description">${esc(r.description)}</p>
      <ul class="card-meta">
        <li><span aria-hidden="true">🎒</span> <span class="meta-label">Curso:</span> ${esc(gradeSummary(r.grades))}</li>
        <li><span aria-hidden="true">📖</span> <span class="meta-label">Materia:</span> ${esc((r.areas || []).join(", ") || "Sin indicar")}</li>
        <li><span aria-hidden="true">${esc(sub ? sub.sub.icon : "📂")}</span> <span class="meta-label">Sección:</span> ${esc(r.subcategory || "Sin sección")}</li>
      </ul>
      <details class="card-details">
        <summary>Más información</summary>
        <dl>${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      </details>
      <div class="card-actions">${open}${download}${adminButtons}</div>
    </article>`;
  }

  /** Pinta el catálogo agrupado por categoría y sección. */
  function renderCatalog() {
    const f = getFilters();
    renderCategoryTiles(f);
    const results = applyFilters(catalog, f);
    const anyFilter = Object.values(f).some(Boolean);
    const showAll = results.length <= 24;

    $("results-count").textContent = anyFilter
      ? `Hemos encontrado ${results.length} de ${catalog.length} recursos.`
      : `Hay ${catalog.length} recursos. Busca o elige una categoría.`;

    if (!results.length) {
      $("catalog-results").innerHTML = `<div class="empty-state">
        <p class="empty-icon" aria-hidden="true">🔎</p>
        <p><strong>No hay recursos con estos filtros.</strong></p>
        <p>Prueba con otra palabra o quita algún filtro.</p>
        <button type="button" class="btn btn-primary btn-lg" data-action="reset-filters"><span aria-hidden="true">🧹</span> Quitar filtros</button>
      </div>`;
      return;
    }

    // Agrupar respetando el orden de las categorías
    const known = new Set();
    let html = "";
    for (const cat of categories) {
      const inCat = results.filter((r) => r.category === cat.name);
      if (!inCat.length) continue;
      html += `<section class="category-block" aria-labelledby="cat-${esc(cat.id)}">
        <h2 class="category-heading" id="cat-${esc(cat.id)}"><span aria-hidden="true">${esc(cat.icon)}</span> ${esc(cat.name)} <span class="count-pill">${inCat.length}</span></h2>`;
      for (const sub of cat.subcategories) {
        const items = inCat
          .filter((r) => r.subcategory === sub.name)
          .sort((a, b) => (b.interest === "Alta") - (a.interest === "Alta") || a.name.localeCompare(b.name, "es"));
        if (!items.length) continue;
        items.forEach((r) => known.add(r.id));
        const key = `${cat.id}/${sub.id}`;
        const visible = showAll || ui.expanded.has(key) ? items : items.slice(0, CARDS_PER_SECTION);
        html += `<section class="sub-block" aria-labelledby="sub-${esc(sub.id)}">
          <h3 class="sub-heading" id="sub-${esc(sub.id)}"><span aria-hidden="true">${esc(sub.icon)}</span> ${esc(sub.name)} <span class="count-pill">${items.length}</span></h3>
          <div class="resources-grid">${visible.map(cardHtml).join("")}</div>
          ${visible.length < items.length
            ? `<button type="button" class="btn btn-outline btn-lg btn-more" data-action="expand" data-key="${esc(key)}">
                 <span aria-hidden="true">👀</span> Ver los ${items.length} recursos de «${esc(sub.name)}»</button>`
            : ""}
        </section>`;
      }
      html += "</section>";
    }
    // Recursos cuya sección ya no existe (por ejemplo, tras importar)
    const orphans = results.filter((r) => !known.has(r.id));
    if (orphans.length) {
      html += `<section class="category-block" aria-labelledby="cat-otros">
        <h2 class="category-heading" id="cat-otros"><span aria-hidden="true">📦</span> Otros <span class="count-pill">${orphans.length}</span></h2>
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

  /** Descarga del archivo adjunto de un recurso. */
  function downloadFile(id) {
    A.require("resource:download");
    const r = catalog.find((x) => x.id === id);
    if (!r || !r.file) return;
    const link = document.createElement("a");
    link.href = U.safeHref(r.file.dataUrl);
    link.download = r.file.name || "recurso";
    document.body.appendChild(link);
    link.click();
    link.remove();
    announce(`Descargando ${r.file.name}.`);
  }

  function setupCatalog() {
    populateFilters();

    $("search-form").addEventListener("submit", (e) => {
      e.preventDefault();
      renderCatalog();
      announce($("results-count").textContent);
    });
    // Búsqueda mientras se escribe (con una pequeña espera)
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
      const list = applyFilters(catalog, getFilters());
      S.exportToCSV(list);
      toast(`Descargando una lista con ${list.length} recursos.`);
    });

    $("category-tiles").addEventListener("click", (e) => {
      const tile = e.target.closest(".category-tile");
      if (!tile) return;
      $("filter-category").value = tile.dataset.category;
      populateSubFilter();
      renderCatalog();
      announce($("results-count").textContent);
      const focusTile = $("category-tiles").querySelector(`[data-category="${CSS.escape(tile.dataset.category)}"]`);
      if (focusTile) focusTile.focus();
    });

    // Botones dentro de las fichas (delegación de eventos)
    $("catalog-results").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id, key } = btn.dataset;
      try {
        if (action === "expand") {
          ui.expanded.add(key);
          renderCatalog();
          announce("Se muestran todos los recursos de la sección.");
        } else if (action === "reset-filters") resetFilters();
        else if (action === "download") downloadFile(id);
        else if (action === "edit") startEdit(id);
        else if (action === "delete") askDeleteResource(id);
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  /* ==========================================================================
   * E. FORMULARIO DE RECURSO Y REVISIÓN AUTOMÁTICA
   * ======================================================================== */
  function setupResourceForm() {
    fillChecks($("res-areas"), "res-area", CFG.SUBJECTS);
    fillChecks($("res-grades"), "res-grade", CFG.GRADES);
    fillChecks($("res-udl"), "res-udl", CFG.UDL_PRINCIPLES);
    fillSelect($("res-dok"), Object.entries(CFG.DOK_LEVELS).map(([v, l]) => ({ value: v, label: l })), "Que lo proponga el sistema");
    fillSelect($("res-cost"), CFG.COSTS.map((c) => ({ value: c, label: c })));
    $("res-cost").value = "Por confirmar";

    $("res-desc").addEventListener("input", () => {
      $("res-desc-count").textContent = `${$("res-desc").value.length} / 400`;
    });

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
        ui.pendingFile = { name: file.name, type: file.type, size: file.size, dataUrl: reader.result };
        $("res-file-info").textContent = `✅ Archivo listo: ${file.name} (${Math.round(file.size / 1024)} KB)`;
      };
      reader.readAsDataURL(file);
    });

    $("resource-form").addEventListener("submit", (e) => {
      e.preventDefault();
      try {
        A.require(ui.editingId ? "resource:update" : "resource:create");
        reviewResource();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    $("btn-clear-form").addEventListener("click", () => clearForm(true));
    $("btn-cancel-edit").addEventListener("click", () => {
      clearForm(true);
      location.hash = "#catalogo";
    });
  }

  /** Lee el formulario y crea el objeto recurso (modelo del documento). */
  function readForm() {
    const previous = ui.editingId ? catalog.find((r) => r.id === ui.editingId) : null;
    const list = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
    const file = ui.pendingFile || (previous && previous.file) || null;
    const url = $("res-url").value.trim();
    return {
      ...(previous || {}),
      id: ui.editingId || U.uid("rec"),
      name: $("res-name").value.trim(),
      url,
      description: $("res-desc").value.trim(),
      areas: checkedValues($("res-areas")),
      grades: checkedValues($("res-grades")),
      dokLevel: parseInt($("res-dok").value, 10) || 0,
      methodology: $("res-methodology").value.trim(),
      accessibilityFeatures: list($("res-accessibility").value),
      udlPrinciples: checkedValues($("res-udl")),
      cost: $("res-cost").value || "Por confirmar",
      language: $("res-language").value.trim() || "Español",
      license: $("res-license").value.trim(),
      file,
      linkType: file && !url ? "Archivo subido" : /\.pdf($|\?)/i.test(url) ? "Documento PDF" : /youtu/.test(url) ? "Vídeo" : /github\.com/.test(url) ? "Repositorio de código" : "Página web"
    };
  }

  /** Rellena el formulario para editar un recurso. */
  function fillForm(r) {
    $("res-id").value = r.id;
    $("res-name").value = r.name || "";
    $("res-url").value = r.url || "";
    $("res-desc").value = r.description || "";
    $("res-desc-count").textContent = `${(r.description || "").length} / 400`;
    setChecked($("res-areas"), r.areas);
    setChecked($("res-grades"), r.grades);
    setChecked($("res-udl"), r.udlPrinciples);
    $("res-dok").value = r.dokLevel ? String(r.dokLevel) : "";
    $("res-methodology").value = r.methodology || "";
    $("res-accessibility").value = (r.accessibilityFeatures || []).join(", ");
    $("res-cost").value = CFG.COSTS.includes(r.cost) ? r.cost : "Por confirmar";
    $("res-language").value = r.language && r.language !== "Por confirmar" ? r.language : "";
    $("res-license").value = r.license || "";
    $("res-file").value = "";
    $("res-file-info").textContent = r.file ? `📎 Archivo actual: ${r.file.name}. Sube otro solo si quieres cambiarlo.` : "";
  }

  function clearForm(focus) {
    ui.editingId = null;
    ui.pending = null;
    ui.pendingFile = null;
    $("resource-form").reset();
    $("res-cost").value = "Por confirmar";
    $("res-desc-count").textContent = "0 / 400";
    $("res-file-info").textContent = "";
    $("resource-form-title").textContent = "Añadir un recurso nuevo";
    $("btn-cancel-edit").hidden = true;
    $("analysis-panel").hidden = true;
    showFieldErrors([]);
    if (focus) $("res-name").focus();
  }

  /** Abre el formulario con los datos de un recurso. */
  function startEdit(id) {
    A.require("resource:update");
    const r = catalog.find((x) => x.id === id);
    if (!r) return;
    location.hash = "#admin";
    route();
    selectTab("tab-add");
    clearForm(false);
    ui.editingId = id;
    fillForm(r);
    $("resource-form-title").textContent = `Editar: ${r.name}`;
    $("btn-cancel-edit").hidden = false;
    $("res-name").focus();
    announce(`Editando ${r.name}.`);
  }

  /** Marca los campos con error y explica qué falta. */
  function showFieldErrors(errors) {
    ["res-name", "res-url", "res-desc"].forEach((id) => {
      const err = errors.find((e) => e.field === id);
      const box = $(`${id}-error`);
      $(id).setAttribute("aria-invalid", String(Boolean(err)));
      box.hidden = !err;
      box.textContent = err ? `⚠️ ${err.message}` : "";
    });
    if (errors.length) {
      $(errors[0].field).focus();
      announce(`Falta información: ${errors.map((e) => e.message).join(" ")}`);
    }
  }

  /** Opciones de todas las secciones para un desplegable. */
  function subOptionsHtml(selectedCat, selectedSub) {
    return categories
      .map(
        (c) =>
          `<optgroup label="${esc(c.icon + " " + c.name)}">${c.subcategories
            .map((s) => {
              const v = `${c.name}|||${s.name}`;
              return `<option value="${esc(v)}" ${c.name === selectedCat && s.name === selectedSub ? "selected" : ""}>${esc(s.icon + " " + s.name)}</option>`;
            })
            .join("")}</optgroup>`
      )
      .join("");
  }

  /** Paso principal: revisa el recurso y muestra el resultado. */
  function reviewResource(skipDuplicate = false) {
    const record = readForm();
    const result = C.analyze(record, { catalog, categories, ignoreId: ui.editingId, skipDuplicate });
    if (result.status === "invalid") {
      $("analysis-panel").hidden = true;
      showFieldErrors(result.errors);
      return;
    }
    showFieldErrors([]);
    ui.pending = { record, result };
    renderAnalysis(record, result);
  }

  /** Pinta el panel con el resultado de la revisión. */
  function renderAnalysis(record, result) {
    const panel = $("analysis-panel");
    let html = "";

    if (result.status === "rejected") {
      const v = result.validation;
      panel.className = "analysis-panel analysis-danger";
      html = `<div role="alert">
        <h3 id="analysis-title" class="analysis-title"><span aria-hidden="true">⛔</span> ${esc(v.title)}</h3>
        <p><strong>Motivo:</strong> ${esc(v.message)}</p>
        <p><strong><span aria-hidden="true">💡</span> ¿Qué puedo hacer?</strong> ${esc(v.tip)}</p>
        <p class="analysis-note">El recurso <strong>no se ha publicado</strong>.</p>
      </div>
      <div class="analysis-actions">
        <button type="button" class="btn btn-primary btn-lg" data-analysis="fix"><span aria-hidden="true">✏️</span> Corregir el recurso</button>
        <button type="button" class="btn btn-outline btn-lg" data-analysis="discard"><span aria-hidden="true">🗑️</span> Descartar</button>
      </div>`;
    } else if (result.status === "duplicate") {
      const d = result.duplicate;
      panel.className = "analysis-panel analysis-warning";
      html = `<div role="alert">
        <h3 id="analysis-title" class="analysis-title"><span aria-hidden="true">⚠️</span> Puede que este recurso ya exista</h3>
        <p>${esc(d.reason)}</p>
        <div class="duplicate-matches">
          <p><strong>Recurso que ya está:</strong> ${esc(d.matchResource.name)}</p>
          <p><strong>Enlace:</strong> <code>${esc(d.matchResource.url || "(archivo)")}</code></p>
          <p><strong>Sección:</strong> ${esc(d.matchResource.subcategory || "")}</p>
        </div>
        <p>¿Qué quieres hacer?</p>
      </div>
      <div class="analysis-actions">
        <button type="button" class="btn btn-outline btn-lg" data-analysis="discard"><span aria-hidden="true">🗑️</span> Descartar</button>
        <button type="button" class="btn btn-primary btn-lg" data-analysis="variant"><span aria-hidden="true">🔀</span> Guardar como variante</button>
        <button type="button" class="btn btn-danger btn-lg" data-analysis="force"><span aria-hidden="true">💾</span> Guardar igualmente</button>
      </div>`;
    } else if (result.status === "classified") {
      const b = result.classification.best;
      const editing = ui.editingId && catalog.find((r) => r.id === ui.editingId);
      // Al editar, se mantiene la sección actual salvo que el administrador la cambie
      const selCat = editing ? editing.category : b.categoryName;
      const selSub = editing ? editing.subcategory : b.subcategoryName;
      const sub = findSub(b.categoryName, b.subcategoryName);
      const preview = C.applyDefaults(record, sub && sub.sub);
      panel.className = "analysis-panel analysis-success";
      html = `<h3 id="analysis-title" class="analysis-title"><span aria-hidden="true">✅</span> ¡Todo bien! Este recurso sirve para clase</h3>
        <p class="placement">El sistema lo coloca en:<br>
          <strong class="placement-path"><span aria-hidden="true">${esc(sub ? sub.cat.icon : "")}</span> ${esc(b.categoryName)} › <span aria-hidden="true">${esc(b.icon)}</span> ${esc(b.subcategoryName)}</strong></p>
        <p class="analysis-note">Seguridad: ${b.confidence} %. Pistas: ${esc(b.words.join(", "))}.</p>
        ${editing && (editing.category !== b.categoryName || editing.subcategory !== b.subcategoryName)
          ? `<p class="analysis-note">Ahora está en «${esc(editing.subcategory)}». Se mantiene salvo que elijas otra.</p>` : ""}
        <ul class="analysis-summary">
          <li><span aria-hidden="true">📖</span> Materia: ${esc(preview.areas.join(", "))}${record.areas.length ? "" : " <em>(propuesta)</em>"}</li>
          <li><span aria-hidden="true">🎒</span> Curso: ${esc(gradeSummary(preview.grades))}${record.grades.length ? "" : " <em>(propuesto)</em>"}</li>
        </ul>
        <div class="form-field">
          <label for="analysis-sub" class="field-label">¿Prefieres otra sección? Puedes cambiarla aquí:</label>
          <select id="analysis-sub" class="form-control">${subOptionsHtml(selCat, selSub)}</select>
        </div>
        <div class="analysis-actions">
          <button type="button" class="btn btn-success btn-xl" data-analysis="publish"><span aria-hidden="true">📤</span> ${editing ? "Guardar cambios" : "Publicar recurso"}</button>
          <button type="button" class="btn btn-outline btn-lg" data-analysis="fix"><span aria-hidden="true">✏️</span> Seguir editando</button>
        </div>`;
    } else if (result.status === "new-category") {
      const p = result.proposal;
      panel.className = "analysis-panel analysis-info";
      html = `<h3 id="analysis-title" class="analysis-title"><span aria-hidden="true">💡</span> Es educativo, pero no encaja en ninguna sección</h3>
        <p>${esc(p.reason)}</p>
        <p><strong>Te proponemos crear una sección nueva.</strong> Revisa el nombre y las palabras clave.</p>
        <div class="form-row">
          <div class="form-field">
            <label for="prop-name" class="field-label required">Nombre de la sección nueva</label>
            <input type="text" id="prop-name" class="form-control" value="${esc(p.name)}" maxlength="70">
          </div>
          <div class="form-field">
            <label for="prop-cat" class="field-label">Dentro de la categoría</label>
            <select id="prop-cat" class="form-control">${categories
              .map((c) => `<option value="${esc(c.id)}" ${c.id === p.categoryId ? "selected" : ""}>${esc(c.icon + " " + c.name)}</option>`)
              .join("")}</select>
          </div>
        </div>
        <div class="form-field">
          <label for="prop-keywords" class="field-label">Criterios: palabras clave (separadas por comas)</label>
          <p id="prop-keywords-hint" class="field-hint">Los recursos nuevos con estas palabras irán a esta sección.</p>
          <input type="text" id="prop-keywords" class="form-control" value="${esc(p.keywords.join(", "))}" aria-describedby="prop-keywords-hint">
        </div>
        <div id="prop-error" class="alert alert-danger" role="alert" hidden></div>
        <div class="analysis-actions">
          <button type="button" class="btn btn-success btn-lg" data-analysis="create-and-publish"><span aria-hidden="true">✅</span> Crear sección y publicar</button>
        </div>
        <details class="analysis-alt">
          <summary>Prefiero usar una sección que ya existe</summary>
          <div class="form-field">
            <label for="analysis-sub" class="field-label">Sección</label>
            <select id="analysis-sub" class="form-control">${subOptionsHtml()}</select>
          </div>
          <button type="button" class="btn btn-primary btn-lg" data-analysis="publish"><span aria-hidden="true">📤</span> Publicar en esa sección</button>
        </details>
        <div class="analysis-actions">
          <button type="button" class="btn btn-outline btn-lg" data-analysis="fix"><span aria-hidden="true">✏️</span> Seguir editando</button>
          <button type="button" class="btn btn-outline btn-lg" data-analysis="discard"><span aria-hidden="true">🗑️</span> Descartar</button>
        </div>`;
    }

    panel.innerHTML = html;
    panel.hidden = false;
    panel.focus();
    panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    if (result.status !== "rejected" && result.status !== "duplicate") {
      announce($("analysis-title").textContent);
    }
  }

  /** Guarda el recurso en la sección indicada (crear o modificar). */
  function publishRecord(record, categoryName, subcategoryName) {
    A.require(ui.editingId ? "resource:update" : "resource:create");
    const found = findSub(categoryName, subcategoryName);
    if (!found) throw new Error("La sección elegida no existe.");
    const user = A.currentUser();
    const validation = ui.pending && ui.pending.result.validation;
    const now = new Date().toISOString();
    const final = C.applyDefaults(
      {
        ...record,
        category: categoryName,
        subcategory: subcategoryName,
        interest: record.interest || (validation && validation.interest) || "Media"
      },
      found.sub
    );
    delete final._corpus;
    const index = catalog.findIndex((r) => r.id === final.id);
    const backup = catalog.slice();
    if (index >= 0) {
      catalog[index] = { ...final, updatedAt: now, updatedBy: user.username };
    } else {
      catalog.unshift({ ...final, createdAt: now, createdBy: user.username });
    }
    if (!persistCatalog()) {
      catalog = backup;
      return false;
    }
    const verb = index >= 0 ? "guardado" : "publicado";
    toast(`✅ «${final.name}» se ha ${verb} en «${subcategoryName}».`);
    announce(`Recurso ${verb} en la sección ${subcategoryName}.`);
    clearForm(true);
    renderAdminList();
    return true;
  }

  /** Acciones de los botones del panel de revisión. */
  function setupAnalysisActions() {
    $("analysis-panel").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-analysis]");
      if (!btn || !ui.pending) return;
      const { record } = ui.pending;
      try {
        switch (btn.dataset.analysis) {
          case "fix":
            $("analysis-panel").hidden = true;
            $("res-desc").focus();
            break;
          case "discard":
            clearForm(true);
            toast("Recurso descartado. No se ha guardado nada.", "info");
            break;
          case "variant":
            // Igual que en el documento: se guarda como variante de uso
            record.name = `${record.name} (Variante de uso)`;
            $("res-name").value = record.name;
            reviewResource(true);
            break;
          case "force":
            reviewResource(true);
            break;
          case "publish": {
            const [cat, sub] = $("analysis-sub").value.split("|||");
            publishRecord(record, cat, sub);
            break;
          }
          case "create-and-publish":
            createProposedAndPublish(record);
            break;
        }
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  /** Crea la sección propuesta (tras confirmar el administrador) y publica. */
  function createProposedAndPublish(record) {
    A.require("category:create");
    const name = $("prop-name").value.trim();
    const keywords = $("prop-keywords").value.split(",").map((k) => U.normalizeText(k)).filter(Boolean);
    const cat = categories.find((c) => c.id === $("prop-cat").value);
    const err = $("prop-error");
    const problem = !name
      ? "Escribe un nombre para la sección."
      : !keywords.length
        ? "Escribe al menos una palabra clave."
        : categories.some((c) => c.subcategories.some((s) => U.normalizeText(s.name) === U.normalizeText(name)))
          ? "Ya hay una sección con ese nombre."
          : null;
    if (problem) {
      err.textContent = problem;
      err.hidden = false;
      $(problem.includes("palabra") ? "prop-keywords" : "prop-name").focus();
      return;
    }
    const areas = record.areas.length ? record.areas : ["Todas las áreas"];
    const grades = record.grades.length ? record.grades : ["Para el docente"];
    cat.subcategories.push({
      id: U.uid("sub"),
      name,
      icon: "🆕",
      keywords,
      defaults: { areas, grades, dokLevel: record.dokLevel || 2 },
      createdAt: new Date().toISOString()
    });
    if (!persistCategories()) return;
    populateFilters();
    if (publishRecord(record, cat.name, name)) {
      toast(`🆕 Sección «${name}» creada y recurso publicado.`);
    }
  }

  function askDeleteResource(id) {
    A.require("resource:delete");
    const r = catalog.find((x) => x.id === id);
    if (!r) return;
    confirmAction("¿Borrar este recurso?", `Vas a borrar «${r.name}». Los docentes ya no lo verán. No se puede deshacer.`, "Sí, borrar", () => {
      A.require("resource:delete");
      catalog = catalog.filter((x) => x.id !== id);
      persistCatalog();
      renderCatalog();
      renderAdminList();
      toast(`«${r.name}» se ha borrado.`, "info");
    });
  }

  /* ==========================================================================
   * F. ADMINISTRACIÓN · PESTAÑAS Y LISTA DE RECURSOS
   * ======================================================================== */
  const tabs = () => [...document.querySelectorAll('[role="tab"]')];

  function selectTab(tabId) {
    tabs().forEach((t) => {
      const on = t.id === tabId;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (tabId === "tab-list") renderAdminList();
    if (tabId === "tab-categories") renderCategoriesAdmin();
    if (tabId === "tab-users") renderUsers();
  }

  function setupTabs() {
    tabs().forEach((t, i, all) => {
      t.addEventListener("click", () => selectTab(t.id));
      // Flechas izquierda/derecha para moverse entre pestañas (patrón ARIA)
      t.addEventListener("keydown", (e) => {
        let next = null;
        if (e.key === "ArrowRight") next = all[(i + 1) % all.length];
        if (e.key === "ArrowLeft") next = all[(i - 1 + all.length) % all.length];
        if (e.key === "Home") next = all[0];
        if (e.key === "End") next = all[all.length - 1];
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

  function renderAdminList() {
    if (!A.isAdmin()) return;
    const q = U.normalizeText($("admin-search").value);
    const list = catalog.filter((r) => !q || U.normalizeText(`${r.name} ${r.subcategory} ${r.category}`).includes(q));
    const visible = list.slice(0, ui.adminLimit);
    $("admin-list-count").textContent = `${list.length} recursos${q ? " encontrados" : " en total"}.`;
    $("admin-list-body").innerHTML = visible
      .map(
        (r) => `<tr>
          <th scope="row">${esc(r.name)}</th>
          <td>${esc(r.subcategory || "—")}</td>
          <td>${esc((r.areas || []).join(", "))}</td>
          <td>${esc(gradeSummary(r.grades))}</td>
          <td class="row-actions">
            <button type="button" class="btn btn-outline btn-sm" data-action="edit" data-id="${esc(r.id)}"><span aria-hidden="true">✏️</span> Editar<span class="visually-hidden"> ${esc(r.name)}</span></button>
            <button type="button" class="btn btn-outline btn-outline-danger btn-sm" data-action="delete" data-id="${esc(r.id)}"><span aria-hidden="true">🗑️</span> Borrar<span class="visually-hidden"> ${esc(r.name)}</span></button>
          </td></tr>`
      )
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
      try {
        if (btn.dataset.action === "edit") startEdit(btn.dataset.id);
        if (btn.dataset.action === "delete") askDeleteResource(btn.dataset.id);
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  /* ==========================================================================
   * G. ADMINISTRACIÓN · CATEGORÍAS Y SECCIONES
   * ======================================================================== */
  const countIn = (catName, subName) => catalog.filter((r) => r.category === catName && (!subName || r.subcategory === subName)).length;

  function renderCategoriesAdmin() {
    $("categories-admin").innerHTML = categories
      .map(
        (c) => `<section class="card category-admin" aria-labelledby="ca-${esc(c.id)}">
        <div class="category-admin-head">
          <h3 class="card-heading" id="ca-${esc(c.id)}"><span aria-hidden="true">${esc(c.icon)}</span> ${esc(c.name)} <span class="count-pill">${countIn(c.name)}</span></h3>
          <div class="row-actions">
            <button type="button" class="btn btn-primary btn-sm" data-cat-action="new-sub" data-cat="${esc(c.id)}"><span aria-hidden="true">➕</span> Nueva sección<span class="visually-hidden"> en ${esc(c.name)}</span></button>
            <button type="button" class="btn btn-outline btn-sm" data-cat-action="edit-cat" data-cat="${esc(c.id)}"><span aria-hidden="true">✏️</span> Renombrar<span class="visually-hidden"> ${esc(c.name)}</span></button>
            <button type="button" class="btn btn-outline btn-outline-danger btn-sm" data-cat-action="delete-cat" data-cat="${esc(c.id)}"><span aria-hidden="true">🗑️</span> Borrar<span class="visually-hidden"> ${esc(c.name)}</span></button>
          </div>
        </div>
        ${c.description ? `<p class="field-hint">${esc(c.description)}</p>` : ""}
        <ul class="sub-admin-list">
          ${c.subcategories
            .map(
              (s) => `<li class="sub-admin">
              <div>
                <p class="sub-admin-name"><span aria-hidden="true">${esc(s.icon)}</span> ${esc(s.name)} <span class="count-pill">${countIn(c.name, s.name)}</span></p>
                <p class="keywords"><span class="meta-label">Criterios:</span> ${s.keywords.map((k) => `<span class="chip">${esc(k)}</span>`).join(" ")}</p>
              </div>
              <div class="row-actions">
                <button type="button" class="btn btn-outline btn-sm" data-cat-action="edit-sub" data-cat="${esc(c.id)}" data-sub="${esc(s.id)}"><span aria-hidden="true">✏️</span> Editar<span class="visually-hidden"> ${esc(s.name)}</span></button>
                <button type="button" class="btn btn-outline btn-outline-danger btn-sm" data-cat-action="delete-sub" data-cat="${esc(c.id)}" data-sub="${esc(s.id)}"><span aria-hidden="true">🗑️</span> Borrar<span class="visually-hidden"> ${esc(s.name)}</span></button>
              </div></li>`
            )
            .join("")}
        </ul></section>`
      )
      .join("");
  }

  /** Formulario (en diálogo) para categoría o sección. */
  function categoryDialog({ title, name = "", icon = "📁", keywords = null, description = "", onSave }) {
    openDialog({
      title,
      bodyHtml: `
        <div class="form-field">
          <label for="dlg-name" class="field-label required">Nombre</label>
          <input type="text" id="dlg-name" class="form-control" value="${esc(name)}" maxlength="70">
        </div>
        <div class="form-field">
          <label for="dlg-icon" class="field-label">Icono (un emoji)</label>
          <input type="text" id="dlg-icon" class="form-control input-icon" value="${esc(icon)}" maxlength="4">
        </div>
        ${keywords !== null
          ? `<div class="form-field">
              <label for="dlg-keywords" class="field-label required">Criterios: palabras clave (separadas por comas)</label>
              <p id="dlg-kw-hint" class="field-hint">Escribe palabras que suelen aparecer en estos recursos.</p>
              <textarea id="dlg-keywords" class="form-control" rows="3" aria-describedby="dlg-kw-hint">${esc(keywords.join(", "))}</textarea>
            </div>`
          : `<div class="form-field">
              <label for="dlg-desc" class="field-label">Descripción breve</label>
              <input type="text" id="dlg-desc" class="form-control" value="${esc(description)}" maxlength="140">
            </div>`}`,
      confirmText: "Guardar",
      onConfirm: () => {
        const values = {
          name: $("dlg-name").value.trim(),
          icon: $("dlg-icon").value.trim() || "📁",
          keywords: keywords !== null ? $("dlg-keywords").value.split(",").map((k) => U.normalizeText(k)).filter(Boolean) : null,
          description: $("dlg-desc") ? $("dlg-desc").value.trim() : ""
        };
        if (!values.name) return "Escribe un nombre.";
        if (keywords !== null && !values.keywords.length) return "Escribe al menos una palabra clave.";
        return onSave(values);
      }
    });
  }

  function afterCategoryChange(message) {
    persistCategories();
    persistCatalog();
    populateFilters();
    renderCategoriesAdmin();
    toast(message);
  }

  function setupCategoriesAdmin() {
    $("btn-new-category").addEventListener("click", () => {
      try {
        A.require("category:create");
        categoryDialog({
          title: "Nueva categoría",
          description: "",
          onSave: (v) => {
            if (categories.some((c) => U.normalizeText(c.name) === U.normalizeText(v.name))) return "Ya existe una categoría con ese nombre.";
            categories.push({ id: U.uid("cat"), name: v.name, icon: v.icon, description: v.description, subcategories: [] });
            afterCategoryChange(`Categoría «${v.name}» creada. Ahora añade sus secciones.`);
            return null;
          }
        });
      } catch (err) {
        toast(err.message, "error");
      }
    });

    $("categories-admin").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat-action]");
      if (!btn) return;
      const cat = categories.find((c) => c.id === btn.dataset.cat);
      const sub = cat && cat.subcategories.find((s) => s.id === btn.dataset.sub);
      try {
        switch (btn.dataset.catAction) {
          case "new-sub":
            A.require("category:create");
            categoryDialog({
              title: `Nueva sección en «${cat.name}»`,
              keywords: [],
              onSave: (v) => {
                if (cat.subcategories.some((s) => U.normalizeText(s.name) === U.normalizeText(v.name))) return "Ya existe una sección con ese nombre.";
                cat.subcategories.push({ id: U.uid("sub"), name: v.name, icon: v.icon, keywords: v.keywords, defaults: { areas: ["Todas las áreas"], grades: ["Para el docente"], dokLevel: 2 } });
                afterCategoryChange(`Sección «${v.name}» creada.`);
                return null;
              }
            });
            break;
          case "edit-cat":
            A.require("category:update");
            categoryDialog({
              title: `Renombrar «${cat.name}»`,
              name: cat.name,
              icon: cat.icon,
              description: cat.description || "",
              onSave: (v) => {
                if (categories.some((c) => c !== cat && U.normalizeText(c.name) === U.normalizeText(v.name))) return "Ya existe una categoría con ese nombre.";
                // Los recursos guardan el nombre de la categoría: se actualizan
                catalog.forEach((r) => {
                  if (r.category === cat.name) r.category = v.name;
                });
                Object.assign(cat, { name: v.name, icon: v.icon, description: v.description });
                afterCategoryChange("Categoría actualizada.");
                return null;
              }
            });
            break;
          case "delete-cat": {
            A.require("category:delete");
            const n = countIn(cat.name);
            if (n > 0) {
              toast(`No se puede borrar «${cat.name}»: tiene ${n} recursos. Primero muévelos o bórralos.`, "error");
              break;
            }
            confirmAction("¿Borrar esta categoría?", `Vas a borrar «${cat.name}» y sus secciones vacías.`, "Sí, borrar", () => {
              categories = categories.filter((c) => c !== cat);
              afterCategoryChange("Categoría borrada.");
            });
            break;
          }
          case "edit-sub":
            A.require("category:update");
            categoryDialog({
              title: `Editar sección «${sub.name}»`,
              name: sub.name,
              icon: sub.icon,
              keywords: sub.keywords,
              onSave: (v) => {
                if (cat.subcategories.some((s) => s !== sub && U.normalizeText(s.name) === U.normalizeText(v.name))) return "Ya existe una sección con ese nombre.";
                catalog.forEach((r) => {
                  if (r.category === cat.name && r.subcategory === sub.name) r.subcategory = v.name;
                });
                Object.assign(sub, { name: v.name, icon: v.icon, keywords: v.keywords });
                afterCategoryChange("Sección actualizada.");
                return null;
              }
            });
            break;
          case "delete-sub": {
            A.require("category:delete");
            const n = countIn(cat.name, sub.name);
            if (n > 0) {
              toast(`No se puede borrar «${sub.name}»: tiene ${n} recursos. Primero muévelos (Editar recurso) o bórralos.`, "error");
              break;
            }
            confirmAction("¿Borrar esta sección?", `Vas a borrar la sección «${sub.name}».`, "Sí, borrar", () => {
              cat.subcategories = cat.subcategories.filter((s) => s !== sub);
              afterCategoryChange("Sección borrada.");
            });
            break;
          }
        }
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  /* ==========================================================================
   * H. ADMINISTRACIÓN · CUENTAS
   * ======================================================================== */
  function renderUsers() {
    if (!A.isAdmin()) return;
    const me = A.currentUser();
    $("users-body").innerHTML = A.listUsers()
      .map(
        (u) => `<tr>
          <th scope="row">${esc(u.displayName)}${u.id === me.userId ? " <em>(tú)</em>" : ""}</th>
          <td><code>${esc(u.username)}</code></td>
          <td>${u.role === "admin" ? "Administración" : "Docente"}</td>
          <td class="row-actions">
            <button type="button" class="btn btn-outline btn-sm" data-user-action="password" data-id="${esc(u.id)}"><span aria-hidden="true">🔑</span> Cambiar contraseña<span class="visually-hidden"> de ${esc(u.username)}</span></button>
            ${u.id !== me.userId ? `<button type="button" class="btn btn-outline btn-outline-danger btn-sm" data-user-action="delete" data-id="${esc(u.id)}"><span aria-hidden="true">🗑️</span> Borrar<span class="visually-hidden"> ${esc(u.username)}</span></button>` : ""}
          </td></tr>`
      )
      .join("");
  }

  function setupUsers() {
    $("user-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const msg = $("user-form-msg");
      try {
        const r = A.createUser({
          displayName: $("usr-name").value,
          username: $("usr-username").value,
          password: $("usr-pass").value,
          role: $("usr-role").value
        });
        msg.className = `alert ${r.ok ? "alert-success" : "alert-danger"}`;
        msg.textContent = r.message;
        msg.hidden = false;
        if (r.ok) {
          $("user-form").reset();
          renderUsers();
        }
      } catch (err) {
        toast(err.message, "error");
      }
    });

    $("users-body").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-user-action]");
      if (!btn) return;
      const id = btn.dataset.id;
      const user = A.listUsers().find((u) => u.id === id);
      if (btn.dataset.userAction === "password") {
        openDialog({
          title: `Nueva contraseña para «${user.username}»`,
          bodyHtml: `<div class="form-field">
              <label for="dlg-pass1" class="field-label">Contraseña nueva</label>
              <input type="password" id="dlg-pass1" class="form-control" autocomplete="new-password" aria-describedby="dlg-pass-hint">
              <p id="dlg-pass-hint" class="field-hint">8 caracteres o más, con algún número. Díselo a la persona en privado.</p>
            </div>`,
          confirmText: "Guardar",
          onConfirm: () => {
            const r = A.changePassword(id, $("dlg-pass1").value);
            if (!r.ok) return r.message;
            toast(r.message);
            return null;
          }
        });
      } else {
        confirmAction("¿Borrar esta cuenta?", `La persona «${user.displayName}» ya no podrá entrar.`, "Sí, borrar", () => {
          const r = A.deleteUser(id);
          toast(r.message, r.ok ? "ok" : "error");
          renderUsers();
        });
      }
    });
  }

  /* ==========================================================================
   * I. COPIAS, IMPORTACIÓN Y RESTAURACIÓN
   * ======================================================================== */

  /**
   * Revisa y clasifica uno a uno los recursos de un archivo importado.
   * Solo se publican los que sirven para clase y encajan en una sección.
   * Los que necesitan una sección nueva quedan en el informe para que el
   * administrador los añada a mano (así confirma la sección).
   */
  function importResources(items) {
    A.require("data:import");
    const report = { added: [], rejected: [], duplicated: [], needsCategory: [], invalid: [] };
    const now = new Date().toISOString();
    for (const raw of items) {
      const record = {
        ...raw,
        id: raw.id && !catalog.some((r) => r.id === raw.id) ? raw.id : U.uid("imp"),
        name: String(raw.name || "").trim(),
        url: String(raw.url || "").trim(),
        description: String(raw.description || "").trim(),
        areas: Array.isArray(raw.areas) ? raw.areas : [],
        grades: Array.isArray(raw.grades) ? raw.grades : []
      };
      const result = C.analyze(record, { catalog, categories });
      if (result.status === "invalid") report.invalid.push({ name: record.name || "(sin nombre)", why: result.errors.map((e) => e.message).join(" ") });
      else if (result.status === "rejected") report.rejected.push({ name: record.name, why: `${result.validation.title}. ${result.validation.message}` });
      else if (result.status === "duplicate") report.duplicated.push({ name: record.name, why: result.duplicate.reason });
      else if (result.status === "new-category") report.needsCategory.push({ name: record.name, why: `Sección propuesta: «${result.proposal.name}»` });
      else {
        // Si el archivo ya trae una sección que existe, se respeta
        const keep = findSub(record.category, record.subcategory);
        const target = keep || findSub(result.classification.best.categoryName, result.classification.best.subcategoryName);
        const final = C.applyDefaults(
          { ...record, category: target.cat.name, subcategory: target.sub.name, interest: record.interest || result.validation.interest, createdAt: now, createdBy: A.currentUser().username },
          target.sub
        );
        catalog.push(final);
        report.added.push({ name: record.name, why: `→ ${target.sub.name}` });
      }
    }
    persistCatalog();
    return report;
  }

  function renderImportReport(report) {
    const block = (title, icon, list, cls) =>
      list.length
        ? `<section class="report-block ${cls}"><h3><span aria-hidden="true">${icon}</span> ${esc(title)} (${list.length})</h3>
           <ul>${list.map((i) => `<li><strong>${esc(i.name)}</strong> ${esc(i.why)}</li>`).join("")}</ul></section>`
        : "";
    const box = $("import-report");
    box.innerHTML = `<h2 class="section-title">Resultado de la carga</h2>
      ${block("Publicados", "✅", report.added, "report-ok")}
      ${block("No publicados: sin utilidad educativa o enlace no válido", "⛔", report.rejected, "report-bad")}
      ${block("No publicados: ya existían", "⚠️", report.duplicated, "report-warn")}
      ${block("Necesitan una sección nueva: añádelos uno a uno en «Añadir recurso»", "💡", report.needsCategory, "report-info")}
      ${block("Les faltan datos", "✏️", report.invalid, "report-warn")}`;
    box.hidden = false;
    box.focus();
    announce(`Carga terminada. Publicados ${report.added.length}. No publicados ${report.rejected.length + report.duplicated.length + report.needsCategory.length + report.invalid.length}.`);
  }

  function setupBackup() {
    $("btn-export-json").addEventListener("click", () => {
      try {
        A.require("data:export");
        S.exportToJSON(catalog, categories);
        toast("Descargando la copia de seguridad.");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    $("import-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        A.require("data:import");
        const data = await S.importFile(file);
        if (!data.resources.length) {
          toast("El archivo no tiene recursos.", "error");
          return;
        }
        if (data.categories) {
          // Es una copia completa de esta plataforma: se puede restaurar entera
          confirmAction(
            "¿Restaurar esta copia de seguridad?",
            `La copia tiene ${data.resources.length} recursos y ${data.categories.length} categorías. Se cambiará todo el catálogo actual por la copia.`,
            "Sí, restaurar",
            () => {
              A.require("data:import");
              categories = data.categories;
              catalog = data.resources;
              persistCategories();
              persistCatalog();
              populateFilters();
              toast("Copia restaurada.");
            }
          );
        } else {
          renderImportReport(importResources(data.resources));
          populateFilters();
        }
      } catch (err) {
        toast(`No se pudo cargar el archivo: ${err.message}`, "error");
      } finally {
        e.target.value = "";
      }
    });

    $("btn-reset-seed").addEventListener("click", () => {
      try {
        A.require("data:import");
        confirmAction(
          "¿Volver al catálogo original?",
          "Se borrarán los recursos y secciones que hayas añadido o cambiado. Descarga antes una copia si la necesitas.",
          "Sí, restaurar",
          () => {
            S.resetToSeed();
            catalog = S.loadCatalog();
            categories = S.loadCategories();
            populateFilters();
            toast("Catálogo original restaurado.");
          }
        );
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  /* ==========================================================================
   * ARRANQUE
   * ======================================================================== */
  loadData();
  applyPrefs();
  setupLogin();
  setupCatalog();
  setupResourceForm();
  setupAnalysisActions();
  setupTabs();
  setupAdminList();
  setupCategoriesAdmin();
  setupUsers();
  setupBackup();
  route();

  // Acceso para las pruebas automáticas (no se usa en la interfaz)
  window.__eduApp = { getCatalog: () => catalog, getCategories: () => categories };
});
