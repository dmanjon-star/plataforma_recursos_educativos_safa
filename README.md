# plataforma_recursos_educativos_safa

Plataforma interactiva con recursos interactivos para educación infantil, primaria y enseñanzas medias, que permite a cualquier docente usar recursos educativos interactivos para generar procesos de aprendizaje motivantes, gamificados, personalizados e inclusivos.

## Recursos SAFA: qué es

Una web sencilla para que los docentes **busquen, filtren y usen** recursos educativos ya revisados y clasificados, y para que la administración **añada recursos con solo pegar su enlace**.

- **375 recursos** al empezar: los 12 del documento de especificaciones y 363 del Excel «Clasificación de páginas web». Están en 3 categorías y 19 secciones.
- **Con solo el enlace**, la plataforma:
  - lee la página;
  - comprueba si tiene utilidad educativa (si no la tiene, no se publica y explica por qué);
  - detecta duplicados;
  - elige la sección o **propone una nueva**;
  - rellena la ficha: descripción, materia, curso, precio, idioma y **etiquetas**.

  Con una clave de Claude, la ficha la redacta la inteligencia artificial en lenguaje sencillo.
- **Perfiles:**

  | Perfil | Qué ve |
  |---|---|
  | 🎁 Invitado | Prueba gratis con enlace y credenciales generadas por la plataforma; ve una selección de recursos |
  | ⭐ VIP | Todos los recursos |
  | 💳 De pago | Todos los recursos y los **cursos de formación** tras pagar con **Stripe o PayPal** |
  | 👩‍🏫 Docente del centro | Todos los recursos |
  | ⚙️ Administración | Todo |

- **El repositorio se actualiza solo:** los cambios del catálogo se suben a GitHub cada día (o al pulsar un botón).
- **Accesible** (WCAG 2.1 AA, 0 fallos en axe-core): teclado, lector de pantalla, alto contraste, letra grande y botones grandes con icono y texto. Funciona en ordenador y tableta.

## Cómo arrancarla

Necesita [Node.js](https://nodejs.org) 20 o superior.

```bash
npm install
```

```bash
DEMO=1 ADMIN_PASSWORD=Admin2026! npm start
```

Abre http://localhost:3000. Las cuentas de la demostración, la publicación en Internet y la configuración del correo, Stripe, PayPal, GitHub y la IA están en **[docs/DESPLIEGUE.md](docs/DESPLIEGUE.md)**. Todas las variables están explicadas en [.env.ejemplo](.env.ejemplo).

## Documentación

| Documento | Para quién |
|---|---|
| [Guía para docentes](docs/GUIA_DOCENTES.md) | Docentes e invitados |
| [Guía para administración](docs/GUIA_ADMINISTRADORES.md) | Equipo de administración |
| [Puesta en marcha](docs/DESPLIEGUE.md) | Quien instala el servidor |
| [Arquitectura y modelo de datos](docs/ARQUITECTURA.md) | Equipo técnico |
| [Mensajes de alerta y textos de ayuda](docs/MENSAJES.md) | Revisión de textos |

## Estructura

```
index.html, css/, js/    Interfaz (HTML, CSS y JavaScript sin librerías)
servidor/                Servidor Node.js: cuentas, catálogo, clasificación, pagos, correo, GitHub
data/catalogo.json       Catálogo (se actualiza solo en GitHub)
data/semilla/            Recursos originales (documento y Excel)
data/privado/            Cuentas, pagos y cursos (NO se suben a GitHub)
herramientas/            Generador de la semilla a partir del Excel
pruebas/                 Pruebas automáticas
```

## Pruebas

```bash
npm test
```

```bash
npm run e2e
```

La segunda prueba usa Playwright con Chromium. Recorre todos los perfiles y paga con un Stripe y un PayPal **simulados**, así que no se cobra nada.
