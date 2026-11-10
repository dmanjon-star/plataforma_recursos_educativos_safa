#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generador de la semilla del catálogo (data/semilla/excel.json) a partir del Excel
«Clasificacion_paginas_web.xlsx», hoja «Para el proyecto docente».

Uso:
    python3 herramientas/generar_catalogo.py RUTA/Clasificacion_paginas_web.xlsx
    npm run catalogo      # vuelve a construir data/catalogo.json con la semilla

Qué hace (en este orden):
 1. Lee solo los recursos de interés «Alta» o «Media» (ya filtrados y
    clasificados en el Excel por categoría y subcategoría).
 2. Descarta los enlaces temporales que quedaban (inscripciones,
    solicitudes, convocatorias y sesiones de Zoom).
 3. Convierte cada enlace en un enlace PÚBLICO: si la dirección apunta a un
    espacio personal (un diseño propio, un panel, una clase, una sesión
    iniciada…), se sustituye por la página principal del sitio. También se
    quitan los parámetros de seguimiento (utm, fbclid, original_referer…).
 4. Elimina duplicados: deja un único enlace por nombre (el más corto).
 5. Añade una descripción breve, el nivel sugerido y la materia.
    - Los recursos de interés «Alta» tienen una descripción escrita a mano.
    - El resto recibe una descripción tipo según su subcategoría.
    - El nivel y la materia salen de la subcategoría y de palabras del nombre
      (por ejemplo «6º» → 6º Primaria; «Matemáticas» → Matemáticas).

Decisión documentada: el Excel no trae descripción, nivel ni materia, así que
se aplica la opción más sencilla (valores por subcategoría + reglas de
palabras). Los administradores pueden corregir cada ficha desde la web.

No se copia el Excel al repositorio porque contiene enlaces personales.
"""
import json
import re
import sys
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

import openpyxl

# ---------------------------------------------------------------------------
# Constantes de grados (deben coincidir con window.EDU_CONFIG.GRADES en data.js)
# ---------------------------------------------------------------------------
INF = ["Infantil 3 años", "Infantil 4 años", "Infantil 5 años"]
P12 = ["1º Primaria", "2º Primaria"]
P34 = ["3º Primaria", "4º Primaria"]
P56 = ["5º Primaria", "6º Primaria"]
PRIM = P12 + P34 + P56
DOC = ["Para el docente"]

# Valores por defecto de cada subcategoría: (grados, materias, nivel DOK, tipo)
DEFAULTS = {
    "Plataformas docentes con IA": (DOC, ["Todas las áreas"], 2),
    "Recursos y actividades para el aula": (INF + PRIM, ["Todas las áreas"], 2),
    "Matemáticas": (PRIM, ["Matemáticas"], 2),
    "Ciencias, tecnología, robótica y STEM": (P34 + P56, ["Conocimiento del Medio"], 3),
    "Gamificación e interactivos": (PRIM, ["Todas las áreas"], 2),
    "Programación para niños": (PRIM, ["Competencia digital"], 3),
    "Currículo LOMLOE y situaciones de aprendizaje": (DOC, ["Todas las áreas"], 3),
    "Guías e informes sobre IA en educación": (DOC, ["Competencia digital"], 2),
    "Formación del profesorado y eventos": (DOC, ["Competencia digital"], 2),
    "Blogs y comunidades educativas": (DOC, ["Todas las áreas"], 2),
    "Historia, geografía y mapas": (P34 + P56, ["Conocimiento del Medio"], 3),
    "Asistentes y chatbots": (DOC, ["Todas las áreas"], 2),
    "Imagen, diseño y 3D": (DOC, ["Educación Artística"], 3),
    "Vídeo, avatares y edición": (DOC, ["Educación Artística"], 3),
    "Audio, voz, música y transcripción": (DOC, ["Educación Artística"], 2),
    "Escritura, presentaciones y productividad": (DOC, ["Lengua Castellana y Literatura"], 2),
    "Prompting y guías de uso": (DOC, ["Competencia digital"], 2),
    "Cursos de IA y automatización": (DOC, ["Competencia digital"], 2),
    "Idiomas": (PRIM, ["Lengua Extranjera (Inglés)"], 2),
}

# Descripción tipo para los recursos sin descripción propia
TEMPLATES = {
    "Asistentes y chatbots": "Asistente de inteligencia artificial. Te ayuda a preparar clases, ideas y textos.",
    "Imagen, diseño y 3D": "Herramienta para crear imágenes y diseños. Sirve para hacer materiales visuales.",
    "Vídeo, avatares y edición": "Herramienta para crear o editar vídeos. Sirve para explicar temas con imágenes.",
    "Audio, voz, música y transcripción": "Herramienta de audio y voz. Sirve para narrar, crear música o pasar voz a texto.",
    "Escritura, presentaciones y productividad": "Herramienta para escribir, resumir o hacer presentaciones de clase.",
    "Prompting y guías de uso": "Guía para aprender a pedir cosas a la inteligencia artificial.",
    "Cursos de IA y automatización": "Curso para aprender inteligencia artificial a tu ritmo.",
    "Formación del profesorado y eventos": "Formación para docentes: cursos, talleres o jornadas.",
    "Blogs y comunidades educativas": "Blog o comunidad de docentes con ideas y experiencias de aula.",
    "Idiomas": "Recurso para aprender y practicar otro idioma.",
    "Matemáticas": "Recurso para practicar matemáticas.",
}

# Descripciones escritas a mano (lenguaje sencillo, frases cortas)
DESCRIPTIONS = {
    "Canva": "Para diseñar carteles, fichas y presentaciones con plantillas.",
    "NotebookLM": "Sube tus documentos y la IA te hace resúmenes, guías y audios.",
    "4Docent – Generador de SdA": "Crea situaciones de aprendizaje con ayuda de la IA.",
    "Andragogía Pro": "Asistente con IA para planificar sesiones de formación.",
    "Bibliotecaria virtual": "Asistente con IA que recomienda libros y lecturas.",
    "ChatGPT for Teachers": "Versión de ChatGPT pensada para docentes.",
    "Curipod": "Crea lecciones interactivas con preguntas y votaciones.",
    "DeepTutor": "Tutor con IA que explica temas paso a paso.",
    "Diffit": "Adapta un texto al nivel de lectura de tu alumnado.",
    "Eduaide.ai": "Genera actividades, rúbricas y planes de clase con IA.",
    "EducaGPT": "Chat con IA pensado para preguntas de educación.",
    "EducaXD (chat educativo)": "Chat educativo con IA para docentes.",
    "Escritorio Digital": "Pizarra y herramientas de aula en una sola pantalla.",
    "Gemini – Gem Storybook (cuentos ilustrados)": "Crea cuentos ilustrados con IA para leer en clase.",
    "GPT «Paideia»": "Asistente con IA para preparar materiales didácticos.",
    "IEST – Nemi Suite": "Conjunto de herramientas con IA para docentes.",
    "Ignite Copilot": "Asistente con IA para crear situaciones de aprendizaje.",
    "Kialo Edu": "Debates en línea para aprender a dar razones.",
    "Learn Your Way (Google)": "Convierte un tema en lecciones adaptadas con IA.",
    "Learnara": "Crea lecciones con IA de forma rápida.",
    "Learning Studio AI": "Crea cursos y materiales de estudio con IA.",
    "LearnPlace Assistant": "Asistente con IA para preparar clases.",
    "MagicSchool": "Muchas herramientas de IA para docentes en un solo sitio.",
    "MonkEdu": "Plataforma con IA para organizar clases y formación.",
    "Nolej": "Convierte un documento o vídeo en actividades interactivas.",
    "OpenMAIC (aula virtual)": "Aula virtual con IA para dar clases en línea.",
    "Pizarra interactiva (Aula37)": "Pizarra digital gratuita para usar en clase.",
    "Prof.ai": "Asistente con IA para preparar clases y evaluar.",
    "SchoolGoat": "Ayuda con IA para estudiar y repasar.",
    "SchoolHack": "Herramientas con IA para estudiar y preparar tareas.",
    "TeachMate": "Herramientas con IA para planificar y evaluar.",
    "Teachology": "Planifica unidades y evaluaciones con IA.",
    "Teachy": "Planes de clase y actividades hechos con IA.",
    "Twee": "Crea actividades de lectura e inglés con IA.",
    "Vibe Coding Educativo – Apps": "Colección de apps educativas hechas por docentes.",
    "Vive CoDig 2026 – Open source": "Recursos digitales libres para docentes.",
    "Artificis – Didáctica": "Ideas y recursos de didáctica para el aula.",
    "Autismo Navarra – Ciencias 3º Primaria": "Material adaptado de Ciencias para 3º de Primaria.",
    "Dinamic Multimedia": "Actividades interactivas para Infantil y Primaria.",
    "Eduteka": "Proyectos y recursos educativos para el aula.",
    "Guía Estudio – Recursos": "Fichas y recursos para estudiar y repasar.",
    "Hooktheory (teoría musical)": "Aprende cómo se forman las canciones y los acordes.",
    "IEST – Recursos digitales": "Lista de recursos digitales para el aula.",
    "Keiki (app infantil)": "App con juegos para aprender en Infantil.",
    "Khan Academy": "Vídeos y ejercicios gratis de muchas materias.",
    "Kiddo Worksheets": "Fichas para imprimir y generador de fichas.",
    "Kumubox": "Paquetes de material didáctico para el aula.",
    "Los apuntes de Majo": "Apuntes y esquemas de Primaria, fáciles de leer.",
    "ReadKidz": "Cuentos y lecturas para niños y niñas.",
    "Storyboard That": "Crea cómics y viñetas para contar historias.",
    "StoryTribe": "Crea guiones gráficos y cómics de forma sencilla.",
    "Averroes – Nombre de los números": "Actividad para aprender a escribir los números.",
    "BMath": "App para practicar cálculo mental.",
    "Cuaderno de matemáticas 6º (PDF)": "Cuaderno de actividades de matemáticas de 6º.",
    "Cymath": "Resuelve problemas de matemáticas paso a paso.",
    "Didax – Manipulativos virtuales": "Materiales manipulativos de matemáticas en pantalla.",
    "EMASF – Editorial (PDF)": "Documento sobre la enseñanza de las matemáticas.",
    "Matemáticas 6º Primaria – Repaso (PDF)": "Fichas de repaso de matemáticas de 6º.",
    "Matemáticas 6º – Plan de mejora (PDF)": "Plan de mejora con actividades de matemáticas de 6º.",
    "Matemáticas Inclusivas": "Cuadernos de matemáticas adaptados para todos.",
    "Math Learning Center – Apps": "Apps gratis de matemáticas: fracciones, números y más.",
    "MathGPT": "Resuelve y explica problemas de matemáticas con IA.",
    "MathGPT Pro": "Tutor de matemáticas con IA.",
    "MathsBot": "Herramientas y juegos para la clase de matemáticas.",
    "Orientación Andújar – Fichas de matemáticas": "Fichas de matemáticas para imprimir.",
    "Polypad": "Mesa virtual con fichas, figuras y regletas.",
    "Recursos educativos de Primaria – Matemáticas": "Actividades digitales de matemáticas.",
    "Toy Theater": "Juegos de matemáticas, lectura y arte para niños.",
    "Web de J. Ivorra (matemáticas)": "Página con recursos de matemáticas.",
    "Aprende Arduino": "Aprende Arduino paso a paso con ejemplos.",
    "BioDigital": "Cuerpo humano en 3D para explorar.",
    "BioDigital Human (anatomía 3D)": "Explora el cuerpo humano en 3D.",
    "Blueprint": "Herramienta para diseñar proyectos de tecnología.",
    "Diode (circuitos)": "Diseña y prueba circuitos eléctricos en pantalla.",
    "Estudio de esquemas electrónicos": "Aprende a dibujar esquemas de circuitos.",
    "FlyWire Codex (conectoma)": "Mapa del cerebro de una mosca para explorar.",
    "Fundación Descubre – Ciencia al fresquito": "Actividades de ciencia para hacer en grupo.",
    "Futureworkss (RA/RV, Arduino, electrónica)": "Cursos de realidad aumentada, Arduino y electrónica.",
    "Quimiclan": "Juegos para aprender química.",
    "Servier Medical Art": "Dibujos de ciencia y del cuerpo humano para usar.",
    "SimuCir (simulador de circuitos)": "Simulador de circuitos eléctricos.",
    "Tinkercad – Circuitos": "Aprende a montar circuitos en pantalla.",
    "Wokwi (simulador Arduino)": "Simula proyectos de Arduino sin placa.",
    "Afif Edu – Juegos": "Juegos educativos para jugar en clase.",
    "Classcraft (HMH)": "Convierte la clase en un juego de rol.",
    "Deck.Toys": "Crea rutas de actividades como un juego.",
    "Digipuzzle": "Puzles y juegos educativos gratis.",
    "Genially": "Crea juegos, presentaciones e infografías interactivas.",
    "Genially (presentación)": "Ejemplo de presentación interactiva hecha con Genially.",
    "GitHub · csepulvedai/jeopardy-educativo": "Juego de preguntas tipo concurso para clase.",
    "iEducando – Classcraft": "Guía para usar Classcraft en clase.",
    "Interacty": "Crea juegos y actividades interactivas.",
    "Juegos educativos online gratis": "Blog con juegos y actividades digitales.",
    "Mentimeter": "Haz preguntas y votaciones en directo en clase.",
    "QPlay (J.J. de Haro)": "Juego de preguntas para repasar en grupo.",
    "Wordwall": "Crea juegos: ruletas, parejas, sopas de letras y más.",
    "Yu-kai Chou – Gamificación (Octalysis)": "Libro sobre cómo usar el juego para motivar.",
    "Code.org Studio": "Aprende a programar con juegos y bloques.",
    "Code.org – Cursos para docentes": "Cursos para docentes sobre enseñar programación.",
    "CodeCombat": "Aprende a programar jugando.",
    "Coding for Kids": "Programación para niños con juegos.",
    "Lightbot": "Juego de lógica para empezar a programar.",
    "Aula Desigual – SdA sin barreras": "Situaciones de aprendizaje inclusivas, sin barreras.",
    "Canarias – Programación docente LOMLOE": "Ejemplos de programación docente LOMLOE.",
    "Currículo LOMLOE Primaria (Ministerio)": "Currículo oficial de Primaria.",
    "Educastur – Desarrollo curricular LOMLOE": "Guía para aplicar la LOMLOE en el aula.",
    "Ester Álvarez – Plantillas concreción curricular": "Plantillas para la concreción curricular.",
    "Oposición Infantil – Plantillas LOMLOE": "Plantillas para programar según la LOMLOE.",
    "Orientación Andújar": "Plantillas para unidades y situaciones de aprendizaje.",
    "Recursos LOMLOE y SdA – Plantillas": "Plantillas de situaciones de aprendizaje.",
    "CEP Jaén – Ejemplos de prompts con Gemini": "Ejemplos de prompts para docentes con Gemini.",
    "Educators Technology – Guía de actividades IA": "Guía con actividades de IA para clase (inglés).",
    "Euskadi – Guía de uso de IA en educación (PDF)": "Guía para usar la IA en educación.",
    "Google for Education – IA": "Ideas de Google para usar la IA en el aula.",
    "INTEF – Guía de IA (2026)": "Guía oficial del INTEF sobre IA en educación.",
    "Observatorio Tec – Libro IA generativa (PDF)": "Libro sobre IA generativa en educación.",
    "OCDE – Digital Education Outlook 2026": "Informe de la OCDE sobre educación digital.",
    "RAEIA – Libros": "Libros sobre IA en educación.",
    "Tecnologías Educativas – Actividades IA": "Libro de actividades con IA para clase.",
    "UDLA – Libro IA y Educación (PDF)": "Libro sobre IA y educación.",
    "UNESCO – Documento": "Documento de la UNESCO sobre educación.",
    "Canva – Curso para docentes": "Curso gratis para aprender a usar Canva en clase.",
    "Capital Atlas": "Mapa para aprender las capitales del mundo.",
    "Chronas (atlas histórico)": "Mapa de la historia del mundo año a año.",
    "ChronoAtlas": "Atlas histórico interactivo.",
    "GeaCron (atlas histórico)": "Mapas históricos del mundo por fechas.",
    "Historiqly – Mapa histórico": "Mapa con hechos históricos.",
    "IAPH – Proyecto PAGUS": "Proyecto sobre el paisaje y el patrimonio andaluz.",
    "Mapa topográfico (Earth Engine)": "Mapa del relieve de la Tierra.",
    "Timelory": "Crea líneas del tiempo.",
    "WolframAlpha": "Calcula y explica resultados de matemáticas y ciencias.",
    "Google Labs – Little Language Lessons": "Pequeñas lecciones de idiomas con IA.",
}

# Enlaces que son temporales (inscripciones, convocatorias…): no se publican
TEMPORARY_NAME = re.compile(r"Inscripción|Solicitud|Sesión Zoom|Webinar \(Zoom\)|Convocatoria", re.I)

# Rutas que apuntan a espacios personales → se usa la portada del sitio
PERSONAL_PATH = re.compile(
    r"/design/|/edit\b|/notebook/|/dashboard|/teams/|/management/|/app/presentation/|"
    r"/users/sign_in|/sign_in|/signin|/login|/account/|/logon|/c/[0-9a-f-]{8,}|/shared/|/classroom/|/board/guest|"
    r"/[0-9a-f-]{20,}/home|/results/bookmarks|/price\b|/pricing|/planes-y-precios|/offer/|"
    r"/projects$|/content/input|/tools$|/plan$|/activity-zone/|/perfv2/",
    re.I,
)

# Parámetros de seguimiento que se eliminan
TRACKING = re.compile(
    r"^(utm_.*|fbclid|gclid|original_referer|pli|authuser|ref|force|upgrade|flowid|campaign_id|"
    r"adset_name|adset_id|ad_id|lid|locale|setting|page|m|token|lang|params|crm_i|sk|invite_code|keyword|"
    r"network|device|matchtype|placement|el|htrafficsource|enter_from|wheretomembership|ncid|redirect|question)$",
    re.I,
)


def public_url(url: str) -> str:
    """Devuelve una versión pública y limpia del enlace."""
    parts = urlsplit(url.strip())
    path = parts.path or "/"
    if PERSONAL_PATH.search(path):
        path = "/"
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not TRACKING.match(k)]
    if path == "/":
        # En la portada de un sitio los parámetros solo sirven para seguimiento
        query = []
    # Se quitan los fragmentos (#...) salvo que sean rutas de una app (#/...)
    fragment = parts.fragment if parts.fragment.startswith("/") else ""
    return urlunsplit((parts.scheme or "https", parts.netloc.lower(), path, urlencode(query), fragment))


def grades_from_name(name: str, default):
    """Ajusta el nivel sugerido a partir de pistas del nombre."""
    m = re.search(r"([1-6])º", name)
    if m:
        return [f"{m.group(1)}º Primaria"]
    if re.search(r"infantil|keiki", name, re.I):
        return INF
    return list(default)


def areas_from_name(name: str, default):
    rules = [
        (r"matem|math|números", "Matemáticas"),
        (r"ciencia|anatom|química|quimi|biodigital", "Conocimiento del Medio"),
        (r"music|musical|hooktheory", "Educación Artística"),
        (r"historia|atlas|mapa|capital", "Conocimiento del Medio"),
        (r"cuento|lectura|read|story", "Lengua Castellana y Literatura"),
        (r"language|idioma|english|twee", "Lengua Extranjera (Inglés)"),
    ]
    found = [area for rx, area in rules if re.search(rx, name, re.I)]
    return sorted(set(found)) if found else list(default)


def link_type(url: str) -> str:
    if url.lower().endswith(".pdf") or "(PDF)" in url:
        return "Documento PDF"
    if "github.com" in url:
        return "Repositorio de código"
    if "youtube.com" in url or "youtu.be" in url:
        return "Vídeo"
    return "Página web"


def main(xlsx_path: str, out_path: str):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb["Para el proyecto docente"]
    by_name = {}
    for interest, category, subcategory, name, url, notes in ws.iter_rows(min_row=2, values_only=True):
        if not name or not url or interest not in ("Alta", "Media"):
            continue
        if TEMPORARY_NAME.search(name):
            continue
        clean = public_url(url)
        prev = by_name.get(name)
        # Se conserva el enlace más corto (normalmente la portada del recurso)
        if prev is None or len(clean) < len(prev["url"]):
            by_name[name] = {
                "interest": interest,
                "category": category,
                "subcategory": subcategory,
                "name": name,
                "url": clean,
                "notes": notes or "",
            }

    resources = []
    for i, item in enumerate(sorted(by_name.values(), key=lambda r: (r["category"], r["subcategory"], r["name"].lower())), 1):
        grades_def, areas_def, dok = DEFAULTS.get(item["subcategory"], (DOC, ["Todas las áreas"], 2))
        grades = grades_from_name(item["name"], grades_def)
        description = DESCRIPTIONS.get(item["name"]) or TEMPLATES.get(
            item["subcategory"], "Recurso digital útil para el docente."
        )
        if item["notes"]:
            description += " Nota: " + item["notes"]
        stages = sorted({"Infantil" if g.startswith("Infantil") else "Primaria" for g in grades if g != "Para el docente"})
        resources.append(
            {
                "id": f"xls_{i:03d}",
                "name": item["name"],
                "url": item["url"],
                "description": description,
                "category": item["category"],
                "subcategory": item["subcategory"],
                "areas": areas_from_name(item["name"], areas_def),
                "stages": stages,
                "grades": grades,
                "dokLevel": dok,
                "interest": item["interest"],
                "linkType": link_type(item["url"] + item["name"]),
                "cost": "Por confirmar",
                "language": "Por confirmar",
                "source": "Excel «Clasificación de páginas web»",
            }
        )

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(resources, fh, ensure_ascii=False, indent=1)
    print(f"{len(resources)} recursos escritos en {out_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Uso: generar_catalogo.py RUTA/Clasificacion_paginas_web.xlsx [salida.js]")
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "data/semilla/excel.json")
