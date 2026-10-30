# TASKS

Este archivo contiene únicamente trabajo pendiente o próximo. Eliminar tareas terminadas en lugar de conservar un historial infinito.

## Now — Carteles 0.7.1: bisel superior y resistencia (implementado 2026-10-30, ver docs/STAMPA_MAKER.md §36)

- [ ] Validar en Bambu Studio (no hay slicer en el entorno de desarrollo): exportar Normal (1,2 mm) y Reforzado (2,4 mm) con bisel (estilo Moderno), revisar pared vertical + espesor dentro del bisel en vista de capas y los perímetros reales (Reforzado necesita ≥ 1,68 mm para 4 perímetros de 0,42 mm). Lista completa en §36.10.
- [ ] Bisel posterior (`rearBevel*`) y costillas todavía no acompañan a la cavidad (§36.9); decidir si se extiende el mismo mecanismo.
- [ ] Decidir si el valor inicial 1,2 mm (Normal, antes 1,6 mm) es el deseado.
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

## Now — QA integral (2026-10-14, ver docs/QA_REPORT.md)

- [ ] Confirmar la URL real de la beta: `stampa3-d-academy-beta.vercel.app` responde `402 DEPLOYMENT_DISABLED` (QA-001).
- [ ] Correr `supabase/diagnostics/20261014_qa_rls_audit.sql` (solo lectura) y decidir sobre RLS de `profiles` (RIESGO-01), policies premium (RIESGO-02), migrations aplicadas (RIESGO-04) y consistencia de datos.
- [ ] Crear un Supabase de test (o branch) con el schema completo + 4 cuentas (Free, Beta, Paid, Admin) + seed mínimo y definir las variables `E2E_*` (ver `tests/e2e/README.md`) para activar los ~1.300 escenarios que hoy quedan skipped.
- [ ] Triage de bugs P2: QA-009 (firma del webhook de membresías), QA-010 (menú radial), QA-014 (editores: `if (!error)`, doble submit, validación), QA-016 (confirmación en Admin → Usuarios), QA-019 (saldo de cliente truncado), QA-022 (Ventas limitadas a 50).
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
- [ ] Menú radial mobile (`mobile-radial-menu.tsx`): 7 ítems y solo 6 ángulos definidos (Configuración queda sin posición). Bug preexistente sin resolver; por eso Explorar Modelos no se agregó ahí.
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

- [ ] Definir `OPENAI_MODEL` en cada entorno: vacío = `gpt-5.6-terra`; `.env.local` hoy lo fija en `gpt-5-mini`. Cambiarlo también afecta a Stampa Maker (jarros), que lo usa como fallback de `MUG_AI_MODEL`.
- [ ] QA manual en la app real con la batería de `docs/STAMPY_EVALS.md` (widget, página `/stampy` y `StampyLessonChat`), incluyendo una clase con transcripción.
- [ ] Siguiente sprint: streaming (ver "Streaming" en `docs/STAMPY_EVALS.md`); una respuesta detallada tarda ~20-25 s sin streaming.
- [ ] Correr `supabase/diagnostics/20261006_stampy_knowledge_state.sql` y `20261006_stampy_retrieval_probe.sql` (read-only) y decidir con esos datos los puntos de "Qué convendría mejorar primero" de `docs/STAMPY_KNOWLEDGE_AUDIT.md` (umbral 0.72, activación del RAG por keywords, memoria sin tabla, chunks obsoletos, `lessons.is_published`).
- [ ] Revisar contenido de `stampy_page_contexts` en Supabase remoto: puede contener reglas de longitud o de "derivar a la herramienta" que contradigan el prompt nuevo (no está en el repo).

## Next

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
