# Mensajes de alerta y textos de ayuda

Todos los textos están escritos en **lenguaje sencillo**: frases cortas, palabras comunes, un icono junto a cada idea y siempre una acción posible («¿Qué puedo hacer?»). Esta lista sirve para revisarlos sin leer el código.

## Inicio de sesión (`js/auth.js`)

| Situación | Mensaje |
|---|---|
| Campos vacíos | Escribe tu usuario y tu contraseña. |
| Usuario o contraseña incorrectos | El usuario o la contraseña no son correctos. Revísalos y prueba otra vez. |
| 5 fallos seguidos | Has fallado muchas veces. Espera N segundos y vuelve a probar. |
| Docente entra en «Administrar» | Esa parte es solo para administración. |
| Acción sin permiso | No tienes permiso para hacer esto. Solo el equipo de administración puede. |

## Formulario de recurso (`js/classifier.js` · `checkRequired`)

| Campo | Mensaje |
|---|---|
| Nombre | Escribe el nombre del recurso. |
| Enlace vacío | Pega el enlace del recurso o sube un archivo. |
| Enlace mal escrito | El enlace no es correcto. Debe empezar por https:// |
| Descripción corta | Escribe una descripción de al menos 15 letras: ¿para qué sirve en clase? |
| Archivo grande | ⚠️ El archivo es demasiado grande (máximo 1,5 MB). Súbelo a Drive y pega aquí el enlace. |

## Rechazo por falta de utilidad educativa (`validateEducational`)

| Código | Título | Motivo | ¿Qué puedo hacer? |
|---|---|---|---|
| `RISK` | Este recurso no se puede publicar | Puede ser peligroso o no es apropiado para un colegio. Hemos visto: «…». | No uses este enlace. Busca la página oficial del recurso. |
| `TEMPORARY` | Este enlace es temporal | Es una página para entrar, pagar o buscar. Mañana puede no funcionar. | Copia la dirección de la página principal del recurso y vuelve a probar. |
| `PERSONAL` | Este enlace tiene datos personales | La dirección es de tu cuenta (correo, sesión abierta o documento en edición). Otras personas no podrán abrirla. | Usa el enlace público del recurso, el que puede abrir cualquier persona. |
| `NOT_EDUCATIONAL` | No tiene utilidad educativa | Parece una página de *compras y ofertas* (palabras: «…»), no un recurso para enseñar. / No hemos encontrado para qué sirve en clase. | Si sí sirve para clase, explícalo en la descripción. Por ejemplo: «Sirve para practicar sumas en 2.º de Primaria». |

Siempre se añade: **El recurso no se ha publicado.**

## Otros resultados de la revisión (`js/app.js` · `renderAnalysis`)

| Resultado | Texto principal |
|---|---|
| Clasificado | ✅ ¡Todo bien! Este recurso sirve para clase. El sistema lo coloca en: *Categoría › Sección*. ¿Prefieres otra sección? Puedes cambiarla aquí. |
| Duplicado | ⚠️ Puede que este recurso ya exista. *La dirección web es la misma que la de «…» / El nombre se parece un 90 % a «…»*. ¿Qué quieres hacer? |
| Sección nueva | 💡 Es educativo, pero no encaja en ninguna sección. *El recurso habla de «flauta», «partitura» y no hay ninguna sección sobre ese tema.* Te proponemos crear una sección nueva. Revisa el nombre y las palabras clave. |
| Publicado | ✅ «…» se ha publicado en «…». |
| Descartado | Recurso descartado. No se ha guardado nada. |
| Sin espacio | No se ha podido guardar: el navegador no tiene espacio. Borra archivos grandes o descarga una copia. |

## Catálogo

| Lugar | Texto |
|---|---|
| Ayuda bajo el título | Escribe lo que buscas o elige una sección. Pulsa **Abrir** para usar un recurso. |
| Contador | Hay N recursos. Busca o elige una categoría. / Hemos encontrado N de M recursos. |
| Sin resultados | 🔎 No hay recursos con estos filtros. Prueba con otra palabra o quita algún filtro. |
| Enlace (lector de pantalla) | Abrir *nombre* (se abre en una pestaña nueva) |

## Categorías y cuentas

| Situación | Mensaje |
|---|---|
| Borrar sección con recursos | No se puede borrar «…»: tiene N recursos. Primero muévelos (Editar recurso) o bórralos. |
| Nombre repetido | Ya hay una sección con ese nombre. |
| Sin criterios | Escribe al menos una palabra clave. |
| Usuario no válido | El usuario debe tener de 3 a 30 letras o números, sin espacios ni tildes. |
| Contraseña débil | La contraseña debe tener 8 caracteres o más. / …al menos un número. |
| Borrar propia cuenta | No puedes borrar tu propia cuenta. |
| Último admin | Debe quedar al menos una cuenta de administración. |
