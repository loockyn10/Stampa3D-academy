# PRINT_FILES — Biblioteca de proyectos 3MF (Mi Taller → Productos)

Estado: implementado en código (2026-11-02). Migration `20261102130000_product_print_files.sql` **no aplicada en remoto**. Decisión: D041. Resumen de arquitectura: ARCHITECTURE §27.

## 1. Qué es

Cada producto de Mi Taller puede guardar **proyectos 3MF listos para imprimir**, organizados por **laminador** (Bambu Studio, Flash Studio, OrcaSlicer), **impresora** (opcional) y **pieza** (opcional). Se ve en el detalle del producto, sección «Archivos de impresión». No es un sistema paralelo: cuelga de `products` / `product_components` / `printers`.

Fuera de alcance (a propósito): laminado en servidor, conversión entre perfiles, envío a impresoras, lectura obligatoria de metadatos del 3MF, inventario nuevo, calculadora nueva, app de escritorio auxiliar.

## 2. Reglas de producto

- Un archivo **nunca se modifica ni se convierte**. No se promete que un proyecto de un laminador funcione en otro.
- Muchos proyectos por producto (hasta 30), incluso varios del mismo laminador. Un proyecto puede ser completo (sin pieza) o de una pieza.
- Tiempo, gramos y material de un proyecto son **informativos**: no alimentan el costo, el precio ni el tiempo del producto, ni se escriben en `products`. Test que lo garantiza: `tests/product-print-files.test.mjs` (los componentes y acciones no referencian `base_cost`, `sale_price`, `print_time_minutes` ni el motor de precios) y `tests/product-print-files-db.test.mjs` (editar un proyecto deja el producto intacto).
- Al tocar un laminador sin proyecto se explica que falta y se ofrece agregarlo; **nunca** se abre silenciosamente el de otro laminador.
- Un solo proyecto del laminador elegido → se abre directo. Varios → se elige cuál. Ninguno → alta.
- En celulares/tablets se prioriza la descarga.

## 3. Datos

Tabla `public.product_print_files` (RLS por dueño + `has_platform_access`, admin total): `id`, `user_id`, `product_id` (FK cascade), `component_id` (FK `set null`), `name`, `slicer` (forma validada; la lista vive en `src/lib/print-files/slicers.ts`), `printer_id` (FK a `printers`, `set null`) + `printer_name` (texto libre/etiqueta), `file_name`, `storage_path` (único), `file_size`, `status` (`pending`/`ready`), `replaces_id`, `est_minutes`, `est_grams`, `material`, timestamps.

- Un trigger `SECURITY DEFINER` exige que producto, pieza e impresora sean del mismo usuario (y la pieza del mismo producto).
- Un CHECK ata `storage_path` a `{user_id}/{product_id}/{uuid}.3mf`.
- Privilegios por columna: el navegador solo inserta filas `pending` y edita metadatos. `status`, `file_size` y `storage_path` solo los cambia el servidor tras verificar el objeto.
- Impresoras: se **reutiliza** el catálogo propio (`printers`); si no hay o es otra, nombre libre.

Bucket `product-print-files`: **privado**, tope 150 MB, **sin policies** sobre `storage.objects` (solo `service_role`). Ruta `{user_id}/{product_id}/{file_id}.3mf`.

## 4. Flujo de archivos

1. **Subir**: el navegador verifica extensión, tamaño y que sea un 3MF (solo directorio central del ZIP, sin descomprimir); `prepareProductPrintFileUploadAction` valida sesión/acceso/feature flag/propiedad, crea la fila `pending` y devuelve una **signed upload URL** (el servidor fija la ruta); el navegador sube directo al bucket; `completeProductPrintFileUploadAction` inspecciona el objeto **en el servidor** con peticiones `Range` (nunca lo descarga entero) y recién entonces lo marca `ready`. Si falla, se borran objeto y fila.
2. **Reemplazar**: se sube un archivo nuevo como fila `pending` con `replaces_id` que hereda los datos; al quedar `ready` se elimina el objeto y la fila anteriores. El anterior no se toca hasta que el nuevo se verificó.
3. **Eliminar**: primero el objeto, luego la fila (si el almacenamiento falla, no se borra la fila).
4. **Huérfanos**: subidas `pending` de más de 1 h se limpian (fila + objeto) al preparar la siguiente subida de ese producto. Productos eliminados en la app se **archivan** (`is_active=false`), no se borran, así que sus archivos se conservan; un `DELETE` real de `products` borraría las filas por cascade pero no los objetos (no ocurre desde la app).
5. **Descargar**: URL firmada de 60 s generada al hacer clic.

### Verificación del contenedor 3MF (`three-mf-container.ts`)

No confía en la extensión. Comprueba firma ZIP, directorio central coherente, `[Content_Types].xml` + al menos una parte `.model`, ≤ 20 000 entradas, tamaños declarados dentro de los límites existentes (`THREE_MF_LIMITS`: 512 MB por entrada, 1 GB total), sin cifrado, sin ZIP64 y sin rutas `..`/absolutas. **No descomprime**, así que una bomba de compresión solo se detecta por los tamaños declarados (los laminadores igual la procesarán al abrir: por eso se rechazan tamaños anómalos).

## 5. Apertura en el laminador — investigación (Fase 4)

Método: lectura del **código fuente** de cada laminador (no de binarios instalados ni de documentación de marketing). Resultados:

| Laminador | Esquema | Verificado en | Notas |
|---|---|---|---|
| **Bambu Studio** | Windows: `bambustudio://open?file=<URL>` · macOS: `bambustudioopen://<URL>` | `src/slic3r/GUI/GUI_App.cpp` (`post_init`, `MacOpenURL`, `extract_model_download_url_from_open/mac`, `is_trusted_model_download_url`) en la rama `master` de `bambulab/BambuStudio` | Solo `http(s)`. En compilaciones públicas, una URL fuera de su lista de sitios de confianza (MakerWorld y CDN de Bambu) muestra «This file is not from a trusted site, do you want to open it anyway?»: el usuario confirma. El nombre del archivo sale del último segmento de la ruta (o de `&name=`). **Limitación (verificada en `InstanceCheck.cpp`):** si el usuario activó «instancia única» en Windows, un segundo lanzamiento solo reenvía *rutas de archivo* a la instancia abierta y **ignora la URL** (por defecto está desactivada, `single_instance=false`); en macOS la URL sí llega a una instancia abierta (`MacOpenURL`). La UI lo avisa y siempre queda la descarga. |
| **OrcaSlicer** | `orcaslicer://open?file=<URL>` (Windows/macOS; Linux solo con integración de escritorio) | `src/slic3r/GUI/GUI_App.cpp`, `Downloader.cpp` (`start_download`, `filename_from_url`), `libslic3r/Utils.hpp` (`is_orca_open`), `DeepLinkHandlerMac.mm`, `tests/libslic3r/test_utils.cpp` en `SoftFever/OrcaSlicer` (HEAD 896557b, 2026-11-02) | Descarga el archivo a **su carpeta de descargas** (Preferencias) y lo abre; si no hay carpeta configurada muestra un error propio. **No decodifica** el parámetro `file=` (por eso el enlace va sin codificar) y **toma el nombre de la URL incluyendo la query string** (`file.3mf?token=…` daría un nombre inválido): la URL debe terminar en `.3mf` y no tener query. En Windows lo registra el propio programa al iniciar (HKCU). Con Orca ya abierto, la URL se reenvía a la instancia existente (`InstanceCheck.cpp`, `StartDownloadOtherInstanceEvent`). Sin restricción de dominio en su descargador (`DownloaderFileGet.cpp`; límite de 1 GB). |
| **Flash Studio** | **Ninguno propio.** | `FlashForge/Orca-Flashforge` (HEAD c45cc82, 2026-01-19): `Utils.hpp`, `Downloader.cpp`, `GUI_App.cpp` (`associate_url(L"orcaslicer")`), `MacOSXBundleInfo.plist.in`, `Orca-Flashforge.desktop` | Es un fork de Orca: registra el **mismo** `orcaslicer://` (y en macOS también `bambustudioopen://`). `orcaflashforge://open/?file=` existe solo como cadena interna de su Downloader, **no** se registra en el sistema operativo. No hay documentación oficial de apertura desde el navegador en la wiki de Flashforge. Como `orcaslicer://` no se puede dirigir a Flash Studio (si Orca y Flash están instalados, gana el último que inició), **no se inventa ni se reutiliza** un esquema: Flash Studio descarga el `.3mf` y muestra cómo abrirlo. **Segunda investigación (2026-11-02):** se revisó el último código publicado (branch `1.7`, 2026-01-19, el mismo del tag 1.7.9), los registros de instalador/CMake/plist/`.desktop` y las notas de las releases 1.7.6–1.7.15 (la fuente pública solo llega a 1.7.9: **los binarios 1.7.11–1.7.15 no tienen código público para revisar**), la wiki oficial y la página de descarga de Flashforge: ninguna menciona un esquema propio (`flashstudio://`, `flashforge://`…) ni un botón «abrir en Flash Studio»; la única interfaz web↔app documentada (1.7.6, `get_app_version`) es del WebView interno. Conclusión sin cambios: solo descarga. |

**Qué no se pudo verificar**: ningún laminador está instalado en el entorno de desarrollo, así que **ninguna apertura real fue ejecutada**. Lo anterior es lectura de código fuente (puede diferir de la versión instalada del usuario). Tampoco se verificó cómo cada navegador/OS presenta el aviso de «abrir aplicación externa».

### Enlace temporal (`/api/print-files/open/{ticket}/{nombre}.3mf`)

Los laminadores no tienen la sesión del navegador y Orca exige que la URL termine en `.3mf` sin query, así que **no sirve una URL firmada de Supabase** (`…/file.3mf?token=…` rompe el nombre en Orca). Se usa una ruta propia:

- `ticket` = HMAC-SHA256 de `[versión, fileId, userId, vencimiento]` (10 min). Clave: `PRINT_FILES_LINK_SECRET` o, por defecto, derivada de `SUPABASE_SERVICE_ROLE_KEY` (no hace falta variable nueva).
- Es una capacidad de portador de **un archivo y 10 minutos**: quien tenga el enlace puede bajar ese archivo hasta que venza. La ruta se declara pública en el proxy (`/api/print-files/open`), valida el ticket, vuelve a leer la fila (dueño + `ready`) y **sirve el contenido** con `Cache-Control: no-store` (sin redirección: no depende de que el laminador siga redirecciones y la URL de almacenamiento no sale del servidor). El nombre del último segmento es solo informativo.
- Costo: el archivo pasa por el servidor de la app al abrirse por esta vía (streaming; no se bufferea). La descarga manual desde el navegador usa URL firmada directa (60 s).
- El enlace queda en el historial/argumentos del proceso del laminador durante su vigencia: por eso 10 minutos.

### Comportamiento del botón

`openPrintFileInSlicer` (`src/lib/print-files/client-open.ts`): si el laminador tiene esquema verificado para ese sistema (Windows/macOS) genera el enlace temporal y pide al navegador abrirlo, y muestra «Le pedimos a tu navegador que abra X. Si no se abrió, descargá el archivo…». **No existe una confirmación de apertura**: un navegador no informa si el programa está instalado ni si llegó a abrirse. En cualquier otro caso (Flash Studio, celular, Linux, sistema desconocido) descarga el archivo y explica cómo abrirlo. Toda tarjeta conserva además un botón «Descargar».

## 6. Archivos

- Lógica pura: `src/lib/print-files/` (`config`, `slicers`, `open-plan`, `validation`, `three-mf-container`, `link-token`, `types`); servidor: `server.ts`; cliente: `client-upload.ts`, `client-open.ts`.
- Server Actions: `src/app/productos/print-file-actions.ts` (patrón de `category-actions.ts`: sesión del servidor, `accessPlatform`, feature flag `mi_taller`, `user_id` de la sesión).
- Ruta temporal: `src/app/api/print-files/open/[ticket]/[filename]/route.ts`.
- UI: `src/components/products/print-files/` (sección, formulario, logo); montada en el detalle de `src/app/productos/page.tsx`. Sin la migration, la sección se oculta sola.
- Logos: `public/slicers/*.png`, iconos de la propia aplicación tomados de los repos oficiales (`BambuStudio_128px.png`, `OrcaSlicer_128px.png`, `Orca-Flashforge_128px.png`). Son marcas de sus titulares; se usan solo para identificar la aplicación.

## 7. Variables de entorno (opcionales)

- `PRINT_FILES_MAX_MB`: límite efectivo de subida (1–150; por defecto 100).
- `PRINT_FILES_LINK_SECRET`: clave de los tickets (por defecto derivada de `SUPABASE_SERVICE_ROLE_KEY`).

## 8. Limitaciones y validación manual pendiente

Ver TASKS.md («Archivos de impresión»). En breve: aplicar la migration; probar subida real (la ruta `Range` del almacenamiento y `uploadToSignedUrl` hasta 100 MB no se probaron contra Supabase real); abrir de verdad en cada laminador instalado (Windows y macOS) y registrar qué aviso muestra cada navegador; comprobar la carpeta de descargas de Orca; probar en un celular; QA con cuentas Free/Paid/Admin.

## 9. Tests

- `tests/product-print-files.test.mjs` — planes de apertura por laminador/sistema, validación, contenedor 3MF (ZIP truncado, bomba, zip-slip, cifrado, ZIP64, comentario con firma falsa), tickets, clasificador de error de tabla inexistente, honestidad de la UI, migration aditiva.
- `tests/product-print-files-actions.test.mjs` — flujos completos de las Server Actions sobre un mundo en memoria que **hace cumplir los GRANT por columna de la migration real** (subir/verificar/descartar/reemplazar/eliminar/editar, topes, subidas abandonadas, aislamiento **con y sin RLS**). Verificado con mutaciones (escribir `status` desde el usuario o quitar un filtro de dueño hace fallar tests).
- `tests/product-print-files-route.test.mjs` — la ruta pública de apertura (ticket vencido/manipulado/ajeno, pendiente, errores del almacenamiento, cabeceras, HEAD).
- `tests/product-print-files-db.test.mjs` — opt-in, Postgres embebido real: dependencias y tipos, idempotencia, RLS, aislamiento, trigger de pertenencia, privilegios por columna, restricciones.

**Cómo correr las suites con Postgres embebido sin interferencias:** cada una usa un puerto fijo y todas comparten un candado global `%TEMP%stampa-embedded-pg.lock`. Si una corrida anterior quedó colgada, sus `postgres.exe` huérfanos siguen ocupando el puerto y el candado puede quedar de una corrida muerta. Para repetir sin tocar nada ajeno: redirigir `TEMP`/`TMP` a una carpeta nueva (candado y datos propios) y usar los puertos por variable (`BETA_LEGACY_TEST_PG_PORT`, `COMMUNITY_TEST_PG_PORT`, `PRODUCT_PRINT_FILES_TEST_PG_PORT`).

## 10. Probar con archivos 3MF reales (después de aplicar la migration)

1. Aplicar `supabase/migrations/20261102130000_product_print_files.sql` (SQL Editor o `supabase db push`) y confirmar: bucket `product-print-files` **privado**, sin policies sobre `storage.objects` para ese bucket, tabla `product_print_files` con RLS activa.
2. Con una cuenta Paid: Mi Taller → Productos → abrir el detalle de un producto → «Archivos de impresión».
3. Preparar 3MF reales: uno de **Bambu Studio** (proyecto guardado con `Archivo → Guardar proyecto`), uno de **OrcaSlicer** y uno de **Flash Studio**; idealmente uno de ~50–100 MB (varias piezas/texturas).
4. «Agregar proyecto»: subir cada uno eligiendo su laminador (y una impresora). Comprobar que aparece solo tras terminar la verificación y que recargar la página lo conserva.
5. Casos de rechazo: renombrar un `.stl` o un `.zip` cualquiera a `.3mf` → debe rechazarlo con «no es un proyecto 3MF válido»; un archivo > 100 MB → rechazo por tamaño.
6. **Bambu Studio (Windows y macOS):** «Abrir en Bambu Studio» → el navegador pide permiso para abrir la aplicación → Bambu puede preguntar «sitio no confiable» → el proyecto debe cargarse. Repetir con Bambu ya abierto (en Windows con y sin «instancia única»). Anotar qué ocurre.
7. **OrcaSlicer (Windows y macOS):** ídem; comprobar que el archivo queda en la carpeta de descargas de Orca y se abre en la vista 3D. Repetir con Orca ya abierto, y con **Flash Studio también instalado** (puede abrirse el otro programa).
8. **Flash Studio:** el botón debe **descargar** el `.3mf` y mostrar el aviso de cómo abrirlo; abrirlo a mano en Flash Studio.
9. Celular: los tres botones descargan; la interfaz no ofrece abrir.
10. Reemplazar un archivo, editar sus datos, eliminar uno; verificar en el panel de Supabase que no quedan objetos huérfanos en `product-print-files`.
11. Otra cuenta Paid: no debe ver ni descargar nada de la primera. Cuenta Free: la sección no existe (Mi Taller exige acceso).
12. Confirmar que el precio, costo y tiempo del producto no cambiaron.
