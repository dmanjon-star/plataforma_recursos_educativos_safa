# Cómo poner en marcha la plataforma

Desde la versión 2, la plataforma **necesita un servidor** (Node.js). Antes bastaba con abrir `index.html`, pero ahora hay pagos, enlaces por correo, permisos reales por perfil y lectura automática de páginas web, y nada de eso se puede hacer de forma segura solo en el navegador.

## 1. Probarla en tu ordenador

Necesitas [Node.js](https://nodejs.org) 20 o superior.

1. Descarga el repositorio (botón verde **Code › Download ZIP**) y descomprímelo.
2. Abre una terminal dentro de la carpeta.
3. Instala lo necesario (solo la primera vez):

```bash
npm install
```

4. Arranca la plataforma en modo demostración:

```bash
DEMO=1 ADMIN_PASSWORD=Admin2026! npm start
```

En Windows (PowerShell) se escribe así:

```bash
$env:DEMO="1"; $env:ADMIN_PASSWORD="Admin2026!"; npm start
```

5. Abre http://localhost:3000 en el navegador.

Cuentas de la demostración:

| Perfil | Usuario | Contraseña |
|---|---|---|
| Administración | `admin` | `Admin2026!` |
| Docente del centro | `docente` | `Docente2026!` |
| VIP | `vip` | `Vip2026!` |
| De pago | `pago` | `Pago2026!` |

Sin `DEMO=1` solo se crea `admin`. Si no pones `ADMIN_PASSWORD`, la contraseña se genera sola y aparece **una vez** en la terminal.

## 2. Publicarla en Internet

Sirve cualquier servicio que ejecute Node.js o Docker: Render, Railway, Fly.io, un servidor del centro, etc. Dos condiciones:

1. **Disco persistente** para `data/privado` (cuentas, sesiones, pagos y cursos). Sin él, las cuentas se borran en cada actualización. En Render es un «Disk»; en Docker, un volumen (el `Dockerfile` ya lo declara).
2. **https** (todos estos servicios lo dan). Pon la dirección final en `BASE_URL`.

Pasos generales:

1. Crea el servicio a partir de este repositorio.
2. Comando de instalación: `npm ci`. Comando de arranque: `npm start` (o usa el `Dockerfile`).
3. Añade las variables de entorno (lista en `.env.ejemplo`). Como mínimo: `BASE_URL` y `ADMIN_PASSWORD`. En Render, Railway, Fly.io o detrás de Nginx, añade también `TRUST_PROXY=1`.
4. Monta el disco persistente en `data/privado`.

GitHub Pages ya **no sirve**: solo publica páginas estáticas.

## 3. Configuración por partes

Todas las claves van en **variables de entorno** del servicio (o en un archivo `.env` que nunca se sube a GitHub). La lista completa con explicaciones está en `.env.ejemplo`.

### Correo (enlaces de invitado)

Rellena `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM`. Con Google Workspace se usa `smtp.gmail.com`, puerto 587 y una «contraseña de aplicación».

Sin correo configurado:
- la administración puede seguir invitando: el enlace aparece en pantalla para copiarlo y enviarlo;
- la opción «Probar gratis» de la pantalla de inicio se oculta.

### Pagos

| Pasarela | Variables | Qué hacer en su web |
|---|---|---|
| Stripe (tarjeta) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | 1. Copia la clave secreta (empieza por `sk_`). 2. Crea un webhook a `BASE_URL/api/pagos/stripe/webhook` con el evento `checkout.session.completed` y copia su secreto (`whsec_…`). |
| PayPal | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV` | Crea una «app» en developer.paypal.com y copia sus credenciales. Usa `sandbox` para probar y `live` para cobrar de verdad. |

Puedes activar una o las dos. El precio, la moneda y los meses de acceso se cambian con `PRICE_EUR`, `CURRENCY` y `PAID_ACCESS_MONTHS`.

**Prueba siempre primero en modo de pruebas** (claves `sk_test_…` de Stripe y `sandbox` de PayPal).

### Guardado automático en GitHub

1. En GitHub crea un token *fine-grained* (Settings › Developer settings › Personal access tokens). Dale acceso **solo** a este repositorio con el permiso **Contents: Read and write**.
2. Pon `GITHUB_TOKEN`, `GITHUB_REPO` (por ejemplo `dmanjon-star/plataforma_recursos_educativos_safa`) y, si quieres, `GITHUB_BRANCH` y `SYNC_INTERVAL_HOURS`.

Cada vez que se añade, cambia o borra un recurso o una sección, el servidor sube `data/catalogo.json` y los archivos nuevos de `data/archivos/`. Lo hace cada `SYNC_INTERVAL_HOURS` horas (24 por defecto) o al pulsar **Guardar ahora en GitHub**. Cada subida queda en el historial del repositorio.

Las cuentas, sesiones, pagos y cursos **no se suben nunca**: son datos personales o contenido de pago. Si el repositorio es público, el catálogo completo será visible en GitHub; si quieres que solo se vea dentro de la plataforma, haz el repositorio privado.

### Ficha automática con inteligencia artificial (opcional)

Sin configurar nada, la plataforma ya clasifica y etiqueta por reglas. Con `ANTHROPIC_API_KEY`, Claude redacta la ficha a partir de la página:
- una descripción en lenguaje sencillo;
- materias, cursos, etiquetas y sección;
- la decisión de si el recurso es educativo.

Cada análisis es una llamada de pago a la API de Anthropic. Las reglas de seguridad (enlaces de riesgo, temporales o personales) se aplican siempre antes.

## 4. Copias de seguridad

- **Catálogo:** está en GitHub (si lo configuras) y se puede descargar en **Administrar › Copias y GitHub**.
- **Cuentas, pagos y cursos:** copia la carpeta `data/privado` del servidor con regularidad.

## 5. Pasar los datos de la versión 1

La versión 1 guardaba los cambios en el navegador. Para traerlos:
1. En la versión 1, entra como administración y descarga la copia (JSON).
2. En la versión 2, ve a **Administrar › Copias y GitHub › Cargar recursos** y elige ese archivo.

Las cuentas de la versión 1 no se pueden traer, porque sus contraseñas solo estaban en ese navegador. Hay que crearlas de nuevo.
