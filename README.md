# plataforma_recursos_educativos_safa

Plataforma interactiva con recursos interactivos para educación infantil, primaria y enseñanzas medias, que permite a cualquier docente usar recursos educativos interactivos para generar procesos de aprendizaje motivantes, gamificados, personalizados e inclusivos.

## Recursos SAFA: qué es

Una web sencilla para que los docentes **busquen, filtren y usen** recursos educativos ya revisados y clasificados, y para que la administración **añada recursos** que el sistema **revisa y coloca solo** en su sección.

- **375 recursos** al empezar: los 12 del documento de especificaciones y 363 del Excel «Clasificación de páginas web» (interés alto y medio, sin duplicados ni enlaces personales).
- **3 categorías y 19 secciones** (subcategorías) del Excel, cada una con sus criterios.
- **Docentes**: buscar, filtrar por categoría, sección, materia y curso, abrir y descargar.
- **Administración**: añadir, editar y borrar recursos, categorías y cuentas; copias de seguridad.
- **Revisión automática** al añadir: comprueba la utilidad educativa (si no la tiene, no se publica y se explica por qué), detecta duplicados, elige la sección o **propone una sección nueva** con nombre y criterios.
- **Accesible** (WCAG 2.1 AA, 0 fallos en axe-core): teclado, lector de pantalla, alto contraste, letra grande, botones grandes con icono y texto. Funciona en ordenador y tableta.

## Cómo abrirla

Sin instalar nada: abre `index.html` con Chrome, Edge, Firefox o Safari.

Cuentas de prueba (cámbialas al entrar por primera vez):

| Tipo | Usuario | Contraseña |
|---|---|---|
| Docente | `docente` | `Docente2026!` |
| Administración | `admin` | `Admin2026!` |

Para publicarla, sube la carpeta a cualquier alojamiento estático (GitHub Pages, Nginx, Apache…).

## Documentación

| Documento | Para quién |
|---|---|
| [Guía para docentes](docs/GUIA_DOCENTES.md) | Docentes |
| [Guía para administración](docs/GUIA_ADMINISTRADORES.md) | Equipo de administración |
| [Arquitectura y modelo de datos](docs/ARQUITECTURA.md) | Equipo técnico: estructura, datos, permisos, algoritmos y decisiones |
| [Mensajes de alerta y textos de ayuda](docs/MENSAJES.md) | Revisión de textos |

## Estructura

```
index.html            Pantallas: entrar, catálogo, administrar, ayuda
css/styles.css        Diseño accesible y adaptable
js/data-catalogo.js   Recursos generados desde el Excel
js/data.js            Categorías, criterios, reglas de validación, recursos del documento, cuentas de prueba
js/utils.js           Texto, similitud (Levenshtein, Dice), duplicados, SHA-256
js/storage.js         Guardado en el navegador, importar y exportar
js/auth.js            Inicio de sesión y permisos
js/classifier.js      Validación educativa, clasificación y propuesta de secciones
js/app.js             Interfaz
herramientas/         Generador del catálogo desde el Excel
pruebas/              Pruebas automáticas
```

## Pruebas

```bash
node --test pruebas/*.test.js
```

```bash
node pruebas/e2e.js
```

La segunda necesita Playwright con Chromium.

## Aviso de seguridad

Como pide la especificación, la web no usa servidor: los datos y las cuentas se guardan en el navegador. Esto vale para organizar el uso en el centro, pero no es una protección fuerte. Para publicarla en Internet con garantías, el inicio de sesión y el guardado deben pasar a un servidor (ver [Arquitectura](docs/ARQUITECTURA.md#7-seguridad)).
