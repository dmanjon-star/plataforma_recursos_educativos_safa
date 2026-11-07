/**
 * ============================================================================
 *  data.js — Datos semilla y criterios de la plataforma
 * ============================================================================
 *  Contiene:
 *   1. EDU_CONFIG: listas fijas (cursos, materias, etapas, DOK, DUA, coste).
 *   2. INITIAL_CATEGORIES: categorías y subcategorías del Excel
 *      «Clasificación de páginas web», con los CRITERIOS de clasificación
 *      (palabras clave) que usa el clasificador automático.
 *   3. EDU_RULES: criterios de validación de utilidad educativa
 *      (qué se acepta y qué se descarta, y por qué).
 *   4. INITIAL_RESOURCES: los 12 recursos semilla del documento de
 *      especificaciones + los recursos del Excel (data-catalogo.js).
 *   5. INITIAL_USERS: cuentas de demostración.
 *
 *  Todo el texto está en español sencillo porque se muestra a docentes.
 *  Las palabras clave se escriben SIN tildes y en minúscula: el clasificador
 *  normaliza el texto antes de comparar (ver EduUtils.normalizeText).
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 * 1. Listas fijas
 * ------------------------------------------------------------------------- */
window.EDU_CONFIG = {
  /** Cursos (nivel de grado). «Para el docente» = recurso para preparar clases. */
  GRADES: [
    "Infantil 3 años",
    "Infantil 4 años",
    "Infantil 5 años",
    "1º Primaria",
    "2º Primaria",
    "3º Primaria",
    "4º Primaria",
    "5º Primaria",
    "6º Primaria",
    "Para el docente"
  ],

  /** Materias (áreas curriculares). Lista del documento + 3 áreas comunes. */
  SUBJECTS: [
    "Lengua Castellana y Literatura",
    "Matemáticas",
    "Conocimiento del Medio",
    "Educación Artística",
    "Lengua Extranjera (Inglés)",
    "Educación Emocional",
    "Educación Física",
    "Competencia digital",
    "Todas las áreas"
  ],

  STAGES: ["Infantil", "Primaria"],

  DOK_LEVELS: {
    1: "DOK 1: Recordar",
    2: "DOK 2: Comprender y aplicar",
    3: "DOK 3: Pensar y razonar",
    4: "DOK 4: Crear e investigar"
  },

  UDL_PRINCIPLES: [
    "Múltiples formas de representación",
    "Múltiples formas de acción y expresión",
    "Múltiples formas de implicación"
  ],

  COSTS: ["Gratuito", "Freemium", "De pago", "Por confirmar"],

  LINK_TYPES: ["Página web", "Documento PDF", "Vídeo", "Repositorio de código", "Archivo subido"],

  /** Tamaño máximo de archivo subido (el navegador guarda poco espacio). */
  MAX_FILE_BYTES: 1.5 * 1024 * 1024
};

/* ---------------------------------------------------------------------------
 * 2. Categorías, subcategorías y criterios de clasificación
 * ---------------------------------------------------------------------------
 *  Se han conservado SOLO las categorías del Excel con interés «Alto» o
 *  «Medio» para el proyecto docente. Cada subcategoría tiene:
 *    - keywords: palabras que indican que un recurso pertenece a ella.
 *    - defaults: materia, curso y DOK que se proponen si el administrador
 *      no los indica.
 * ------------------------------------------------------------------------- */
(function () {
  const INF = ["Infantil 3 años", "Infantil 4 años", "Infantil 5 años"];
  const PRIM = ["1º Primaria", "2º Primaria", "3º Primaria", "4º Primaria", "5º Primaria", "6º Primaria"];
  const P36 = ["3º Primaria", "4º Primaria", "5º Primaria", "6º Primaria"];
  const DOC = ["Para el docente"];

  /** Pequeña ayuda para escribir subcategorías de forma compacta. */
  const sub = (id, name, icon, keywords, areas, grades, dok) => ({
    id,
    name,
    icon,
    keywords,
    defaults: { areas, grades, dokLevel: dok }
  });

  window.INITIAL_CATEGORIES = [
    {
      id: "cat_edu",
      name: "Educación y recursos docentes",
      icon: "🍎",
      description: "Recursos pensados para el aula y para el trabajo del docente.",
      subcategories: [
        sub("sub_aula", "Recursos y actividades para el aula", "🧩",
          ["actividad", "actividades", "ficha", "fichas", "worksheet", "worksheets", "aula", "ejercicios",
           "cuento", "cuentos", "lectura", "leer", "lectoescritura", "pictograma", "pictogramas",
           "recursos educativos", "material didactico", "imprimir", "alumnado", "comic", "infantil",
           "vinetas", "guiones graficos", "contar historias", "didactica", "recursos digitales", "libros",
           "lectura facil", "apuntes", "repaso"],
          ["Todas las áreas"], INF.concat(PRIM), 2),
        sub("sub_mates", "Matemáticas", "➗",
          ["matematicas", "matematica", "math", "maths", "numeros", "numero", "sumar", "sumas", "restas",
           "multiplicar", "multiplicacion", "division", "fracciones", "geometria", "calculo", "calculo mental",
           "manipulativos", "problemas", "medida", "tablas de multiplicar", "regletas"],
          ["Matemáticas"], PRIM, 2),
        sub("sub_stem", "Ciencias, tecnología, robótica y STEM", "🔬",
          ["ciencia", "ciencias", "stem", "steam", "robotica", "robot", "arduino", "circuito", "circuitos",
           "electronica", "anatomia", "cuerpo humano", "biologia", "quimica", "fisica", "experimento",
           "experimentos", "simulador", "simulacion", "simulaciones", "laboratorio", "naturaleza",
           "plantas", "animales", "3d", "tecnologia"],
          ["Conocimiento del Medio"], P36, 3),
        sub("sub_juegos", "Gamificación e interactivos", "🎲",
          ["juego", "juegos", "gamificacion", "gamificar", "quiz", "trivia", "concurso", "interactivo",
           "interactiva", "interactivas", "puzle", "puzles", "puzzle", "ruleta", "escape room", "juego de rol",
           "preguntas", "votacion", "votaciones", "repasar", "competir"],
          ["Todas las áreas"], PRIM, 2),
        sub("sub_progr", "Programación para niños", "💻",
          ["programacion", "programar", "codigo", "coding", "code", "scratch", "bloques",
           "pensamiento computacional", "algoritmo", "codificar", "scratchjr", "programa con bloques"],
          ["Competencia digital"], PRIM, 3),
        sub("sub_ia_doc", "Plataformas docentes con IA", "🤖",
          ["docente", "docentes", "profesor", "profesorado", "teacher", "teachers", "planificar",
           "planificacion", "rubrica", "rubricas", "plan de clase", "planes de clase", "lecciones",
           "leccion", "generador", "evaluar", "adaptar", "tutor", "preparar clases", "con ia", "pizarra",
           "plataforma", "herramientas de aula", "organizar clases", "debates"],
          ["Todas las áreas"], DOC, 2),
        sub("sub_lomloe", "Currículo LOMLOE y situaciones de aprendizaje", "📘",
          ["lomloe", "curriculo", "curricular", "situacion de aprendizaje", "situaciones de aprendizaje",
           "sda", "programacion didactica", "programacion docente", "unidad didactica", "competencias",
           "criterios de evaluacion", "saberes basicos", "plantilla", "plantillas", "concrecion"],
          ["Todas las áreas"], DOC, 3),
        sub("sub_guias_ia", "Guías e informes sobre IA en educación", "📑",
          ["guia", "informe", "informes", "libro", "ia en educacion", "inteligencia artificial en educacion",
           "uso responsable", "unesco", "intef", "ocde", "etica", "documento"],
          ["Competencia digital"], DOC, 2),
        sub("sub_formacion", "Formación del profesorado y eventos", "🎓",
          ["formacion", "curso", "cursos", "webinar", "taller", "talleres", "masterclass", "mooc",
           "jornada", "jornadas", "evento", "congreso", "formacion del profesorado", "aprender a ensenar"],
          ["Competencia digital"], DOC, 2),
        sub("sub_blogs", "Blogs y comunidades educativas", "💬",
          ["blog", "comunidad", "foro", "podcast", "revista", "pedagogia", "experiencias", "red de docentes"],
          ["Todas las áreas"], DOC, 2),
        sub("sub_historia", "Historia, geografía y mapas", "🗺️",
          ["historia", "historico", "geografia", "mapa", "mapas", "atlas", "linea del tiempo",
           "lineas del tiempo", "cronologia", "paises", "capitales", "patrimonio", "relieve", "rios"],
          ["Conocimiento del Medio"], P36, 3)
      ]
    },
    {
      id: "cat_ia",
      name: "Inteligencia artificial – Herramientas",
      icon: "✨",
      description: "Herramientas de IA para que el docente prepare materiales.",
      subcategories: [
        sub("sub_chat", "Asistentes y chatbots", "💬",
          ["chatbot", "chat", "asistente", "conversacional", "gpt", "llm", "chatgpt", "gemini", "claude",
           "copilot", "preguntar", "inteligencia artificial"],
          ["Todas las áreas"], DOC, 2),
        sub("sub_imagen", "Imagen, diseño y 3D", "🎨",
          ["imagen", "imagenes", "diseno", "disenar", "dibujo", "dibujar", "ilustracion", "ilustraciones",
           "logo", "poster", "cartel", "carteles", "foto", "fotos", "modelo 3d"],
          ["Educación Artística"], DOC, 3),
        sub("sub_video", "Vídeo, avatares y edición", "🎬",
          ["video", "videos", "avatar", "avatares", "edicion", "editar video", "subtitulos", "animacion",
           "animaciones", "clips", "reels"],
          ["Educación Artística"], DOC, 3),
        sub("sub_audio", "Audio, voz, música y transcripción", "🎵",
          ["audio", "voz", "voces", "musica", "cancion", "canciones", "transcripcion", "transcribir",
           "narracion", "narrar", "texto a voz", "dictado", "sonido"],
          ["Educación Artística"], DOC, 2),
        sub("sub_escritura", "Escritura, presentaciones y productividad", "📝",
          ["escritura", "escribir", "texto", "textos", "presentacion", "presentaciones", "diapositivas",
           "resumen", "resumenes", "notas", "apuntes", "productividad", "estudio", "estudiar",
           "mapa mental", "esquema", "esquemas"],
          ["Lengua Castellana y Literatura"], DOC, 2),
        sub("sub_prompt", "Prompting y guías de uso", "🧭",
          ["prompt", "prompts", "instrucciones para la ia", "como pedir", "pedir", "guia de uso", "ingenieria de prompts",
           "inteligencia artificial"],
          ["Competencia digital"], DOC, 2)
      ]
    },
    {
      id: "cat_formacion",
      name: "Formación y cursos",
      icon: "🎓",
      description: "Cursos para seguir aprendiendo como docente.",
      subcategories: [
        sub("sub_cursos_ia", "Cursos de IA y automatización", "🧠",
          ["curso de ia", "cursos de ia", "machine learning", "aprendizaje automatico", "tutorial",
           "tutoriales", "academia", "academy", "automatizacion", "inteligencia artificial", "a tu ritmo"],
          ["Competencia digital"], DOC, 2),
        sub("sub_idiomas", "Idiomas", "🌍",
          ["idioma", "idiomas", "ingles", "english", "frances", "aleman", "vocabulario", "language",
           "languages", "pronunciacion", "phonics"],
          ["Lengua Extranjera (Inglés)"], ["1º Primaria", "2º Primaria", "3º Primaria", "4º Primaria", "5º Primaria", "6º Primaria"], 2)
      ]
    }
  ];
})();

/* ---------------------------------------------------------------------------
 * 3. Criterios de validación de utilidad educativa
 * ---------------------------------------------------------------------------
 *  Basados en la hoja «Resumen» del Excel: se eliminan los enlaces de riesgo
 *  (piratería, contenido para adultos, activadores y descargas no oficiales),
 *  los que contienen datos personales y los enlaces temporales (inicios de
 *  sesión, pagos, confirmaciones y búsquedas). Las categorías del Excel sin
 *  interés para el proyecto docente (compras, viajes, banca, negocio…) sirven
 *  como señales de «sin utilidad educativa».
 * ------------------------------------------------------------------------- */
window.EDU_RULES = {
  /** Puntos mínimos de «señal educativa» para aceptar un recurso. */
  MIN_EDU_SCORE: 1,

  /** Puntos mínimos para colocar el recurso en una subcategoría existente. */
  MIN_CATEGORY_SCORE: 2,

  /** Palabras que indican uso educativo (cada una suma 1 punto). */
  EDU_KEYWORDS: [
    "educacion", "educativo", "educativa", "educativos", "educativas", "aprender", "aprendizaje",
    "ensenar", "ensenanza", "alumno", "alumna", "alumnos", "alumnas", "alumnado", "estudiante",
    "estudiantes", "escuela", "colegio", "clase", "clases", "aula", "docente", "docentes",
    "maestro", "maestra", "profesor", "profesora", "profesorado", "didactica", "didactico",
    "pedagogia", "pedagogico", "curriculo", "infantil", "primaria", "ninos", "ninas", "nino", "nina",
    "lectura", "practicar", "repasar", "ejercicios", "actividades", "fichas", "evaluacion",
    "learn", "learning", "teach", "teacher", "teaching", "kids", "school", "student", "students",
    "classroom", "education", "educational", "matematicas", "ciencias", "historia", "geografia",
    "lengua", "ingles", "musica", "arte", "lomloe", "inclusion", "inclusiva", "dua",
    "material", "materiales", "libro", "libros", "lecturas", "estudiar", "estudio", "tareas", "unidades",
    "evaluaciones", "cuentos", "explicar", "explica", "ensena", "aprende", "conocimiento", "cientifico",
    "ciencia", "musical", "teoria", "anatomia", "patrimonio", "comprension", "lecciones", "leccion",
    "tutor", "tutoria", "curricular", "competencias", "matematico", "vocabulario", "ortografia"
  ],

  /** Palabras de herramientas de creación: utilidad «media» (0,5 puntos). */
  HALF_EDU_KEYWORDS: [
    "ia", "inteligencia artificial", "video", "videos", "imagen", "imagenes", "presentacion",
    "presentaciones", "diseno", "audio", "voz", "resumen", "resumenes", "texto", "escritura",
    "mapa", "mapas", "guia", "tutorial", "curso", "cursos", "crear", "crea", "disenar", "disena",
    "explorar", "juego", "juegos", "juega", "proyecto", "proyectos", "comic", "comics", "historia",
    "dibujo", "dibujos", "simulador", "circuito", "asistente", "chat", "preguntas", "linea del tiempo",
    "cancion", "acordes", "cerebro", "paisaje", "idioma", "idiomas", "narrar", "subtitulos", "infografia"
  ],

  /**
   * Grupos SIN utilidad educativa (del Excel). Si el recurso solo habla de
   * esto, se descarta con el motivo indicado.
   */
  NON_EDU_GROUPS: [
    {
      id: "compras",
      label: "compras y ofertas",
      keywords: ["comprar", "compra", "tienda", "oferta", "ofertas", "descuento", "descuentos", "cupon",
        "cupones", "rebajas", "carrito", "envio gratis", "lifetime deal", "appsumo", "amazon", "aliexpress",
        "shein", "outlet", "black friday", "precio", "precios", "electrodomesticos", "bricolaje"]
    },
    {
      id: "viajes",
      label: "viajes, ocio y deporte",
      keywords: ["vuelo", "vuelos", "hotel", "hoteles", "reserva", "reservar", "alquiler de coches",
        "turismo", "restaurante", "restaurantes", "futbol", "liga", "partido", "entradas", "billetes",
        "senderismo", "gimnasio"]
    },
    {
      id: "personal",
      label: "gestiones personales (banca, seguros, salud)",
      keywords: ["banco", "banca", "cuenta bancaria", "seguro", "seguros", "hipoteca", "prestamo",
        "factura", "facturas", "tarjeta de credito", "transferencia", "cita medica"]
    },
    {
      id: "negocio",
      label: "negocio, marketing y ventas",
      keywords: ["marketing", "seo", "ventas", "vender", "afiliados", "afiliacion", "leads", "prospeccion",
        "ecommerce", "dropshipping", "hosting", "dominio web", "alojamiento turistico", "newsletter",
        "clientes", "facturacion", "crm"]
    },
    {
      id: "ocio",
      label: "entretenimiento (series, películas, streaming)",
      keywords: ["streaming", "series", "peliculas", "netflix", "tv en directo", "television", "famosos",
        "cotilleo", "memes"]
    },
    {
      id: "tramites",
      label: "trámites, nóminas o sindicato",
      keywords: ["nomina", "nominas", "retribuciones", "sindicato", "boja", "boe", "tramite", "tramites",
        "subvencion", "subvenciones", "declaracion de la renta"]
    },
    {
      id: "desarrollo",
      label: "programación profesional (no es para el aula)",
      keywords: ["api", "sdk", "backend", "deploy", "docker", "kubernetes", "servidor", "framework",
        "devops", "base de datos", "npm"]
    }
  ],

  /** Contenido de riesgo: se rechaza SIEMPRE. */
  RISK_KEYWORDS: [
    "pirata", "pirateria", "crack", "keygen", "activador", "activar windows", "serial gratis",
    "torrent", "descarga gratis de peliculas", "apuestas", "casino", "porno", "xxx", "adultos",
    "contenido para adultos", "sexo", "hack de cuentas", "descargar gratis de pago"
  ],

  /** Partes de la dirección que indican un enlace temporal. */
  TEMPORARY_URL_PATTERNS: [
    "/login", "/signin", "/sign_in", "/sign-in", "/logon", "/checkout", "/cart", "/carrito",
    "/pago", "/payment", "/confirm", "/verify", "/reset-password", "/search?", "/buscar?",
    "google.com/search", "/unsubscribe"
  ],

  /**
   * Temas educativos que AÚN NO tienen sección. Si un recurso educativo no
   * encaja en ninguna subcategoría, el sistema mira esta lista para proponer
   * un nombre de sección nueva con sus criterios. Si no coincide con ninguno,
   * el nombre se construye con las palabras más repetidas del recurso.
   */
  PROPOSAL_TOPICS: [
    { name: "Música y expresión artística", keywords: ["musica", "musical", "ritmo", "melodia", "instrumento", "instrumentos", "cantar", "flauta", "partitura", "notas musicales"] },
    { name: "Plástica, dibujo y manualidades", keywords: ["plastica", "dibujo", "dibujar", "pintar", "pintura", "manualidades", "colorear", "colores", "arte"] },
    { name: "Educación física y salud", keywords: ["educacion fisica", "deporte", "deportes", "movimiento", "psicomotricidad", "salud", "alimentacion", "higiene", "juegos motores", "baile"] },
    { name: "Educación emocional y convivencia", keywords: ["emociones", "emocional", "sentimientos", "convivencia", "valores", "acoso", "bullying", "autoestima", "mindfulness", "relajacion", "tutoria"] },
    { name: "Lengua, lectura y escritura", keywords: ["lengua", "ortografia", "gramatica", "vocabulario", "lectoescritura", "caligrafia", "comprension lectora", "poesia", "letras", "silabas"] },
    { name: "Inclusión y atención a la diversidad", keywords: ["inclusion", "inclusiva", "diversidad", "nee", "tea", "autismo", "dislexia", "tdah", "accesibilidad", "adaptado", "adaptada", "pictogramas", "lectura facil"] },
    { name: "Religión y valores", keywords: ["religion", "biblia", "evangelio", "catequesis", "pastoral", "oracion", "jesus"] },
    { name: "Familias y comunicación con el centro", keywords: ["familias", "familia", "padres", "madres", "tutores legales", "comunicacion con familias", "agenda escolar"] },
    { name: "Evaluación y seguimiento del alumnado", keywords: ["evaluacion", "evaluar", "rubrica", "rubricas", "notas", "calificaciones", "seguimiento", "cuaderno del profesor", "observacion"] },
    { name: "Organización del aula y rutinas", keywords: ["rutinas", "horario", "asamblea", "organizacion del aula", "normas de clase", "temporizador", "cronometro", "turnos"] },
    { name: "Medio ambiente y sostenibilidad", keywords: ["medio ambiente", "reciclaje", "reciclar", "sostenibilidad", "ods", "ecologia", "clima", "huerto"] }
  ],

  /** Palabras vacías que no sirven para nombrar una sección nueva. */
  STOPWORDS: [
    "para", "como", "esta", "este", "estos", "estas", "desde", "sobre", "entre", "hasta", "donde",
    "cuando", "porque", "tambien", "puede", "pueden", "hacer", "tiene", "tienen", "muchos", "muchas",
    "todos", "todas", "cada", "otro", "otra", "otros", "otras", "nuestro", "nuestra", "pagina", "web",
    "sitio", "online", "gratis", "gratuito", "gratuita", "recurso", "recursos", "herramienta",
    "herramientas", "sirve", "usar", "uso", "permite", "manera", "forma", "https", "http", "www",
    "com", "org", "html", "with", "your", "from", "that", "this", "the", "and", "para", "ninos", "ninas",
    "clase", "aula", "alumnado", "alumnos", "docente", "docentes", "primaria", "infantil", "educacion",
    "educativo", "educativa", "educativos", "aprender", "aprendizaje", "actividades", "juegos"
  ],

  /** Partes de la dirección que indican datos personales. */
  PERSONAL_URL_PATTERNS: [
    "mail.google.com", "outlook.live.com", "token=", "password=", "session=", "sessionid=",
    "/edit", "drive.google.com/drive/u/", "docs.google.com/forms/d/e/", "/my-account", "/mi-cuenta",
    "/dashboard", "localhost", "192.168.", "127.0.0.1"
  ]
};

/* ---------------------------------------------------------------------------
 * 4. Recursos semilla del documento de especificaciones (12 recursos)
 * ---------------------------------------------------------------------------
 *  Se han añadido los campos «category» y «subcategory» para ubicarlos en
 *  la clasificación del Excel. El resto de campos es el del documento.
 * ------------------------------------------------------------------------- */
window.SPEC_RESOURCES = [
  {
    id: "rec_001", name: "ScratchJr", url: "https://www.scratchjr.org",
    description: "Programa con bloques de colores. Los niños crean cuentos animados y juegos sin saber leer mucho.",
    category: "Educación y recursos docentes", subcategory: "Programación para niños",
    areas: ["Matemáticas", "Educación Artística", "Lengua Castellana y Literatura"],
    stages: ["Infantil", "Primaria"], grades: ["Infantil 4 años", "Infantil 5 años", "1º Primaria", "2º Primaria"],
    competencies: ["Competencia digital", "Sentido de iniciativa y espíritu emprendedor"],
    activityType: "Diseño, creación interactiva y resolución de problemas",
    methodology: "Aprendizaje Basado en Proyectos (ABP)", dokLevel: 3,
    sdtElements: ["Autonomía", "Competencia"],
    udlPrinciples: ["Múltiples formas de representación", "Múltiples formas de acción y expresión"],
    accessibilityFeatures: ["Iconografía gráfica", "Navegación táctil nativa", "Sin dependencia de texto"],
    supportNeeds: ["Dificultades del aprendizaje", "TDAH", "Trastorno del Lenguaje"],
    language: "Multilingüe (Español incluido)", cost: "Gratuito", license: "Código Abierto / Gratuito", interest: "Alta"
  },
  {
    id: "rec_002", name: "ARASAAC", url: "https://arasaac.org",
    description: "Pictogramas gratis para comunicar y para hacer materiales adaptados.",
    category: "Educación y recursos docentes", subcategory: "Recursos y actividades para el aula",
    areas: ["Lengua Castellana y Literatura", "Conocimiento del Medio", "Educación Emocional"],
    stages: ["Infantil", "Primaria"],
    grades: ["Infantil 3 años", "Infantil 4 años", "Infantil 5 años", "1º Primaria", "2º Primaria", "3º Primaria"],
    competencies: ["Comunicación lingüística", "Competencia personal, social y de aprender a aprender"],
    activityType: "Andamiaje de comunicación y estructuración espacio-temporal",
    methodology: "Diseño Universal para el Aprendizaje", dokLevel: 2,
    sdtElements: ["Pertenencia", "Competencia"],
    udlPrinciples: ["Múltiples formas de representación", "Múltiples formas de acción y expresión"],
    accessibilityFeatures: ["Pictogramas normalizados", "Alto contraste", "Descargas vectoriales"],
    supportNeeds: ["TEA", "Discapacidad auditiva", "Parálisis cerebral", "Mutismo selectivo"],
    language: "Español y múltiples idiomas", cost: "Gratuito", license: "Creative Commons (BY-NC-SA)", interest: "Alta"
  },
  {
    id: "rec_003", name: "PhET Simulaciones Interactivas", url: "https://phet.colorado.edu/es/",
    description: "Simulaciones de ciencias y matemáticas. El alumnado cambia datos y ve qué pasa.",
    category: "Educación y recursos docentes", subcategory: "Ciencias, tecnología, robótica y STEM",
    areas: ["Matemáticas", "Conocimiento del Medio"], stages: ["Primaria"],
    grades: ["3º Primaria", "4º Primaria", "5º Primaria", "6º Primaria"],
    competencies: ["Competencia matemática y en ciencia, tecnología e ingeniería"],
    activityType: "Indagación científica, modelización y experimentación virtual",
    methodology: "Aprendizaje Basado en la Indagación (IBL)", dokLevel: 3,
    sdtElements: ["Autonomía", "Competencia"],
    udlPrinciples: ["Múltiples formas de representación", "Múltiples formas de implicación"],
    accessibilityFeatures: ["Subtítulos", "Descripción de audio interactiva", "Navegación por teclado", "Compatibilidad con lectores de pantalla"],
    supportNeeds: ["Baja visión", "Dificultades de comprensión abstracta"],
    language: "Español e Inglés", cost: "Gratuito", license: "Creative Commons (BY)", interest: "Alta"
  },
  {
    id: "rec_004", name: "Monarch Reader", url: "https://monarchreader.com",
    description: "Libros de lectura fácil. Se pueden usar con pulsadores.",
    category: "Educación y recursos docentes", subcategory: "Recursos y actividades para el aula",
    areas: ["Lengua Castellana y Literatura", "Lengua Extranjera (Inglés)"], stages: ["Infantil", "Primaria"],
    grades: ["Infantil 4 años", "Infantil 5 años", "1º Primaria", "2º Primaria", "3º Primaria"],
    competencies: ["Comunicación lingüística", "Competencia digital"],
    activityType: "Lectura accesible, audiolibro y creación de relatos",
    methodology: "Lectura Compartida y Enseñanza Multinivel", dokLevel: 1,
    sdtElements: ["Autonomía", "Pertenencia"],
    udlPrinciples: ["Múltiples formas de representación", "Múltiples formas de acción y expresión"],
    accessibilityFeatures: ["Soporte de conmutadores (switches)", "Texto-a-voz integrado", "Alto contraste personalizable", "Lectura de pantalla"],
    supportNeeds: ["Discapacidad motórica severa", "Discapacidad visual", "TEA"],
    language: "Multilingüe", cost: "Gratuito", license: "Creative Commons", interest: "Alta"
  },
  {
    id: "rec_005", name: "GeoGebra Primaria", url: "https://www.geogebra.org/elementary",
    description: "Mueve figuras y fracciones en la pantalla para entender la geometría y los números.",
    category: "Educación y recursos docentes", subcategory: "Matemáticas",
    areas: ["Matemáticas"], stages: ["Primaria"],
    grades: ["1º Primaria", "2º Primaria", "3º Primaria", "4º Primaria", "5º Primaria", "6º Primaria"],
    competencies: ["Competencia matemática y en ciencia, tecnología e ingeniería"],
    activityType: "Resolución de problemas espaciales y construcción geométrica",
    methodology: "Aprendizaje Basado en Problemas", dokLevel: 3,
    sdtElements: ["Competencia", "Autonomía"],
    udlPrinciples: ["Múltiples formas de representación", "Múltiples formas de acción y expresión"],
    accessibilityFeatures: ["Soporte de teclado", "Gráficos de alto contraste", "Lectores de pantalla en fórmulas"],
    supportNeeds: ["Discalculia", "Baja visión"],
    language: "Español", cost: "Gratuito", license: "No comercial / Gratuito", interest: "Alta"
  },
  {
    id: "rec_006", name: "Book Creator", url: "https://bookcreator.com",
    description: "El alumnado crea sus propios libros con voz, dibujos, texto y vídeo.",
    category: "Educación y recursos docentes", subcategory: "Recursos y actividades para el aula",
    areas: ["Lengua Castellana y Literatura", "Educación Artística", "Lengua Extranjera (Inglés)"],
    stages: ["Infantil", "Primaria"],
    grades: ["Infantil 5 años", "1º Primaria", "2º Primaria", "3º Primaria", "4º Primaria", "5º Primaria", "6º Primaria"],
    competencies: ["Comunicación lingüística", "Competencia en conciencia y expresión culturales"],
    activityType: "Composición de cuentos, cómics y diarios de aprendizaje",
    methodology: "Aprendizaje Cooperativo y ABP", dokLevel: 4,
    sdtElements: ["Autonomía", "Pertenencia", "Competencia"],
    udlPrinciples: ["Múltiples formas de acción y expresión", "Múltiples formas de implicación"],
    accessibilityFeatures: ["Subtítulos automáticos", "Dictado por voz", "Lector de libros integrado", "Accesible por teclado"],
    supportNeeds: ["Dislexia", "Disgrafía", "Dificultades motóricas leves"],
    language: "Español e Inglés", cost: "Freemium", license: "Propietaria", interest: "Alta"
  },
  {
    id: "rec_007", name: "Genially", url: "https://genial.ly/es/",
    description: "Crea juegos, escape rooms, infografías y líneas del tiempo interactivas.",
    category: "Educación y recursos docentes", subcategory: "Gamificación e interactivos",
    areas: ["Conocimiento del Medio", "Lengua Castellana y Literatura", "Educación Artística"],
    stages: ["Primaria"], grades: ["4º Primaria", "5º Primaria", "6º Primaria"],
    competencies: ["Competencia digital", "Competencia personal, social y de aprender a aprender"],
    activityType: "Gamificación educativa, escape rooms y mapas interactivos",
    methodology: "Gamificación Educativa", dokLevel: 3,
    sdtElements: ["Autonomía", "Pertenencia"],
    udlPrinciples: ["Múltiples formas de implicación", "Múltiples formas de representación"],
    accessibilityFeatures: ["Textos alternativos configurables", "Diseño responsive"],
    supportNeeds: ["Desmotivación", "TDAH"],
    language: "Español", cost: "Freemium", license: "Propietaria", interest: "Alta"
  },
  {
    id: "rec_008", name: "Tinkercad", url: "https://www.tinkercad.com",
    description: "Diseña objetos en 3D y prueba circuitos sencillos.",
    category: "Educación y recursos docentes", subcategory: "Ciencias, tecnología, robótica y STEM",
    areas: ["Matemáticas", "Conocimiento del Medio", "Educación Artística"], stages: ["Primaria"],
    grades: ["4º Primaria", "5º Primaria", "6º Primaria"],
    competencies: ["Competencia matemática y en ciencia, tecnología e ingeniería", "Competencia digital"],
    activityType: "Diseño 3D, prototipado e ingeniería básica",
    methodology: "Design Thinking / ABP", dokLevel: 4,
    sdtElements: ["Autonomía", "Competencia"],
    udlPrinciples: ["Múltiples formas de acción y expresión", "Múltiples formas de implicación"],
    accessibilityFeatures: ["Atajos de teclado", "Visualización 3D rotacional", "Interfaz sin distracciones"],
    supportNeeds: ["Altas capacidades", "Estilos de aprendizaje visoespaciales"],
    language: "Español", cost: "Gratuito", license: "Gratuito para centros educativos", interest: "Alta"
  },
  {
    id: "rec_009", name: "Chrome Music Lab", url: "https://musiclab.chromeexperiments.com",
    description: "Juega con sonidos, ritmos y melodías de forma visual.",
    category: "Educación y recursos docentes", subcategory: "Recursos y actividades para el aula",
    areas: ["Educación Artística", "Matemáticas"], stages: ["Infantil", "Primaria"],
    grades: ["Infantil 3 años", "Infantil 4 años", "Infantil 5 años", "1º Primaria", "2º Primaria", "3º Primaria", "4º Primaria", "5º Primaria", "6º Primaria"],
    competencies: ["Competencia en conciencia y expresión culturales", "Competencia digital"],
    activityType: "Composición musical visual e investigación acústica",
    methodology: "Exploración Lúdica Guiada", dokLevel: 2,
    sdtElements: ["Autonomía", "Competencia"],
    udlPrinciples: ["Múltiples formas de representación", "Múltiples formas de implicación"],
    accessibilityFeatures: ["Soporte táctil completo", "Entrada MIDI", "Retroalimentación puramente gráfica"],
    supportNeeds: ["Dificultades de lectoescritura", "Discapacidad auditiva parcial"],
    language: "Español e Inglés", cost: "Gratuito", license: "Código Abierto", interest: "Alta"
  },
  {
    id: "rec_010", name: "Blooket", url: "https://www.blooket.com",
    description: "Juegos de preguntas para repasar en equipo o por parejas.",
    category: "Educación y recursos docentes", subcategory: "Gamificación e interactivos",
    areas: ["Lengua Castellana y Literatura", "Matemáticas", "Lengua Extranjera (Inglés)"], stages: ["Primaria"],
    grades: ["2º Primaria", "3º Primaria", "4º Primaria", "5º Primaria", "6º Primaria"],
    competencies: ["Competencia personal, social y de aprender a aprender"],
    activityType: "Evaluación formativa, repaso activo y juegos de estrategia",
    methodology: "Gamificación y Aprendizaje Basado en Juegos", dokLevel: 2,
    sdtElements: ["Competencia", "Pertenencia"],
    udlPrinciples: ["Múltiples formas de implicación"],
    accessibilityFeatures: ["Tiempo ampliable por pregunta", "Texto de alto contraste"],
    supportNeeds: ["Dificultades de atención", "Desmotivación"],
    language: "Inglés (preguntas configurables en Español)", cost: "Freemium", license: "Propietaria", interest: "Alta"
  },
  {
    id: "rec_011", name: "Smile and Learn", url: "https://smileandlearn.com/es/",
    description: "Juegos y cuentos para aprender contenidos y emociones.",
    category: "Educación y recursos docentes", subcategory: "Gamificación e interactivos",
    areas: ["Lengua Castellana y Literatura", "Matemáticas", "Conocimiento del Medio", "Educación Emocional"],
    stages: ["Infantil", "Primaria"],
    grades: ["Infantil 3 años", "Infantil 4 años", "Infantil 5 años", "1º Primaria", "2º Primaria"],
    competencies: ["Competencia personal, social y de aprender a aprender", "Competencia digital"],
    activityType: "Actividades gamificadas adaptativas y refuerzo conceptual",
    methodology: "Enseñanza Personalizada Adaptativa", dokLevel: 1,
    sdtElements: ["Competencia"],
    udlPrinciples: ["Múltiples formas de representación", "Múltiples formas de acción y expresión"],
    accessibilityFeatures: ["Niveles de velocidad ajustables", "Modo pictográfico", "Fuente para personas con dislexia", "Compatibilidad con lectores de pantalla"],
    supportNeeds: ["TEA", "Dislexia", "TDAH", "Discapacidad intelectual"],
    language: "Español", cost: "Freemium", license: "Comercial / Licencias Escolares", interest: "Alta"
  },
  {
    id: "rec_012", name: "Mundo Primaria", url: "https://www.mundoprimaria.com",
    description: "Juegos, cuentos con preguntas de comprensión y fichas para Infantil y Primaria.",
    category: "Educación y recursos docentes", subcategory: "Recursos y actividades para el aula",
    areas: ["Lengua Castellana y Literatura", "Matemáticas", "Lengua Extranjera (Inglés)"],
    stages: ["Infantil", "Primaria"],
    grades: ["Infantil 5 años", "1º Primaria", "2º Primaria", "3º Primaria", "4º Primaria"],
    competencies: ["Comunicación lingüística", "Competencia matemática"],
    activityType: "Ejercitación lúdica guiada y lectura interactiva",
    methodology: "Aprendizaje Basado en Juegos", dokLevel: 1,
    sdtElements: ["Competencia"],
    udlPrinciples: ["Múltiples formas de representación"],
    accessibilityFeatures: ["Locución de consignas", "Interfaz simplificada"],
    supportNeeds: ["Refuerzo lectoescritor", "Dificultades de fluidez"],
    language: "Español", cost: "Gratuito", license: "Gratuito con soporte de patrocinio", interest: "Alta"
  }
];

/**
 * Catálogo inicial = 12 recursos del documento + recursos del Excel.
 * Si un recurso del Excel tiene el mismo dominio y nombre parecido que uno
 * del documento, se queda la ficha del documento (tiene más datos).
 * La fusión se hace en storage.js (EduStorage.buildInitialCatalog).
 */
window.INITIAL_RESOURCES = window.SPEC_RESOURCES.concat(window.EXCEL_RESOURCES || []);

/* ---------------------------------------------------------------------------
 * 5. Usuarios de demostración
 * ---------------------------------------------------------------------------
 *  Las contraseñas se guardan cifradas (SHA-256 con «sal»). Las de
 *  demostración se crean al primer arranque en storage.js.
 *  ¡Cámbialas en cuanto entres por primera vez!
 * ------------------------------------------------------------------------- */
window.DEMO_USERS = [
  { username: "admin", displayName: "Administración SAFA", role: "admin", password: "Admin2026!" },
  { username: "docente", displayName: "Docente de prueba", role: "docente", password: "Docente2026!" }
];
