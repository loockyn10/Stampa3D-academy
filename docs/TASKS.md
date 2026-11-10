# TASKS

Este archivo contiene únicamente trabajo pendiente o próximo. Eliminar tareas terminadas en lugar de conservar un historial infinito.

## Now — Landing 5.5: experiencia comercial en `/landing-preview` (implementada 2026-11-10, solo vista previa; la landing pública `/landing` no cambia)

Secciones nuevas tras la exploración de herramientas: «De la idea a la pieza», Gratis vs. Premium con precio, preguntas frecuentes, cierre y footer (`src/components/landing-hero/commercial/`). Contenido solo con beneficios verificados en el código (política de acceso, rutas libres, feature flags). Ajuste 2026-11-10: el objetivo de la landing es vender Premium. CTA principal «Quiero Premium» → `/registro?returnTo=%2Fsin-acceso` (conserva la intención con el `returnTo` existente: tras el alta y la confirmación de email la persona llega a `/sin-acceso`, donde está el botón real «Activar membresía»; no promete checkout directo y no toca auth ni pagos); la cuenta gratuita queda como alternativa secundaria («Probar la Calculadora» → `/calculadora`, «Crear cuenta gratuita» → `/registro`). Comparación en móvil (≤719px): dos bloques, Premium primero con precio real y beneficios, Free como alternativa; escritorio conserva la tabla. La promoción de lanzamiento no se anuncia hasta estar implementada. Landing 5.6 (2026-11-10): `/registro?returnTo=/sin-acceso` muestra «Estás a un paso de Universo Premium»; `/login` y `/verificar-email` lo acompañan; «Registrarme con otro email» ya no pierde el `returnTo`; `/sin-acceso` pasó a ser la pantalla de activación (membresía protagonista, precio vigente, beneficios verificados, herramientas gratuitas como apoyo). Sin cambios en Mercado Pago, precios ni permisos; la promoción de los primeros 50 sigue sin anunciarse. No se pudo probar con cuentas reales (ver reporte): la cuenta Free se simuló solo visualmente. Pendiente: `MembershipPanel` (/perfil) todavía lista beneficios antiguos de `membershipOffer` (menciona presupuestos).

**Precio:** se lee de `membership_settings` (`monthly_price`, `currency`) **solo en el servidor** con la clave de servicio, pidiendo únicamente esas dos columnas (`load-membership-price.ts`, `server-only`); la página se regenera cada 5 min. Un visitante anónimo **no** tiene permiso de lectura sobre esa tabla (a propósito; verificado: HTTP 401 con la clave anónima), por eso no se lee desde el navegador ni se tocó ningún permiso. Sin precio de respaldo: si la lectura falla se muestra «El valor mensual se muestra antes de confirmar». Al implementar, la base devolvía 250 (ARS, el monto de la prueba real); el 2026-11-10 la página publicada ya muestra **$ 19.900**, que coincide con el precio regular confirmado (Premium regular: $19.900 ARS/mes). Un cambio en `membership_settings` solo afecta a los checkouts nuevos.

**Bloqueantes reales para lanzar/cobrar públicamente (no resueltos acá):**
- [ ] **Textos legales:** los 5 documentos (`terminos`, `privacidad`, `condiciones-membresia`, `baja`, `arrepentimiento`) siguen en `null` (`src/content/legal`): el footer los marca «pendiente» y no enlaza. Necesitan aprobación del dueño / asesoría legal.
- [ ] **Baja y cancelación (D045):** sin definir. La landing nueva no promete nada sobre cancelación. Disposición 954/2025 (botón de baja y de arrepentimiento) a validar con un abogado.
- [ ] **Mercado Pago — validación documentada:** `DEPLOY_MEMBERSHIP_BILLING.md` §13 (incidente P0 2026-11-05, D049) describe el pago real de $250 y la corrección; los commits `a3dadb0` y `da3ba6e` están en `origin/main`. **No figura en los docs** el resultado de la prueba posterior a la corrección (cuenta nueva → pago → Premium automático, §12), ni el estado del deploy, del webhook de «Planes y suscripciones», de `CRON_SECRET` y de las consultas de diagnóstico del paso 1–3. Registrar ese resultado antes de dar por validado el cobro (los docs hoy dicen «sistema no validado en producción»).
- [ ] **Promoción de lanzamiento ($9.900 ARS/mes para los primeros 50 miembros pagos): NO implementada.** Faltan sus condiciones de permanencia (¿cuánto dura el precio?) y un mecanismo que el checkout respete: el sistema de códigos de descuento (`DISCOUNT_CODES_ENABLED` apagado; migrations `20261029120000` y `20261030120000` sin aplicar en remoto; solo códigos «para siempre») no cuenta miembros pagos ni limita a 50. No bajar `membership_settings.monthly_price` para simularla: la landing y `/sin-acceso` mostrarían $9.900 como precio regular y sin tope. No mostrar ningún descuento en la landing hasta que el checkout pueda cobrarlo.
- [ ] **Publicación:** el 2026-11-10 (14:30 ART) `origin/main` recibió las 23 commits de Landing 5.x y la URL de producción ya sirve `/landing-preview` (con `noindex`, fuera del sitemap). Un preview de Vercel no es aislado si hereda las variables de Production (escribiría en la base real y el `back_url` de Mercado Pago apunta al dominio de producción): para probar con aislamiento hacen falta variables propias de Preview (ver `DEPLOY_MEMBERSHIP_BILLING.md` §5).
- [ ] **Stampy y clases de Academia:** la recomendación de clases depende de la corrección `f73a33f` (commit local, sin push/deploy). Hasta desplegarla, producción no recomienda clases como muestra el video. Falta además la tabla `stampy_user_memory` en la base conectada: no prometer que Stampy recuerda preferencias.
- [ ] **Testimonios y cifras:** no hay testimonios autorizados ni métricas verificadas: no se incluyeron.
- [ ] **No promocionar:** Mi Negocio (incluye Presupuestos), Tienda online, Stampa Maker y Sorteos (flags apagados), acceso Beta por código y códigos de descuento (`DISCOUNT_CODES_ENABLED` apagado).

## Now — Sprint UX/UI 4.1 (implementado 2026-11-07, ver ARCHITECTURE §32 y D051)

- [ ] **QA visual autenticada** (sin sesión en el entorno del sprint; se verificó con un arnés temporal de componentes reales y los mismos estilos): con cuenta Premium, a 320/375/390/768/1280/1440 px y en claro/oscuro: abrir un modal después de hacer scroll en Stock, Productos, Presupuestos, Calculadora, Impresoras y Admin → Usuarios (centrado, scroll interno, pie visible sobre la barra inferior); Mi Taller → Productos con datos reales (nombres largos, sin descripción, sin imagen, armable, «Requiere recalcular», con la barra de categorías y la búsqueda combinada); las cuatro pantallas de Mi Taller una al lado de otra; sidebar contraído/expandido en cada ruta, recarga con la preferencia guardada, tooltips con teclado, y la navegación móvil intacta.
- [ ] Inventario sigue siendo una tabla con `min-w-[720px]` (scroll horizontal en móvil); pasarla a tarjetas en móvil requiere reestructurarla.
- [ ] Los modales de Stock/Productos/etc. siguen con su marcado propio (ahora en portal); unificarlos en `ui/dialog.tsx` (foco atrapado, Escape, scroll bloqueado) queda pendiente.

## Now — Sprint UX/UI y Mobile (implementado 2026-11-06, ver ARCHITECTURE §31 y D050)

- [ ] **QA visual autenticada** (no se pudo iniciar sesión en el entorno del sprint; se revisó con un arnés temporal de componentes y la Calculadora pública): con cuenta Premium a 320, 375, 390, 768 px y escritorio, claro y oscuro: header móvil (título, «volver», buscador), barra inferior y menú «+» (7 herramientas, sin superposición), Inicio, Academia → Cursos → un curso (botones de clase, salto al video, temario sin scroll anidado), Mi Taller/Mi Negocio/Stock/Productos/Presupuestos con un modal abierto (el pie del modal debe verse sobre la barra inferior), Stampa Maker (controles de 40 px).
- [ ] Probar la PWA instalada en iPhone (notch/barra de inicio) y Android: `viewport-fit=cover` + insets; si el header queda bajo la barra de estado, revisar `apple-mobile-web-app-status-bar-style`.
- [ ] Revisar a ojo el cambio de tinta sobre botones naranjas (`text-white` → `text-neutral-950`, ~70 botones, incl. login/registro): si se prefiere blanco, es un cambio de una línea en `Button`/clases; hoy prima el contraste AA.
- [ ] Pendiente (requiere reestructura, no hecho): tabla ancha de Stock como tarjetas en móvil (hoy scroll horizontal con `min-w-[720px]`); controles de Stampa Maker en hoja inferior; unificar los ~12 modales propios en `ui/dialog.tsx`; mover el fetch del curso al servidor.

## Now — Archivos de impresión 3MF (implementado 2026-11-02, ver ARCHITECTURE §27, D041 y docs/PRINT_FILES.md)

- [ ] Seguir el procedimiento de `docs/PRINT_FILES.md` §10 (probar con 3MF reales).
- [ ] Definir una **cuota de almacenamiento** por usuario/plan (hoy solo hay topes de cantidad: 30 por producto, 300 por usuario).
- [ ] Aplicar `20261102130000_product_print_files.sql` en Supabase (no aplicada; requiere autorización). Hasta entonces la sección no aparece. Confirmar después que el bucket `product-print-files` quedó privado y sin policies.
- [ ] Validar contra Supabase real: subida con `uploadToSignedUrl` de un 3MF de ~50–100 MB (y el límite global de archivo del proyecto), y que el almacenamiento responda `206`/`Content-Range` a `Range: bytes=-N` (si respondiera 200, el servidor lee el archivo completo acotado por el límite: funciona pero es más pesado).
- [ ] **Abrir de verdad** en cada laminador instalado y registrar el resultado (Windows y macOS): Bambu Studio (aviso de «sitio no confiable»), OrcaSlicer (carpeta de descargas, nombre del archivo), y qué aviso muestra cada navegador. Comprobar el caso Orca + Flash Studio instalados a la vez.
- [ ] Flash Studio: pedir/consultar a Flashforge si existe un esquema propio o documentado; hasta entonces solo descarga.
- [ ] QA manual con cuentas Free/Paid/Admin (escritorio y celular, claro/oscuro): alta, edición, reemplazo, eliminación con confirmación, varios proyectos del mismo laminador, vínculo a pieza, aislamiento entre usuarios, recarga.
- [ ] Opcional: barrido de objetos huérfanos (los `pending` > 1 h se limpian solo al preparar otra subida del mismo producto) y barra de progreso real de subida.

## Now — Redes y canales administrables (implementado 2026-11-02, ver ARCHITECTURE §26 y D040)

- [ ] Aplicar `20261102120000_community_links.sql` en Supabase (no aplicada). Hasta entonces el panel muestra «falta la migración» y las pantallas usan el respaldo en código. La migration carga 4 enlaces públicos (los que estaban fijos); **revisar en `/admin/redes-canales` que `extruye` sean las URLs reales** (WhatsApp y Telegram parecen placeholders) y cargar TikTok / tienda, que antes eran «Próximamente».
- [ ] QA manual con cuenta admin (escritorio y 375 px, claro/oscuro): alta, edición, activar/desactivar, subir/bajar, eliminar, vista previa por audiencia y recarga; luego con cuenta Paid (`/canales`) y sin sesión (pie de `/landing`).
- [ ] Decidir si los canales bloqueados (Premium) deben mostrarse a usuarios Free en alguna pantalla accesible para ellos (hoy `/redes` y `/canales` exigen membresía por el proxy, así que solo se ven en la vista previa del Admin).

## Now — Lámparas E27 UX V2: simplificación, controles por familia y estabilidad (implementado 2026-11-03, ver docs/STAMPA_MAKER.md §38.22 y D043)

- [ ] **Verificar la ruta real** `/stampa-maker/lamparas` con sesión admin (escritorio y 375 px, claro/oscuro). La página se recorrió en el navegador integrado a través de una ruta pública temporal (ya borrada) **sin** el guard de admin ni el layout principal; falta confirmarla con ambos.
- [ ] Probar físicamente la calada con difusor cilíndrico Ø80 y abertura Ø81 (holgura 1 mm): que el difusor se coloque y se retire sin forzar con la tolerancia real de la impresora.
- [ ] Imprimir una **doble pared sin difusor** con portalámparas y bombilla LED reales y medir la temperatura (`DW_NOT_THERMAL`): sin difusor la pared interior queda más cerca de la bombilla que con el cilindro.
- [ ] Decidir si la doble pared necesita una galería de presets visuales (hoy elige la forma exterior y la interior con selectores de texto) y si el difusor opcional de la doble pared debe ofrecerse en la interfaz principal.
- [ ] Decidir si se amplía el difusor de la doble pared a formas cerradas (plano, gota): hoy solo cilíndrico, por la regla del sprint.

## Now — Lámparas E27 V7: sistemas de fijación y encastre estándar (implementado 2026-11-03, ver docs/STAMPA_MAKER.md §38.21 y D042)

- [ ] Imprimir las piezas de prueba del portalámparas de cada sistema (a presión, rosca A, rosca B) y probarlas con el portalámparas real; ajustar solo con la escala/flujo de la impresora: el perfil es el medido.
- [ ] Imprimir una base con **patas** (rosca B) y comprobar la resistencia con el portalámparas y la bombilla colocados; confirmar el grosor de pata (8 mm, supuesto) y la orientación.
- [ ] Imprimir un difusor Ø80 con el encastre de Ø65,135 y la transición a 45° y probar que asienta en la ranura de la torre estándar.
- [ ] Laminar en Bambu Studio una base roscada (la rosca se genera por capas de 0,1 mm: ~330 mil triángulos) y revisar tiempo y soportes.

## Now — Lámparas E27 V2 (implementado 2026-10-31, Beta / solo admin, ver docs/STAMPA_MAKER.md §38.8–38.15)

- [ ] **Imprimir las piezas de prueba** («Piezas de prueba (ZIP)»: rosca macho + hembra y tramo de la torre) con el filamento y la impresora reales; ajustar `thread.clearanceMm` e `insert.clearanceMm` (§38.15). Es lo primero: valida el encastre sin imprimir la lámpara entera.
- [ ] **Medir el portalámparas real** (§38.8): agujero libre (Ø42 nominal vs Ø40,9 en `bottom.stl`), Ø máximo y espesor de los anillos, por qué lado se montan (el rebaje de la referencia está arriba; `SOLID.stl` los monta bajo la placa), altura del apoyo, cuerpo sobre la base, y si Ø65 es exterior (el STL indica que sí) y su espesor real. Marcar «mis medidas» solo con esos datos.
- [ ] Probar el **apriete de los anillos** en la torre: la pared entre el rebaje y la ranura mide 1,45 mm (1,69 mm en la referencia) y es la zona más delgada.
- [ ] V5 — **Verificar en la ruta real** (`/stampa-maker/lamparas`, sesión admin; escritorio y 375 px, claro/oscuro): selector Sólida | Calada | Doble pared, controles de cada tipo, anillos Ø80 → difusor Ø79, descargas. Los tests de integración corren el componente real en Node, pero no abren la ruta.
- [ ] V5 — **Bambu Studio:** doble pared convencional (cámara cerrada y abierta; techo ~39°, cielorraso de 2,4 mm, cuello macizo), calada con anillos más angostos que la rosca (transición de 45° hacia adentro) y el difusor Ø79.
- [ ] V5 — Decidir si se habilita el modo jarrón de la doble pared (hoy fuera del selector; ver docs/STAMPA_MAKER_DOUBLE_WALL.md): requiere probar en el laminador la espiral continua por ambas paredes y una unión superior compatible.
- [ ] V4.1 — **Difusor de la calada:** imprimir el difusor según los anillos (holgura diametral 1 mm) y comprobar el encastre en la ranura, que entra y sale por el anillo superior y la holgura real en cada anillo; ajustar `openwork.diffuserClearanceMm`. Decidir si se permite un cono de transición hacia adentro para que el anillo inferior pueda ser más angosto que la rosca (hoy lo limita la base). Térmica con LED pendiente.
- [ ] V4 — **Doble pared (experimento, V4.1 con piso y techo):** laminar en Bambu Studio `tests/fixtures/maker-double-wall/double-wall-vase-test.stl` (modo jarrón) y `double-wall-conventional-test.stl` (B1: 1 perímetro; B3: 3 perímetros) con el mismo perfil y registrar tiempo, filamento y los cinco chequeos del modo jarrón (`docs/STAMPA_MAKER_DOUBLE_WALL.md` §6–8). Sin esos datos no hay recomendación definitiva; si A falla, priorizar el sistema convencional.
- [ ] V3 — **Pantallas caladas:** laminar en Bambu Studio y probar una tira/segmento y luego la pantalla completa de «Diamante clásico» y «Espiral suave» (sin soportes esperados), y revisar «Diamante con torsión» y «Espiral intensa» (aviso de voladizo 51°/58°), «Diamante fino» y cualquier terminación abierta. Ninguna pantalla calada está impresa ni validada.
- [ ] V3 — **Térmica de la lámpara calada** con LED y portalámparas real (`OPENWORK_NOT_THERMAL`): las aberturas no demuestran seguridad térmica.
- [ ] V3 — QA manual con cuenta admin del panel Calada (selector de tipo, miniaturas, silueta, patrón, plegables; escritorio y 375 px) y de la fluidez en un celular real (el motor corre en el hilo principal; ≈ 0,4–0,7 s por cambio en desktop).
- [ ] V2.2 — **Reborde interno:** imprimir la pieza de prueba «rosca macho» (lleva el reborde) SIN brim y confirmar la adhesión; apoyarla alrededor de la pieza del portalámparas (holgura con la torre).
- [ ] V2.2 — **Insertos:** laminar en Bambu Studio y probar físicamente el plano (invertido), la gota (parada; punta y pendiente del cierre) y el ondulado (torsión, pendiente); encastre en la ranura y salida por arriba.
- [ ] V2.2 — **Térmica de insertos cerrados** (plano, gota, ondulado con tapa) con LED y el portalámparas real: ninguno está validado (`INSERT_CLOSED_THERMAL_PENDING`).
- [ ] V2.2 — QA manual con cuenta admin del panel nuevo (tarjetas de estilo, adhesión, «Comparar estilos», «Ver reborde»; escritorio y 375 px): la ruta exige sesión admin y no se pudo abrir en el entorno de desarrollo.
- [ ] Validar la **separación radial de 1,7 mm** entre la bombilla (Ø60) y el cilindro Ø65: no hay datos de ventilación ni temperatura (aviso `INSERT_GAP_UNVALIDATED`); prueba térmica con **bombilla LED**. Desde V2.1 la base y el cilindro **no tienen ventanas**: la entrada de aire es solo el canal de cable y la holgura del portalámparas (§38.9); medir la temperatura del cilindro PLA y del portalámparas con la geometría cerrada.
- [ ] **Laminar en Bambu Studio** cada pieza (sin soportes en la rosca y la transición de 45°, collar, cilindro) y confirmar el modo vaso de la pantalla lisa; probar la retención por fricción del collar con una pared real.
- [ ] Montaje real en seco (cable, precinto o prensacable, cilindro que entra y sale por arriba), estabilidad y revisión por persona calificada antes de abrir la herramienta (§38.13). Hasta entonces sigue `adminOnly` + Beta en `src/lib/maker/availability.ts`.
- [ ] QA manual con cuenta admin (escritorio y 375 px, claro/oscuro/automático): la ruta se probó solo con un arnés temporal.
- [ ] Decidir si las lámparas se guardan como proyectos (hoy solo "código del diseño"): requeriría una migration que amplíe el CHECK de `maker_projects.source_type`; no incluida.

## Now — Categorías de productos en Mi Taller (implementado 2026-10-30, ver ARCHITECTURE §25 y D039)

- [ ] Aplicar `20261101120000_product_categories.sql` en Supabase (no aplicada). Hasta entonces la pantalla no muestra categorías.
- [ ] QA manual con cuenta Paid (desktop y 375 px, claro/oscuro): crear «Lámparas», asignar productos, filtrar, renombrar, eliminar y comprobar que los productos quedan sin categoría. Las pantallas autenticadas no se probaron en el entorno de desarrollo (solo los componentes aislados y la base real vía Postgres embebido).

## Now — Carteles 0.7.2: material y tres niveles de resistencia (implementado 2026-10-30, ver docs/STAMPA_MAKER.md §37)

- [ ] Validar en Bambu Studio los seis perfiles (PETG/PLA × Ligero/Normal/Reforzado = 0,9 / 1,35 / 1,8 / 2,25 mm): perímetros reales, PETG Ligero (0,9 mm) sin huecos, tapa encastrable con la holgura de 0,2 mm en material real. Lista en §37.8. Los espesores son perfiles de diseño, no una garantía de resistencia.
- [ ] QA visual manual de los selectores Material + Resistencia en la app con cuenta Paid (desktop y 375 px, claro/oscuro, teclado): la verificación automática es de render estático y de geometría.
- [ ] Decidir si se corrige el triángulo de área cero que aparece con "OB" a 0,9 mm (§37.7); hoy es inocuo (malla cerrada).
- Sin migración SQL: `material` viaja en el JSON de la receta con lectura tolerante (ausente → PETG).

## Now — Carteles 0.7.1: bisel superior y resistencia (implementado 2026-10-30, ver docs/STAMPA_MAKER.md §36; el selector Normal / Reforzado fue reemplazado por el 0.7.2)

- [ ] Validar en Bambu Studio (no hay slicer en el entorno de desarrollo): exportar Normal (1,2 mm) y Reforzado (2,4 mm) con bisel (estilo Moderno), revisar pared vertical + espesor dentro del bisel en vista de capas y los perímetros reales (Reforzado necesita ≥ 1,68 mm para 4 perímetros de 0,42 mm). Lista completa en §36.10.
- [ ] Bisel posterior (`rearBevel*`) y costillas todavía no acompañan a la cavidad (§36.9); decidir si se extiende el mismo mecanismo.
- [x] Valor inicial: reemplazado por PETG + Normal = 1,35 mm en 0.7.2.
- [ ] QA visual manual del selector de resistencia en la app con cuenta Paid (desktop y 375 px, claro/oscuro): la verificación automática es de render estático.

## Now — Tutoriales gráficos (implementado 2026-10-29, ver ARCHITECTURE §24, D036 y `docs/TUTORIALS.md`)

- [ ] Aplicar `supabase/migrations/20261031090000_tool_tutorial_versions.sql` en Supabase remoto (requiere autorización). Sin aplicarla todo funciona (el versionado queda respaldado por `localStorage` por usuario).
- [ ] QA manual autenticado (cuenta con acceso a plataforma): (1) cuenta nueva: cada sección abre su guía una sola vez y no vuelve al recargar; (2) cuenta que ya había cerrado el tutorial anterior: NO reaparece en las secciones que ya tenía; (3) botón "¿Cómo funciona?" reabre; (4) claro, oscuro y automático; (5) 320–430 px con el menú móvil, el teclado de Stampy abierto y el botón flotante sin tapar controles; (6) Escape, Tab y lector de pantalla.
- [ ] Revisar con producto el texto de cada tutorial (explican solo lo verificado en código) y decidir si `workshop`, `business`, `maker` y `model_search` (nuevos) deben abrirse solos o quedar solo manuales (D036).
- [ ] Videos: cuando estén grabados, agregar `video: { url }` a la definición (o `tool_tutorials.video_url`). No hace falta cambiar versión.

## Now — Temas claro/oscuro (implementado 2026-10-29, ver ARCHITECTURE §23 y D035)

- [ ] QA visual manual en modo claro con cuentas reales (Free, Paid/Beta, Admin) en desktop y 320–430 px: Inicio, Academia, Stampy, Mi Taller, Mi Negocio (con datos: tablas, modales, tickets), Calculadora, Stampa Maker (paneles), Sorteos, Presupuestos, Administración (formularios, tablas) y los estados cargando/error/vacío/deshabilitado. La verificación automática solo pudo recorrer pantallas sin sesión (datos vacíos).
- [ ] Decidir si landing y tienda pública deben tener versión clara (hoy fijas en oscuro). El default ya es Automático (`DEFAULT_THEME_PREFERENCE = "system"`): hacer el QA en claro antes de desplegar.

## Now — Feature flags / lanzamiento progresivo (implementado 2026-10-24, rama `feature/universo-stampa-feature-flags`, ver ARCHITECTURE §21 y D030)

- [ ] Aplicar `supabase/migrations/20261024120000_platform_feature_flags.sql` en Supabase remoto (requiere autorización). Antes: confirmar que `public.is_admin(uuid)` existe. Después: abrir `/admin/funcionalidades` y verificar que las 12 herramientas figuran "Sin configurar · habilitada" (comportamiento idéntico al actual).
- [ ] QA manual con 3 cuentas (Free, Paid/Beta, Admin) en desktop y 320–430 px: deshabilitar UNA herramienta (p. ej. Redes), comprobar que el usuario común no la ve en sidebar/barra inferior/menú radial/Inicio/buscador, que la URL directa y sus subrutas llevan a `/no-disponible`, que Stampy no la recomienda, y que el admin la sigue viendo; volver a habilitarla y confirmar que los datos siguen intactos.
- [ ] Estrategia de activación sugerida: deshabilitar de a una herramienta (empezando por las menos críticas), probar con la cuenta común, seguir con la siguiente. Evitar deshabilitar Calculadora (puerta de entrada gratuita) y Tienda online pública (corta compras de clientes finales) sin decisión comercial.
- [ ] Decisión pendiente (no implementada): llevar la flag a RPC/RLS para las escrituras directas del navegador (inventario y requisitos exactos en ARCHITECTURE §21.1; prioridad Mi Taller: RPC de stock/producción, varias sin versionar). Requiere migration nueva, revisión de `has_platform_access` y un Supabase de test.
- [ ] Opcional: historial de cambios (quién/cuándo deshabilitó qué) más allá de `updated_by/updated_at`; botón para volver una funcionalidad a "sin configurar" (hoy solo por SQL).

## Now — UX V2 (2026-10-22, rama `feature/universo-stampa-ux-v2`, ver ARCHITECTURE §20 / D028)

- [ ] QA manual con sesión (no hay cuentas de prueba ni Supabase de test; usar una cuenta Paid y otra Beta, en desktop y 320–430 px, dentro del shell real con header y navegación inferior):
  - Inicio: datos reales de curso (último con actividad), resumen de Mi Taller/Mi Negocio, usuario nuevo sin actividad, enlaces de accesos rápidos.
  - Mi Taller: KPIs contra Productos/Inventario, `?estado=sin-stock` y `?estado=recalcular`, "Registrar movimiento" abre Registrar producción, producto por partes (armables), estado vacío.
  - Mi Negocio: facturación/ventas vs Métricas, Semana/Mes, venta anulada tachada, pedidos `awaiting_payment`/`payment_review` y `?estado=` en Pedidos, nueve herramientas.
  - Stampy: respuesta larga con Markdown, scroll al llegar la respuesta, historial (conversación persistida), acción con confirmación (`ActionIntentCard`), error del modelo, mobile con teclado abierto.
  - Calculadora (Paid): modal "Configurar valores" (guardar costos/ML, impresora y tipos de producto sin perder gramos/tiempo), validación de comisión ≥ 100 %, precio ML en Básico y Avanzado.
  - Sorteos: chances de un usuario Beta (base 1), copiar enlace, modal, estados con sorteos reales.
  - Librería STL: portadas reales de grupos en 4:3.
- [ ] Actividad reciente de Mi Taller: versionar/verificar el schema de `product_stock_movements` y `filament_stock_movements` (la UI lee `quantity_delta`/`grams_delta`, el contexto de Stampy `quantity`/`amount`/`type`) antes de construir el panel.
- [ ] **Decisión de producto + contrato de DB (D029):** acreditación de chances por invitaciones. Falta definir: qué evento convierte una invitación (registro, onboarding, primer pago, pago aprobado), cuántas chances otorga, si vencen, límites/antifraude (auto-referido, cuentas múltiples) y quién la ejecuta (webhook de pago con `service_role`, idempotente por `referred_user_id`). Además versionar `referrals` y `user_raffle_bonus_entries` (columnas, RLS, unique) en una migration. Hasta entonces la UI no promete chances por invitar.
- [ ] Verificar en Supabase remoto (solo lectura) si existe algún trigger/función no versionada que ya acredite `user_raffle_bonus_entries` o actualice `referrals.status`.
- [ ] Revisar el contenido remoto de `stampy_page_contexts` para `/sorteos`: podría prometer beneficios por referidos (no está en el repo).
- [ ] Merge de la rama a `main` y deploy (no realizados).

## Now — Sprint 3 V1.0: Academia (2026-11-05, ver docs/ACADEMY_V1.md y D047)

- [x] Reproducción por servidor, Bunny firmado opcional, retomar por progreso, navegación, errores visibles, conteos coherentes, validación de video en admin. Tests: `tests/academy-sprint3.test.mjs`.
- [ ] **Bloqueante (P0-5):** correr `supabase/diagnostics/20261105_academy_content_inventory.sql` y decidir qué cursos se ofrecen; pasar a «Próximamente» lo que no esté listo.
- [ ] Activar la protección de Bunny (`BUNNY_STREAM_TOKEN_KEY` + token en Bunny) siguiendo `ACADEMY_V1.md` §3.
- [ ] QA con cuenta Premium (`ACADEMY_V1.md` §4).
- [x] Stampy ya no filtra por `lessons.is_published` (columna que no existe: la consulta fallaba con «column lessons.is_published does not exist» y nunca recomendaba clases). Ahora usa la regla de `loadLessonGate`: clase y módulo activos, curso `published` y `is_ai_recommendable` (2026-11-10, `tests/stampy-lesson-recommendations-query.test.mjs`).
- [ ] Post V1.0: mover la carga del curso al servidor.

## Now — Sprint 2 V1.0: registro, onboarding y primera experiencia (2026-11-05, ver D046 y ARCHITECTURE §29)

- [x] Landing en `/` para visitantes, SEO, `/landing-old`, registro con y sin confirmación de email, `/verificar-email`, errores en español, área Free, `returnTo`, onboarding Free, marca Universo Stampa, estructura legal. Tests: `tests/sprint2-onboarding.test.mjs`.
- [ ] Revisar en Supabase → Authentication: si «Confirm email» está activo, Site URL y Redirect URLs (deben incluir `<dominio>/auth/callback`), y las plantillas de email (remitente y textos en español con la marca Universo Stampa).
- [ ] QA manual con una cuenta nueva de prueba (no un cliente): registro → email → confirmación → onboarding (guardar y «Completar más tarde») → área Free → Calculadora → Perfil → intento de sección Premium; login con `returnTo`; recuperación de contraseña; desktop y 375 px.
- [ ] Textos legales y decisión D045 (baja/arrepentimiento): ver `docs/LEGAL_PENDING.md`.
- [ ] Merge de `feature/sprint2-onboarding` (incluye los Sprints 0, 1 y 1.1) y deploy: no realizados.

## Now — Sprint 1 V1.0: circuito de membresías con Mercado Pago (2026-11-05, ver docs/DEPLOY_MEMBERSHIP_BILLING.md y D044)

- [x] Webhook endurecido (firma obligatoria, 5xx transitorios, idempotente), activación solo con cobro aprobado, renovaciones/vencimientos sin accesos perpetuos, cancelación desde Configuración → Membresía y Perfil. Sin migración. Tests: `tests/membership-cycle.test.mjs`.
- [x] Sprint 1.1: conciliación automática diaria (Vercel Cron, `CRON_SECRET`) para webhooks perdidos y override de frecuencia diaria solo para pruebas. Tests: `tests/membership-reconcile.test.mjs`.
- [ ] **Decisión comercial (D045):** experiencia de baja y arrepentimiento, con asesoría legal (Ley 24.240 art. 10 ter, Disposición 954/2025). Opciones en `DEPLOY_MEMBERSHIP_BILLING.md` §7. La cancelación actual se conserva sin aprobar.
- [x] ~~Entorno aislado~~: no se crea por ahora (decisión del dueño, 2026-11-05). Desarrollo local de pagos **cerrado**; la validación real con Mercado Pago la hace el dueño.
- [ ] **Bloqueante para cobrar:** configurar en Production `MERCADO_PAGO_WEBHOOK_SECRET`, `CRON_SECRET` y el webhook de «Planes y suscripciones» (§4), y completar la prueba de §6 (incluye renovación y webhook perdido).
- [ ] Correr `supabase/diagnostics/20261105_membership_billing_state.sql` (A/B en `true`; revisar F).
- [ ] Merge de `feature/sprint1-subscriptions` y deploy (no realizados): checklist en `DEPLOY_MEMBERSHIP_BILLING.md` §11.
- [ ] Decidir el tratamiento de reembolsos/contracargos (hoy no revocan acceso) y si se envían emails propios de pago/rechazo/vencimiento.

## Now — Sprint 0 V1.0: seguridad de profiles (P0-1, 2026-11-04, ver docs/DEPLOY_PROFILES_GUARD.md)

- [x] Diagnóstico remoto de solo lectura (`supabase/diagnostics/20261104_profiles_security_audit.sql`): **vulnerabilidad confirmada**. Cualquier usuario autenticado podía cambiar su `role` / `membership_*` vía REST.
- [x] Migration de la guarda + script de verificación + tests (`tests/profiles-guard.test.mjs`, `tests/profiles-guard-db.test.mjs`).
- [x] Migration `20261104120000_profiles_privileged_columns_guard.sql` **aplicada en producción** (SQL Editor) y verificación SQL `20261104_profiles_guard_verify.sql` **superada** (todo OK, ningún MAL).
- [ ] Cerrar P0-1 con el checklist de `docs/DEPLOY_PROFILES_GUARD.md` §9:
  - prueba real contra la API REST;
  - pruebas manuales en la app;
  - revisión de los 3 admins y las 2 membresías activas sin suscripción;
  - monitoreo de 24 h.
- [ ] Registrar `20261104120000` en el historial de Supabase CLI (`DEPLOY_PROFILES_GUARD.md` §8). Mientras el historial no esté reconciliado, no usar `supabase db push` contra producción.
- [ ] Revisar el cuerpo de las RPCs `SECURITY DEFINER` ejecutables por `anon` (`supabase/diagnostics/20261104_definer_rpc_bodies.sql`).
- [ ] Higiene: revocar `TRUNCATE` / `REFERENCES` / `TRIGGER` de `anon` / `authenticated` en tablas de `public`.

## Now — QA integral (2026-10-14, ver docs/QA_REPORT.md)

- [ ] Confirmar la URL real de la beta: `stampa3-d-academy-beta.vercel.app` responde `402 DEPLOYMENT_DISABLED` (QA-001).
- [ ] Correr `supabase/diagnostics/20261014_qa_rls_audit.sql` (solo lectura) y decidir sobre RLS de `profiles` (RIESGO-01), policies premium (RIESGO-02), migrations aplicadas (RIESGO-04) y consistencia de datos. **RIESGO-01 y la RLS de contenido premium ya quedaron resueltos con el diagnóstico del 2026-11-04 (ver Sprint 0)**. Ese archivo tiene muchas sentencias y el SQL Editor solo muestra el último resultado: para migrations y consistencia, correr cada sección por separado.
- [ ] Crear un Supabase de test (o branch) con el schema completo + 4 cuentas (Free, Beta, Paid, Admin) + seed mínimo y definir las variables `E2E_*` (ver `tests/e2e/README.md`) para activar los ~1.300 escenarios que hoy quedan skipped.
- [ ] Triage de bugs P2: ~~QA-009 (firma del webhook de membresías)~~ resuelto en Sprint 1, QA-010 (menú radial), QA-014 (editores: `if (!error)`, doble submit, validación), QA-016 (confirmación en Admin → Usuarios), QA-019 (saldo de cliente truncado), QA-022 (Ventas limitadas a 50).
- [ ] Versionar el schema base (RIESGO-03) para poder reproducir entornos y auditar RLS.
- [ ] Automatizar en E2E (necesitan seed): Registrar producción / Ajustar inventario, Showroom↔Depósito, scanner, previews 360°/3MF, checkout de membresía.

## Now — Librería STL: Grupos + viewer 3D (implementado 2026-10-09, ver ARCHITECTURE §18b y D025)

- [ ] Prueba manual con sesión real (checklist del reporte): crear grupo con portada, asignar STL, abrir viewer en desktop y mobile (320–430 px), rotar/zoom/pinch, descargar, usuario sin acceso, STL grande/corrupto.
- [ ] Verificar en Supabase que las policies de `stl_categories`/`stl_models`/`stl_variants` ocultan filas no publicadas a usuarios no-admin (el schema `stl_*` no está versionado en `supabase/migrations`; hoy el filtro `is_active` está en las queries y en `/api/stl/preview`).
- [ ] Verificar que el bucket `stl-files` sea privado y permita CORS de lectura por URL firmada desde el dominio de la app (el viewer hace `fetch` directo a la URL firmada).
- [ ] **Previews 360° (2026-10-11, ARCHITECTURE §18c / D026):** aplicar `supabase/migrations/20261011120000_stl_model_preview_360.sql` (columna `stl_models.preview_url` + bucket público `stl-previews` + policies Admin); luego, en Admin → Modelos → editar, "Generar vista 360°" por cada modelo existente (no hay regeneración masiva). Probar en Chrome/Edge: generación STL y 3MF, tamaño del WebM, hover en desktop, autoplay en mobile (320–430 px), reduced-motion, preview borrado de Storage.
- [ ] **3MF multiplate + colores (2026-10-13, ARCHITECTURE §18d / D027):** subir/probar con Chrome un 3MF **real completo** de Bambu Studio y otro de OrcaSlicer (varias camas, uno multicolor y uno con pintura multicolor) y correr `node scripts/inspect-3mf.mjs archivo.3mf`; confirmar en el Admin que la miniatura/WebM muestran solo la cama 1 y los colores esperados, y regenerar la miniatura/vista 360° de los modelos 3MF existentes (no hay regeneración masiva). Sin migration.
- [ ] Opcional: versionar en una migration el schema/RLS de `stl_*` y agregar un índice único de `slug` en `stl_categories` si no existe (hoy el admin valida unicidad en cliente).

## Now — Acceso Beta por código (implementado 2026-10-05, ver ARCHITECTURE.md §19 y D023)

- [x] ~~Diagnóstico remoto~~ ejecutado: compatible. Pendiente: aplicar la migration Beta (incluye el hardening de privilegios de `user_access_grants`) y volver a correr `supabase/diagnostics/20261005_beta_access_state.sql`: deben aparecer `0_VERDICT ... HARDENED` y `anon TRUNCATE = false` / `authenticated TRUNCATE = false`.
- [ ] Verificar con la matriz `C_privileges` del diagnóstico (usa `has_table_privilege`, más fiable que `information_schema`) que `service_role` conserva SELECT/INSERT/UPDATE/DELETE sobre `user_access_grants`: el primer diagnóstico solo listó REFERENCES/TRIGGER/TRUNCATE para ese rol (el callback legacy escribe con service role y traga errores).
- [ ] Aplicar `supabase/migrations/20261005120000_beta_access_codes.sql` en Supabase remoto y crear el primer código con `create_beta_access_code(...)` (el código real NO va al repo).
- [ ] Prueba manual con cuenta real: registro con código (con y sin confirmación de email), cuenta Free existente canjeando desde Perfil, código vencido/agotado/inválido, revocación.
- [ ] Verificar en Supabase Auth si "Confirm email" está activo (define si el canje ocurre en el signup o vía `PendingBetaCodeRedeemer`).
- [ ] **Códigos Beta/descuento (2026-10-28, D032):** correr `supabase/diagnostics/20261028_codes_state.sql` (read-only) y revisar `0_VERDICT`; si la migration Beta no figura aplicada, aplicarla primero; luego aplicar `supabase/migrations/20261028120000_beta_redeem_legacy_invite_codes.sql` y volver a correr el diagnóstico (`Legacy bridge: applied`). Probar con cuentas reales: código creado en `/admin/codigos` canjeado desde el campo de invitación, Perfil y Sin acceso, vencido, agotado y repetido.
- [ ] **Descuentos en checkout (D033/D034, ARCHITECTURE §22):** aplicar JUNTAS `20261029120000_discount_code_checkout.sql` y `20261030120000_discount_checkout_consistency.sql`, correr `supabase/diagnostics/20261029_discount_codes_state.sql` (deben figurar las dos como `applied`), probar con usuarios de PRUEBA de Mercado Pago (código válido/vencido/agotado, quitar el código tras generar el link, pago tardío con `max_uses=1`, doble click, autorización → uso consumido, cancelación → uso liberado, renovación al monto con descuento) y recién entonces `DISCOUNT_CODES_ENABLED=true`. Pasos en `docs/DEPLOY_DISCOUNT_CODES.md`.
- [ ] **Decisiones comerciales antes de habilitar descuentos** (`docs/DEPLOY_DISCOUNT_CODES.md` §5): checkouts abandonados que retienen asientos, tratamiento de un `over_limit`, reemplazo de checkouts con precio de lista viejo.
- [ ] Descuento de solo el primer mes (`once`): no soportado. Requiere verificar con Mercado Pago si `PUT /preapproval/{id}` con un monto mayor se acepta sin reautorización del pagador; hasta entonces el panel no permite guardarlo.
- [ ] Deuda técnica (legacy, no tocado): `invite_codes` / `/admin/codigos` / `/auth/callback` (códigos en plaintext, canje no atómico; `user_access_grants.notes` legacy puede exponer el código al usuario). No usar para el Beta; migrar a `beta_access_codes` o retirar tras la Beta.
- [ ] Opcional post-Beta: UI admin para codes/redemptions (hoy: RPC/SQL) y limitador por IP si hay abuso.

## Now — Explorar Modelos (implementado 2026-09-21, ver CURRENT_STATE.md y ARCHITECTURE.md §18)

- [ ] **Bloqueante para lanzar:** cargar al menos una credencial (`CULTS_USERNAME`+`CULTS_API_KEY`, `MYMINIFACTORY_API_KEY` o `THINGIVERSE_ACCESS_TOKEN`), correr `node scripts/verify-model-search.mjs "soporte auriculares"` y recién entonces habilitar `explorar_modelos` en `/admin/funcionalidades` (hoy apagada). Ninguna fuente está verificada contra el servicio real.
- [x] Búsqueda ampliada español↔inglés y UI compacta (2026-10-29, D038). Verificada contra Cults3D y MyMiniFactory reales con `--multilingual`.
- [ ] Ampliar el léxico (`src/lib/model-search/lexicon.ts`) con las búsquedas reales que no generen variante; no hay analytics de búsquedas (a propósito: no se registran consultas).
- [ ] Decidir si se activa interpretación con IA para consultas que el léxico no resuelve (costo, sesión obligatoria, caché persistente; ver ARCHITECTURE §18.4).
- [ ] Actualizar la matriz `QA_MATRIX.md`: Explorar Modelos con providers reales ya no está ⛔ en Cults3D/MyMiniFactory (requiere correr e2e con credenciales).
- [ ] Mejora futura: favoritos de modelos externos (no hay infraestructura; requiere tabla con RLS por usuario y acción explícita, ver D022).
- [ ] Mejora futura: limitador de tasa y caché compartidos si el hosting es serverless (hoy en memoria por instancia).
- [ ] Crear credenciales de Cults3D (`CULTS_USERNAME` + `CULTS_API_KEY`), ejecutar una búsqueda real y confirmar por introspección/GraphiQL el contrato de `creationsSearchBatch` con `onlyFree`/`onlyPriced`, `price(currency: USD) { cents }`, métricas y dominios de imágenes.
- [ ] Crear API key de MyMiniFactory y cargar `MYMINIFACTORY_API_KEY` en el entorno; hacer una búsqueda real y verificar campos, licencias y dominios de thumbnails.
- [ ] Enviar mail a MyMiniFactory (uso en SaaS con plan pago, cache permitido, rate limits, costos) y al Developer Program de Thingiverse; no cargar `THINGIVERSE_ACCESS_TOKEN` en producción hasta tener respuesta.
- [ ] Decidir dónde vive un rate limiter compartido si el hosting es serverless (hoy es en memoria por instancia).
- [ ] Con una API key real de MyMiniFactory: probar si `store=0/1` funciona en `/search` (figura como parámetro global pero `/search` no lo referencia). Hasta entonces se mantiene el post-filtro por `licenses[].store` y no se envía el parámetro.
- [ ] Verificar visualmente el 5.º ítem del bottom nav de Free (no se pudo iniciar sesión como Free en la verificación).
- [ ] Prueba manual con usuarios Anonymous, Free y Paid (ver checklist del reporte de la tarea).

## Now — Clientes / cuenta corriente / pagos / ticket (implementado 2026-09-18, ver CURRENT_STATE.md y ARCHITECTURE.md §6/§9)

- [ ] Aplicar en Supabase remoto `supabase/migrations/20260918120000_business_customer_accounts.sql` (ver reporte final de la tarea para el detalle completo del SQL y el orden).
- [ ] Prueba funcional real en ambiente con datos: venta cash/transfer/deuda/split, void con deuda, registrar cobro, sobrepago rechazado, aislamiento RLS entre usuarios — los escenarios de base de datos no se pudieron ejecutar localmente (sin arnés Postgres), solo se verificaron por lectura de código/migration.
- [ ] Confirmar visualmente el ticket impreso en una impresora térmica real (58mm/80mm), la vista solo se validó en navegador.

## Now — Auditoría documental (completada 2026-09-15, ver CURRENT_STATE.md)

La auditoría de código local está hecha. Lo que queda es exclusivamente lo que el repo no puede confirmar:

- [ ] Confirmar en Supabase remoto que las migrations `20260912011034`, `20260912030215`, `20260912034506` (Calculadora Free) están aplicadas.
- [ ] Confirmar en Supabase remoto que `20260909145259_xp_progression_foundation.sql` se aplicó limpiamente (evitar el error histórico de `movement.type`).
- [ ] Confirmar en Supabase remoto que `20260910140721_fix_business_sale_location_movements.sql` está aplicada (reemplaza `location_breakdown` por `location_id`).
- [ ] Ubicar/confirmar la migration base (pre-`20260826024736`) que define `has_platform_access()`, `is_admin()` y las tablas core (`products`, `filaments`, `printers`, `profiles`, `user_access_grants`) — no existe en el historial actual del repo.
- [ ] Confirmar si hubo un deadlock (`40P01`) histórico en e-commerce y si quedó resuelto (revisar logs de Postgres en Supabase).
- [ ] Confirmar valor real de `XP_RAFFLE_BONUSES_ENABLED` en producción.
- [ ] Confirmar si Resend sigue siendo parte del stack de envío de emails (no se encontró ninguna referencia en código).
- [ ] Prueba funcional real (no solo lectura de código) de Venta rápida Showroom+Depósito y de anulación de venta.

## Now — Riesgos de código encontrados en esta auditoría (implementación, no documentación)

- [ ] RLS: agregar `has_platform_access()` a las policies SELECT/UPDATE de `product_components` y `product_component_filaments` (hoy solo validan ownership) — riesgo MEDIO.
- [ ] Mi Taller: deduplicar el caso de "Registrar producción" donde se agrega un producto y, por separado, uno de sus propios componentes en el mismo lote — riesgo de doble descuento de filamento.
- [ ] Test: arreglar el mock de `tests/stampy-product-stock-tools.test.mjs` (no contempla `@/lib/filaments/utils`) — 473/474 tests pasan, este es el único rojo.
- [ ] Deuda menor: eliminar la columna huérfana `location_breakdown` de `business_inventory_movements` en una migration futura (ya no se usa).
- [ ] Agregar un script `test` a `package.json` (los 48 archivos de test existen pero se ejecutan manualmente con `node --test tests/*.test.mjs`).

## Now — Stampy conversacional (implementado 2026-10-06, ver D024 y ARCHITECTURE.md §11)
- [ ] **Pendiente (detectado 2026-11-10, sin intervenir):** en la base conectada falta la tabla `public.stampy_user_memory` (log del servidor: «Could not find the table 'public.stampy_user_memory' in the schema cache»). La memoria de Stampy no se carga ni se guarda; el resto del chat funciona. La migration `supabase/migrations/20260826182313_stampy_user_memory.sql` figura en el repo: verificar si está sin aplicar o con drift antes de decidir (no aplicar SQL remoto sin permiso).

- [ ] Definir `OPENAI_MODEL` en cada entorno: vacío = `gpt-5.6-terra`; `.env.local` hoy lo fija en `gpt-5-mini`. Cambiarlo también afecta a Stampa Maker (jarros), que lo usa como fallback de `MUG_AI_MODEL`.
- [ ] QA manual en la app real con la batería de `docs/STAMPY_EVALS.md` (widget, página `/stampy` y `StampyLessonChat`), incluyendo una clase con transcripción.
- [ ] Siguiente sprint: streaming (ver "Streaming" en `docs/STAMPY_EVALS.md`); una respuesta detallada tarda ~20-25 s sin streaming.
- [ ] Correr `supabase/diagnostics/20261006_stampy_knowledge_state.sql` y `20261006_stampy_retrieval_probe.sql` (read-only) y decidir con esos datos los puntos de "Qué convendría mejorar primero" de `docs/STAMPY_KNOWLEDGE_AUDIT.md` (umbral 0.72, activación del RAG por keywords, memoria sin tabla, chunks obsoletos, `lessons.is_published`).
- [ ] Revisar contenido de `stampy_page_contexts` en Supabase remoto: puede contener reglas de longitud o de "derivar a la herramienta" que contradigan el prompt nuevo (no está en el repo).

## Next

- [ ] **Lámparas — diseños estéticos de bases** (fuera del alcance del UX V2; no implementado): minimalista, redondeada, cónica, orgánica, base baja y base decorativa. Deben cambiar solo el exterior de la base: los cuatro sistemas de fijación (doble anillo, a presión, rosca A, rosca B con patas), la rosca de unión y el encastre del difusor quedan intactos. Requiere decidir qué dimensiones mecánicas se conservan en cada diseño y validar cada uno con las piezas de prueba.

- [ ] Auditar Academia, Presupuestos y Mi Tienda en profundidad (no cubiertos en esta pasada, foco fue acceso/RLS/pricing/ventas).
- [ ] Revisar onboarding/ayuda contextual después de estabilizar acceso Free.
- [ ] Decidir si vale la pena implementar service worker para PWA instalable real (hoy solo hay manifest).

## Blocked / Needs Decision

- [ ] Activar beneficios de sorteos por nivel únicamente después de revisión legal/producto.
- [ ] Materializar automáticamente preferencias Free en inventario Paid: actualmente **NO**; cualquier cambio requiere decisión explícita.

## Visibilidad de cursos + Feature flags — despliegue conjunto (2026-10-26)

- [ ] Ejecutar el diagnóstico previo y aplicar `20261024120000` y luego `20261026120000` (ver `docs/DEPLOY_FEATURE_FLAGS_COURSE_VISIBILITY.md`).
- [ ] QA manual con cuenta Free, Paid y Admin (checklist en el mismo documento).
- [ ] Reindexar el conocimiento de Stampy si se quiere limpiar chunks de cursos pasados a oculto/en preparación (ya no se recuperan por la función de búsqueda).

## Cierre Sprint 4.1 (2026-11-05)

**Resuelto / verificado con evidencia (diagnóstico `20261104_definer_rpc_bodies.sql` ejecutado por el dueño en Supabase):**
- [x] `adjust_component_stock`, `adjust_filament_stock`, `adjust_product_stock`: validan `auth.uid()` y la propiedad del registro.
- [x] `assemble_product_from_components` y `consume_filaments_for_products`: validan la propiedad. `consume_filaments_for_products` usa las recetas de los componentes, sin doble descuento adicional evidente → P2-13 cerrado (solo aviso en UI).
- [x] `ensure_default_calculator_product_types`: usa el usuario autenticado.
- [x] QA-014, QA-026, QA-006, QA-011 (Sprint 4).

**Verificaciones pendientes (riesgos residuales, no bloquean el deploy; sin sprint propio):**
- [ ] Las demás RPC `SECURITY DEFINER` no versionadas y los permisos `EXECUTE` (`anon`/`authenticated`) de las ya revisadas: confirmar que `anon` no puede ejecutar las que mueven stock. Sin vulnerabilidad demostrada → no se modifica ninguna RPC.
- [ ] Prueba real contra la API REST con una cuenta Free (guarda de `profiles`, `docs/DEPLOY_PROFILES_GUARD.md`).
- [ ] Redes/Canales: revisar URLs `extruye` en `/admin/redes-canales` (QA-027).
- [ ] QA-007 (`returnTo` tras login) y QA-012 (401 JSON en `/api/*`): tocan el proxy; fuera del Sprint 4.
- [ ] Mi Taller, editores y aviso de producción: sin verificar en navegador con sesión.
- [ ] Circuito real de Mercado Pago (compra, renovación, baja) sin validar de punta a punta (P0-3).
