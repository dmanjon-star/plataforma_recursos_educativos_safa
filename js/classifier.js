/**
 * ============================================================================
 *  classifier.js — Validación educativa y clasificación automática
 * ============================================================================
 *  Cuando un administrador añade un recurso, la plataforma hace 4 pasos:
 *
 *   PASO 1 · ¿Faltan datos?          → checkRequired()
 *   PASO 2 · ¿Tiene utilidad educativa? → validateEducational()
 *            Se rechaza si:
 *              a) tiene contenido de riesgo (piratería, adultos, apuestas…),
 *              b) el enlace es temporal (iniciar sesión, pagar, buscar…),
 *              c) el enlace tiene datos personales (correo, sesión, token…),
 *              d) no hay ninguna señal educativa, o lo que domina son señales
 *                 de categorías sin interés docente (compras, viajes, banca…).
 *   PASO 3 · ¿Ya existe?             → EduUtils.detectDuplicate()
 *   PASO 4 · ¿Dónde va?              → classify()
 *            Se puntúa cada subcategoría con sus palabras clave:
 *              - palabra en el NOMBRE ............ 2 puntos
 *              - palabra en DESCRIPCIÓN/URL/otros  1 punto
 *              - mismo sitio web que otro recurso de esa subcategoría: +3
 *              - la materia elegida coincide con la de la subcategoría: +1
 *            Gana la subcategoría con más puntos si llega al mínimo
 *            (EDU_RULES.MIN_CATEGORY_SCORE). Si ninguna llega, el recurso es
 *            educativo pero no encaja → proposeCategory() sugiere una
 *            sección nueva con nombre y criterios.
 *
 *  Decisión documentada (especificación poco clara): el documento no define
 *  un algoritmo de categorización concreto. Se ha elegido la opción más
 *  sencilla y explicable: puntuación por palabras clave. Así el
 *  administrador puede ver y editar los criterios de cada sección.
 * ============================================================================
 */
window.EduClassifier = (function () {
  const U = () => window.EduUtils;
  const R = () => window.EDU_RULES;

  /**
   * Junta los textos de un recurso, normalizados, separados por campo.
   * La URL se trocea en palabras: «www.mundo-primaria.com/juegos» →
   * «mundo primaria com juegos».
   */
  function getFields(resource) {
    const n = (t) => U().normalizeText(t);
    return {
      name: n(resource.name),
      description: n(resource.description),
      url: n(String(resource.url || "").replace(/^https?:\/\//i, "").replace(/[./_\-?=&#]+/g, " ")),
      extra: n([resource.methodology, resource.activityType, (resource.keywords || []).join(" ")].join(" "))
    };
  }

  /**
   * ¿Contiene la URL este trozo? Exige que después no siga una letra, para
   * que «/edit» no confunda «/editor» ni «/login» confunda «/logintegral».
   */
  function urlHas(rawUrl, pattern) {
    let from = 0;
    while (true) {
      const i = rawUrl.indexOf(pattern, from);
      if (i === -1) return false;
      const next = rawUrl.charAt(i + pattern.length);
      if (!/[a-z]/.test(next) || /[=?/.]$/.test(pattern)) return true;
      from = i + 1;
    }
  }

  /** ¿Aparece la palabra (o su plural sencillo) en el texto normalizado? */
  function has(text, k) {
    return U().countMatches(text, [k]).length > 0;
  }

  function allText(fields) {
    return [fields.name, fields.description, fields.url, fields.extra].join(" ");
  }

  /* ------------------------------------------------------------------------
   * PASO 1 · Campos obligatorios
   * ---------------------------------------------------------------------- */
  /**
   * @param {Object} r - Recurso candidato.
   * @returns {Array<{field:string,message:string}>} Errores (vacío si todo bien).
   */
  function checkRequired(r) {
    const errors = [];
    if (!r.name || r.name.trim().length < 2) {
      errors.push({ field: "res-name", message: "Escribe el nombre del recurso." });
    }
    const hasFile = Boolean(r.file && r.file.dataUrl);
    if (!hasFile && !r.url) {
      errors.push({ field: "res-url", message: "Pega el enlace del recurso o sube un archivo." });
    } else if (r.url && !U().isValidUrl(r.url)) {
      errors.push({ field: "res-url", message: "El enlace no es correcto. Debe empezar por https://" });
    }
    if (!r.description || r.description.trim().length < 15) {
      errors.push({ field: "res-desc", message: "Escribe una descripción de al menos 15 letras: ¿para qué sirve en clase?" });
    }
    return errors;
  }

  /* ------------------------------------------------------------------------
   * PASO 2 · Utilidad educativa
   * ---------------------------------------------------------------------- */
  /**
   * Comprueba si un recurso tiene utilidad educativa.
   * @param {Object} resource
   * @param {Array} categories - Categorías actuales (sus palabras cuentan).
   * @returns {{ok:boolean, code?:string, title?:string, message?:string,
   *            tip?:string, eduScore:number, eduWords:string[]}}
   */
  function validateEducational(resource, categories) {
    const rules = R();
    const fields = getFields(resource);
    const text = allText(fields);
    const rawUrl = String(resource.url || "").toLowerCase();

    // a) Contenido de riesgo
    const risk = U().countMatches(text, rules.RISK_KEYWORDS);
    if (risk.length) {
      return {
        ok: false,
        code: "RISK",
        title: "Este recurso no se puede publicar",
        message: `Puede ser peligroso o no es apropiado para un colegio. Hemos visto: «${risk.join("», «")}».`,
        tip: "No uses este enlace. Busca la página oficial del recurso.",
        eduScore: 0,
        eduWords: []
      };
    }

    // b) Enlace temporal
    const temporary = rules.TEMPORARY_URL_PATTERNS.find((p) => urlHas(rawUrl, p));
    if (temporary) {
      return {
        ok: false,
        code: "TEMPORARY",
        title: "Este enlace es temporal",
        message: "Es una página para entrar, pagar o buscar. Mañana puede no funcionar.",
        tip: "Copia la dirección de la página principal del recurso y vuelve a probar.",
        eduScore: 0,
        eduWords: []
      };
    }

    // c) Datos personales
    const personal = rules.PERSONAL_URL_PATTERNS.find((p) => urlHas(rawUrl, p));
    if (personal) {
      return {
        ok: false,
        code: "PERSONAL",
        title: "Este enlace tiene datos personales",
        message: "La dirección es de tu cuenta (correo, sesión abierta o documento en edición). Otras personas no podrán abrirla.",
        tip: "Usa el enlace público del recurso, el que puede abrir cualquier persona.",
        eduScore: 0,
        eduWords: []
      };
    }

    // d) Señales educativas frente a señales sin interés docente
    const eduWords = U().countMatches(text, rules.EDU_KEYWORDS);
    const halfWords = U().countMatches(text, rules.HALF_EDU_KEYWORDS);
    const eduCategory = (categories || []).find((c) => c.id === "cat_edu");
    const subWords = eduCategory
      ? U().countMatches(text, eduCategory.subcategories.flatMap((s) => s.keywords))
      : [];
    // Las palabras ya contadas como educativas no se cuentan dos veces
    const extraSub = subWords.filter((w) => !eduWords.includes(w) && !halfWords.includes(w));
    const eduScore = eduWords.length + 0.5 * halfWords.length + 0.5 * extraSub.length;

    let worstGroup = null;
    let nonEduTotal = 0;
    for (const group of rules.NON_EDU_GROUPS) {
      const words = U().countMatches(text, group.keywords);
      nonEduTotal += words.length;
      if (words.length && (!worstGroup || words.length > worstGroup.words.length)) {
        worstGroup = { ...group, words };
      }
    }

    const allEduWords = eduWords.concat(halfWords, extraSub);
    const looksNonEdu = worstGroup && nonEduTotal >= 2 && nonEduTotal > eduScore;

    if (eduScore < rules.MIN_EDU_SCORE || looksNonEdu) {
      return {
        ok: false,
        code: "NOT_EDUCATIONAL",
        title: "No tiene utilidad educativa",
        message: worstGroup
          ? `Parece una página de ${worstGroup.label} (palabras: «${worstGroup.words.join("», «")}»), no un recurso para enseñar.`
          : "No hemos encontrado para qué sirve en clase.",
        tip: "Si sí sirve para clase, explícalo en la descripción. Por ejemplo: «Sirve para practicar sumas en 2.º de Primaria».",
        eduScore,
        eduWords: allEduWords
      };
    }

    return {
      ok: true,
      eduScore,
      eduWords: allEduWords,
      interest: eduWords.length >= 2 ? "Alta" : "Media"
    };
  }

  /* ------------------------------------------------------------------------
   * PASO 4 · Clasificación
   * ---------------------------------------------------------------------- */
  /**
   * Puntúa todas las subcategorías y devuelve la mejor.
   * @param {Object} resource
   * @param {Array} categories
   * @param {Array} catalog - Para la pista del «mismo sitio web».
   * @returns {{best:Object|null, ranking:Array, fits:boolean}}
   */
  function classify(resource, categories, catalog) {
    const fields = getFields(resource);
    const domain = U().getDomain(resource.url);
    const ranking = [];

    for (const cat of categories) {
      for (const sub of cat.subcategories) {
        let score = 0;
        const words = [];
        for (const kw of sub.keywords) {
          const k = U().normalizeText(kw);
          if (!k) continue;
          if (has(fields.name, k)) {
            score += 2;
            words.push(k);
          } else if (has(fields.description, k) || has(fields.url, k) || has(fields.extra, k)) {
            score += 1;
            words.push(k);
          }
        }
        // Pista: el mismo sitio web ya está en esta subcategoría
        const sameSite =
          domain &&
          (catalog || []).some(
            (r) => r.id !== resource.id && r.subcategory === sub.name && r.category === cat.name && U().getDomain(r.url) === domain
          );
        if (sameSite) {
          score += 3;
          words.push(`mismo sitio: ${domain}`);
        }
        // Pista: la materia elegida es la propia de la subcategoría
        const subArea = (sub.defaults && sub.defaults.areas) || [];
        if ((resource.areas || []).some((a) => a !== "Todas las áreas" && subArea.includes(a))) {
          score += 1;
          words.push(`materia: ${subArea[0]}`);
        }
        if (score > 0) {
          ranking.push({
            categoryId: cat.id,
            categoryName: cat.name,
            subcategoryId: sub.id,
            subcategoryName: sub.name,
            icon: sub.icon,
            score,
            words
          });
        }
      }
    }

    ranking.sort((a, b) => b.score - a.score);
    const best = ranking[0] || null;
    const fits = Boolean(best && best.score >= R().MIN_CATEGORY_SCORE);
    if (best) {
      const second = ranking[1] ? ranking[1].score : 0;
      // Seguridad = qué parte de los puntos se lleva la ganadora frente a la segunda
      best.confidence = Math.round((best.score / (best.score + second)) * 100);
    }
    return { best, ranking: ranking.slice(0, 5), fits };
  }

  /* ------------------------------------------------------------------------
   * Propuesta de sección nueva
   * ---------------------------------------------------------------------- */
  /**
   * Propone una subcategoría nueva (nombre + criterios) para un recurso
   * educativo que no encaja en ninguna existente.
   * @returns {{categoryId:string, name:string, icon:string, keywords:string[], reason:string}}
   */
  function proposeCategory(resource, categories) {
    const rules = R();
    const fields = getFields(resource);
    const text = allText(fields);
    const existingNames = new Set(categories.flatMap((c) => c.subcategories.map((s) => U().normalizeText(s.name))));

    // 1) ¿Coincide con un tema educativo conocido que aún no tiene sección?
    let bestTopic = null;
    for (const topic of rules.PROPOSAL_TOPICS) {
      if (existingNames.has(U().normalizeText(topic.name))) continue;
      const words = U().countMatches(text, topic.keywords);
      if (words.length && (!bestTopic || words.length > bestTopic.words.length)) {
        bestTopic = { ...topic, words };
      }
    }
    if (bestTopic) {
      return {
        categoryId: "cat_edu",
        name: bestTopic.name,
        icon: "🆕",
        // Primero las palabras encontradas en el recurso, después las del tema
        keywords: [...new Set(bestTopic.words.concat(bestTopic.keywords))].slice(0, 8),
        reason: `El recurso habla de «${bestTopic.words.join("», «")}» y no hay ninguna sección sobre ese tema.`
      };
    }

    // 2) Si no, se usan las palabras más repetidas del nombre y la descripción
    const stop = new Set(rules.STOPWORDS);
    const counts = new Map();
    const source = `${fields.name} ${fields.name} ${fields.description}`; // el nombre pesa doble
    for (const word of source.split(" ")) {
      if (word.length < 4 || stop.has(word) || /^\d+$/.test(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([w]) => w);
    const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
    let name = top.length >= 2 ? `${cap(top[0])} y ${top[1]}` : top.length === 1 ? `Recursos de ${top[0]}` : "Otros recursos educativos";
    if (existingNames.has(U().normalizeText(name))) name += " (nueva)";
    return {
      categoryId: "cat_edu",
      name,
      icon: "🆕",
      keywords: top.slice(0, 6),
      reason: "Es un recurso educativo, pero no encaja en ninguna sección. Te proponemos una con sus palabras principales."
    };
  }

  /* ------------------------------------------------------------------------
   * Valores propuestos para materia, curso y DOK
   * ---------------------------------------------------------------------- */
  /**
   * Rellena materia, curso, etapa y DOK con los valores de la subcategoría
   * cuando el administrador los deja vacíos. Devuelve un recurso NUEVO.
   */
  function applyDefaults(resource, sub) {
    const out = { ...resource };
    const d = (sub && sub.defaults) || {};
    if (!out.areas || !out.areas.length) out.areas = (d.areas || ["Todas las áreas"]).slice();
    if (!out.grades || !out.grades.length) out.grades = (d.grades || ["Para el docente"]).slice();
    if (!out.dokLevel) out.dokLevel = d.dokLevel || 2;
    out.stages = [...new Set(out.grades.filter((g) => g !== "Para el docente").map((g) => (g.startsWith("Infantil") ? "Infantil" : "Primaria")))];
    return out;
  }

  /* ------------------------------------------------------------------------
   * Proceso completo
   * ---------------------------------------------------------------------- */
  /**
   * Ejecuta los pasos 1 a 4 y devuelve qué hay que mostrar al administrador.
   * @param {Object} resource - Recurso candidato.
   * @param {Object} ctx - { catalog, categories, ignoreId, skipDuplicate }
   * @returns {{status:"invalid"|"rejected"|"duplicate"|"classified"|"new-category", ...}}
   */
  function analyze(resource, ctx) {
    const { catalog = [], categories = [], ignoreId = null, skipDuplicate = false } = ctx || {};

    const errors = checkRequired(resource);
    if (errors.length) return { status: "invalid", errors };

    const validation = validateEducational(resource, categories);
    if (!validation.ok) return { status: "rejected", validation };

    if (!skipDuplicate) {
      const duplicate = U().detectDuplicate(resource, catalog, ignoreId);
      if (duplicate) return { status: "duplicate", validation, duplicate, classification: classify(resource, categories, catalog) };
    }

    const classification = classify(resource, categories, catalog);
    if (classification.fits) return { status: "classified", validation, classification };

    return {
      status: "new-category",
      validation,
      classification,
      proposal: proposeCategory(resource, categories)
    };
  }

  return { checkRequired, validateEducational, classify, proposeCategory, applyDefaults, analyze };
})();
