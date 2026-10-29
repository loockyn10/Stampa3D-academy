# ARCHITECTURE

> Este documento contiene arquitectura vigente conocida. Todo detalle marcado como `REQUIERE VERIFICACIÓN EN REPO` debe comprobarse contra código, migrations, configuración y tests antes de asumirse como hecho.

## 1. Stack

**Verificado en repo (2026-09-15):**

- Next.js 16.2.10 (App Router, `src/app`; no Pages Router).
- React 19.2.4, TypeScript ^5, Tailwind CSS ^4 (`@tailwindcss/postcss`).
- Supabase (`@supabase/ssr` 0.12, `@supabase/supabase-js` 2.110) — Auth + Postgres + Storage.
- OpenAI SDK (`openai` ^6.49) para Stampy.
- Mercado Pago vía integración propia (sin SDK oficial en `dependencies`; llamadas HTTP directas).
- **Resend: no encontrado.** No hay referencia a `resend` ni `RESEND_*` en `src/`. Docs desactualizadas o el envío de emails usa otro mecanismo/no está implementado — **REQUIERE VERIFICACIÓN** (confirmar con el equipo si Resend se retiró o nunca se integró).
- `package.json` scripts reales: `dev`, `build`, `start`, `lint`. **No hay script `test`.**
- PWA: `src/app/manifest.ts` genera `/manifest.webmanifest` (confirmado en build output) — manifest existe. **No hay service worker** (sin `next-pwa`, sin registro de SW). No es un PWA instalable/offline completo, solo manifest + iconos.
- Testing: (1) unit/estático con `node:test` en `tests/*.test.mjs` (75 archivos, 1474 tests; `npm test`; 1 falla preexistente en `stampy-product-stock-tools`); (2) **E2E con Playwright** en `tests/e2e/` (`npm run test:e2e`; roles por variables `E2E_*`, mutaciones solo con `E2E_ALLOW_MUTATIONS=1` y un Supabase descartable; ver `tests/e2e/README.md`). Sin Jest/Vitest. Resultados y bugs del primer sprint QA: `docs/QA_REPORT.md`, `docs/QA_MATRIX.md`.

## 2. Fuente de verdad

Orden operativo:

1. código, migrations, tests y configuración actual del repositorio;
2. documentación vigente en `/docs`;
3. especificación de la tarea actual;
4. conversaciones únicamente como contexto temporal.

Si código y documentación contradicen entre sí, el agente debe señalar la discrepancia antes de modificar arquitectura.

## 3. Autenticación y autorización

Regla principal:

> `authenticated` no significa `paid`.

Estados conceptuales:

- Anonymous
- Free
- Paid
- Admin

Además, un usuario puede tener **acceso Beta** (grant `beta_tester` canjeado con código de invitación): da acceso funcional completo pero **no es Paid** (ver §19 y D023).

No ampliar `has_platform_access()` para que usuarios Free obtengan acceso premium.

**Verificado en repo:** `src/lib/auth/access-policy.ts` (`evaluateAccessPolicy`) es la fuente de verdad de capacidades: `accessPlatform = accessAdmin || membershipValid || validGrantTypes.length > 0`. `src/lib/auth/user-access.ts` (`getCurrentUserAccess`) resuelve `profiles` + `user_access_grants` y expone `capabilities.accessPlatform/useStampy/downloadStl/personalizeCalculator`.

El middleware real es `src/proxy.ts` + `src/utils/supabase/middleware.ts` (`updateSession`), con matcher casi total. Es **default-deny**: rutas explícitamente públicas (`/landing`, `/calculadora`, `/tienda*`, auth, `/pago/estado`, webhooks) y rutas "free" (`/calculadora`, `/perfil`, `/api/calculator/*`) se permiten sin pago; todo lo demás (`mi-taller`, `mi-negocio`, `stampy`, `academia`, `productos`, `stock`) redirige a `/sin-acceso` si `!accessPlatform`, y `/admin/*` exige `accessAdmin`. No se encontró ninguna ruta premium desprotegida a nivel servidor — `mi-taller/layout.tsx` y el resto de layouts no re-chequean acceso, confían correctamente en el middleware (no hay doble gate redundante, tampoco hueco).

Server Actions/RPCs muestreadas (`mi-negocio/actions.ts`, `productos/actions.ts`, `stampy/actions.ts`, `api/stl/download`, funciones `confirm_stampy_*`, `confirm_business_*`) verifican `getCurrentUserAccess`/`has_platform_access` y ownership (`user_id = auth.uid()`) antes de mutar. Sin hallazgos de checks faltantes en la muestra.

Ocultar un botón no constituye seguridad — confirmado que no es el único mecanismo: el gate real está en middleware + RLS + RPC.

## 4. RLS

Principios:

- ownership por usuario/negocio;
- seller isolation;
- tablas premium no deben abrirse a Free por conveniencia;
- evitar policies genéricas que conviertan `authenticated` en permiso total;
- no debilitar RLS para resolver un bug de UI;
- cuando Free necesite una operación acotada, preferir una frontera server-side estrecha o tablas específicas de configuración.

Nunca asumir que una policy permisiva sobreescribe una policy `AS RESTRICTIVE`.

**Verificado en las 30 migrations presentes en el repo:** `has_platform_access()` e `is_admin()` se referencian constantemente pero **no se definen** en ninguna de esas 30 migrations — deben existir en una migration base anterior al historial actual (`20260826024736` es la más antigua del repo) o fueron aplicadas directamente en remoto fuera de este historial. **REQUIERE VERIFICACIÓN EN SUPABASE REMOTO** su cuerpo exacto, y también el RLS de tablas base (`products`, `filaments`, `printers`, `profiles`, `user_access_grants`) que tampoco tienen `CREATE TABLE` en estas 30 migrations.

Casi todas las policies de tablas premium revisadas combinan `user_id = auth.uid()` **AND** `has_platform_access(auth.uid())` correctamente. Se detectaron dos riesgos **MEDIO** (no CRÍTICO/ALTO):

- `product_components` (select/insert/update) — `supabase/migrations/20260827023352_confirm_stampy_create_product.sql:73-109` — solo valida ownership (`user_id = auth.uid()` + join a `products.user_id`), sin `has_platform_access`. Un usuario cuya membresía venció podría seguir leyendo/escribiendo sus recetas de Mi Taller vía REST directo, aunque las RPCs de escritura normales sí validan acceso pago.
- `product_component_filaments` (select/update/delete) — mismo archivo:126-184 — mismo patrón.

Riesgo BAJO adicional: varias policies `select_own`/`update_own` de `stampy_conversations`/`stampy_messages`/`stampy_usage_logs`/`stampy_action_requests` (`20260826024736_stampy_schema.sql`) solo validan ownership en SELECT/UPDATE (no en INSERT, que sí exige `has_platform_access`) — un usuario degradado a Free puede seguir leyendo su historial de chat viejo, sin acceso a crear contenido nuevo. Impacto bajo.

No se modificaron policies durante esta auditoría.

## 5. Migraciones

Reglas:

- no modificar migrations ya aplicadas;
- crear una migration nueva para cambios de schema;
- no ejecutar SQL remoto salvo autorización explícita;
- migrations deben ser compatibles con estado real del schema;
- antes de referenciar columnas/tipos, comprobar migrations e INSERTs existentes;
- evitar suposiciones como columnas inexistentes (`type`, `location_breakdown`, etc.).

El estado remoto de migrations **REQUIERE VERIFICACIÓN EN REPO Y/O SUPABASE**.

## 6. Modelo de datos por dominio

### Taller

**Verificado (nombres reales):** `printer_templates`/`filament_templates` (catálogo), `printers`/`filaments` (físicos del usuario, una fila = una bobina/impresora — confirmado "una bobina física = una card" en `FilamentStockCard.tsx`), `products`/`product_components`/`product_component_filaments` (recetas), `product_stock_movements` (movimientos). Las `CREATE TABLE` base de estas tablas **no están** en las 30 migrations del repo (deben venir de una migration base anterior a `20260826024736`, aplicada fuera del historial actual) — **REQUIERE VERIFICACIÓN EN SUPABASE REMOTO** para el schema autoritativo completo.

"Registrar producción" (`record_production_with_xp` → `consume_filaments_for_production_targets`, consume material y suma a inventario terminado) y "Ajustar inventario" (RPCs `adjust_product_stock`/`adjust_component_stock`/`adjust_filament_stock`, no consumen material) están confirmados como dos paths de código distintos.

### Negocio

Conceptos:

- catálogo comercial;
- artículos fabricados vs reventa;
- ubicaciones/balances;
- movimientos de inventario;
- ventas/items;
- presupuestos;
- órdenes/pagos;
- tienda pública;
- cuenta corriente de clientes;
- pagos parciales de venta.

**Agregado 2026-09-18 (implementado, no aplicado remoto — ver `20260918120000_business_customer_accounts.sql`):**

- `customer_account_movements`: ledger append-only de cuenta corriente. `movement_type in ('sale_debt','payment','sale_reversal','adjustment')`, `delta` positivo aumenta deuda, negativo la reduce. `balance = sum(delta)` por `client_id`. Índice único parcial `(sale_id, movement_type)` para `sale_debt`/`sale_reversal` garantiza a lo sumo un movimiento de cada tipo por venta (evita doble deuda y doble reversal).
- `business_sale_payment_allocations`: líneas de pago inmediato (`cash`/`transfer`) por venta. La deuda nunca es una allocation; se deriva como `business_sales.total - sum(allocations)`.
- `confirm_business_sale(p_idempotency_key, p_items, p_client_id, p_payments default null)`: firma extendida (antes 3 argumentos). `p_payments` es un array `{method, amount}[]`; `null` = compat (pago completo en efectivo, sin deuda); array vacío = deuda total; valida `sum(payments) <= total` (`overpayment` si no) y exige cliente si `debt > 0` (`client_required`). Las firmas de 3 argumentos fueron `DROP`eadas (no solo reemplazadas) para evitar ambigüedad de overload con el nuevo parámetro default.
- `confirm_business_showroom_sale`: misma extensión de firma, reenvía `p_payments` a los 3 call-sites internos a `confirm_business_sale`.
- `void_business_sale`: sin cambios en la restauración de stock; agrega, antes de marcar `voided`, un `sale_reversal` compensatorio si la venta tenía un `sale_debt` asociado (idempotente vía el índice único parcial).
- `register_customer_payment(p_client_id, p_amount, p_method, p_note)`: RPC nueva, cobro posterior de deuda. Rechaza sobrepago contra el saldo actual (no ajusta silenciosamente).
- `get_business_clients_overview(p_search)`: RPC de lectura para el listado de Clientes (nombre, teléfono, última compra, total histórico, saldo), agrega `business_sales` + `customer_account_movements` server-side.
- `get_business_metrics`: extendida con `cashReceived`, `transferReceived`, `newCredit`, `debtCollections` (todas acotadas al período) y `outstandingReceivables` (saldo total actual, no acotado al período).
- RLS de las dos tablas nuevas replica exactamente el patrón de `business_sales` (`select_own` + `has_platform_access`, `admin_all`, sin policies de insert/update — toda escritura pasa por las RPCs `security definer` de arriba).
- `public.clients` (dependencia externa preexistente, igual que `has_platform_access`/`is_admin`) gana `is_active boolean not null default true` vía `add column if not exists` (no-op si Presupuestos ya la había creado).

No crear una segunda fuente de verdad de stock para el mismo producto fabricado.

### Calculadora Free

Última arquitectura acordada:

- Anonymous usa un template Demo.
- Free guarda referencias a templates elegidos para calcular.
- Paid usa entidades físicas reales cuando corresponda.

**Verificado en repo:** las 3 tablas existen y la migration `20260912034506_calculator_free_template_selections.sql` existe y hace lo documentado — crea `calculator_user_printer_templates`/`calculator_user_filament_templates` (referencia pura a templates, PK compuesta `user_id+template_id`), migra los defaults previos, agrega FKs de consistencia, RLS de ownership. `calculator_user_preferences` viene de `20260912011034_calculator_free_preferences.sql`; `20260912030215_restore_calculator_catalog_service_role_select.sql` re-otorga SELECT de service_role sobre el catálogo para que la API de catálogo siga sirviendo a Free/Anonymous tras endurecer RLS.

El motor único (`src/lib/calculator/pricing.ts`) es usado por la única página `/calculadora` para los 3 tiers vía `accessMode`. Free guarda solo referencias (`POST /api/calculator/selections` → upsert en las tablas de selección, nunca crea filas en `printers`/`filaments` físicos) — confirmado sin creación de stock ficticio.

**Aplicación remota de estas 3 migrations REQUIERE VERIFICACIÓN EN SUPABASE REMOTO.**

## 7. Pricing

Debe existir un único motor compartido. La UI no debe duplicar fórmulas.

**Verificado:** motor único en `src/lib/calculator/pricing.ts`, usado por toda la Calculadora. La fórmula real difiere del modelo conceptual simplificado de `PRODUCT.md`: el `multiplier` (margen) se aplica **solo** al costo de material, no a la suma total de costos — `salePrice = filamentCost * multiplier + (electricidad + mantenimiento + mano_de_obra + otros_costos*1.3)`. Multifilamento soportado (líneas de filamento sumadas antes de aplicar `wasteRate`). Componentes/assemblables se resuelven fuera de `pricing.ts`, en la capa de producción (`product_components`, RPC `assemble_product_from_components`).

**Riesgo de doble conteo confirmado en Mi Taller** (no en `pricing.ts` en sí): en `src/app/stock/page.tsx`, el carrito de "Registrar producción" permite agregar simultáneamente un producto completo y, por separado, uno de sus propios componentes. Ni la UI ni la RPC `consume_filaments_for_production_targets` deduplican ese solapamiento — si ocurre, el material de ese componente se descuenta dos veces. Esto es un hallazgo nuevo de esta auditoría, no estaba documentado antes. No se corrigió (fuera de alcance de esta tarea).

## 8. Inventario y ubicaciones

Si Showroom/Depósito están habilitados:

`available_for_sale = showroom + depósito`

El backend decide el split de consumo en transacción:

1. lock/revalidación;
2. consumir Showroom;
3. consumir faltante en Depósito;
4. registrar movimientos;
5. crear/confirmar venta.

Transfers no modifican stock total.

**Verificado en repo:** el split Showroom→Depósito está implementado tal como lo describe este documento. `confirmBusinessSaleAction` (`src/app/mi-negocio/actions.ts:609-656`) elige `confirm_business_showroom_sale` cuando `locations_enabled`. Esa función (`supabase/migrations/20260910140721_fix_business_sale_location_movements.sql:73-396`) valida `showroom_qty + warehouse_qty >= cantidad`, calcula `showroom_consumed = min(showroom_qty, cantidad)` y `warehouse_consumed = cantidad - showroom_consumed` dentro de una transacción con locks (`for update`, `pg_advisory_xact_lock`). Caso de prueba del ejemplo del doc (showroom=2, depósito=10, venta=5) da showroom=0, depósito=7 — coincide exactamente. No se encontró ningún camino que limite la venta solo por stock de Showroom (la regresión histórica documentada parece resuelta en el código actual; **REQUIERE VERIFICACIÓN FUNCIONAL EN AMBIENTE REAL**).

## 9. Ventas

**Verificado:** `void_business_sale` (misma migration, líneas 398-834) hace `UPDATE status='voided'` — no es DELETE. Idempotente: si `status='voided'` ya, retorna `already_voided` sin tocar stock de nuevo. Bloquea explícitamente ventas con `order_id is not null` (pagos online) — exige un flujo separado, sin refund automático. Movimientos compensatorios (`void_sale`) se insertan por ubicación, sin borrar movimientos originales. Excluida de métricas: todas las queries de `get_business_metrics` filtran `status = 'completed'`.

`location_breakdown` (columna jsonb agregada en `20260909031859`) **sigue existiendo en el schema pero ya no es referenciada** por `confirm_business_showroom_sale` ni `void_business_sale` vigentes (reemplazada por `location_id uuid` con FK en `20260910140721`). Es deuda técnica huérfana (nunca se hizo `DROP COLUMN`), no un bug activo — el error histórico `column movement.location_breakdown does not exist` no debería reproducirse con el código actual. **REQUIERE VERIFICACIÓN EN SUPABASE REMOTO** que la migration `20260910140721` esté aplicada y que no queden funciones remotas viejas apuntando a la columna.

**Agregado 2026-09-18 (implementado, no aplicado remoto):** `void_business_sale` (`20260918120000_business_customer_accounts.sql`) mantiene exactamente la misma lógica de restauración de stock y agrega, antes del `update status='voided'`, la reversión financiera: si la venta tiene un movimiento `sale_debt` en `customer_account_movements`, inserta un `sale_reversal` compensatorio (`delta` negativo, mismo monto) — nunca borra el `sale_debt` original. Un segundo intento de void ya es bloqueado antes por `already_voided`, y el índice único parcial `(sale_id, movement_type)` impide un segundo `sale_reversal` aunque se llegara a insertar. Métricas nuevas (`newCredit`, `debtCollections`, `outstandingReceivables`) también filtran implícitamente por este ledger, sin necesidad de excluir ventas anuladas por separado (el `sale_reversal` ya neutraliza el `sale_debt` en la suma).

## 10. Scanner

**Verificado — implementado, no solo diseñado:** `src/lib/barcode/hid-scanner.ts` (`BarcodeHidDetector`, umbrales de ráfaga) + `src/components/barcode/BarcodeScannerProvider.tsx` (listener global, `findContextualHandler` por ruta+prioridad). Prioridades reales confirmadas: stock intake (`StockReceiptDialog.tsx`) prioridad 1000, captura de barcode en Catálogo (modal) prioridad 1100 pero acotada a edición activa, Venta rápida y Catálogo (lectura) prioridad 100, fallback global → `/mi-negocio/venta-rapida`. Coincide con el orden documentado.

**Ingreso de stock por scanner: implementado**, no pendiente. `StockReceiptDialog.tsx` maneja `barcodeType: "case"`, `unitsPerScan`, cola de `pending` scans, y confirma vía RPC `confirm_business_stock_receipt` idempotente por `operationKey`.

## 11. Stampy

**Verificado — inventario real de tools** (`src/lib/stampy/tool-registry.ts`, 13 tools registradas): solo 5 son ejecutables desde el chat (`canExecuteFromChat:true`) — `clients.inspect`, `products.inspect`, `products.recalculate`, `products.production_capacity`, `stock.filaments.list`; el resto (crear impresora/filamento/producto, descontar stock) son "contratos informativos": el modelo puede describir la acción pero no ejecutarla desde el chat. `askStampyAction` (`src/app/stampy/actions.ts:621`) resuelve `userId` desde su propia sesión server-side (`getCurrentUserAccess`), nunca del payload de contexto. El único tool de escritura ejecutable, `products.recalculate`, delega en `recalculateProductPriceAction` (`src/app/productos/actions.ts`), que vuelve a resolver auth+ownership de forma independiente — confirma "contexto ≠ autorización". Sanitización confirmada: `src/lib/stampy/screen-context.ts` aplica límites duros (20 entidades visibles, 4000 chars de prompt, truncado de texto).

**Flujo conversacional (2026-10-06, D024).** `askStampyAction` mantiene los atajos deterministas (herramientas directas, análisis de pantalla, action intents) antes del modelo. Para el resto:

1. `getRecentHistory` (`history.ts`): últimos 12 mensajes de la conversación (2400 chars c/u, 14000 en total, descarta los más viejos), ordenados por `created_at` + `role` (usuario y asistente del mismo turno comparten `created_at`).
2. `buildStampyContextQuery` (`responses.ts`): si el mensaje es un seguimiento corto/anafórico ("¿y con PETG?", "¿por qué?", "la otra"), se combina con el último mensaje del usuario. Ese texto alimenta clasificación de intención, memoria, contextos oficiales, transcripción, retrieval, herramientas y ranking de clases; el modelo igual recibe el historial completo.
3. `instructions` = `STAMPY_SYSTEM_PROMPT` (`system-prompt.ts`, fijo, primero para cache) + "CONTEXTO DE ESTE TURNO": clase actual (metadata saneada del cliente) y su transcripción, orientación por intención (soft), contextos oficiales/estáticos, perfil, sorteos/stock según ruta, taller, pantalla, memoria, retrieval, herramientas de `app-knowledge` relacionadas, clases recuperadas (sólo intención `course_recommendation`, baja confianza) y acciones/contratos de la ruta.
4. `openai.responses.create` con `input` = historial con roles + mensaje actual, `store: false`, `reasoning.effort` configurable, `max_output_tokens` 4000. Sin streaming.
5. Si falla o no hay texto: fallback `STAMPY_MODEL_UNAVAILABLE_MESSAGE` con `error`/`errorCode: "model_unavailable"`, no se persiste, se registra en `stampy_usage_logs` (modo `error`) y en logs server-side sin headers ni keys.

Batería de QA conversacional: `docs/STAMPY_EVALS.md` + `scripts/stampy-eval.mjs`.

## 12. XP

**Verificado:** `20260909145259_xp_progression_foundation.sql` crea `user_xp_events` (ledger append-only, único `(user_id, event_key)`), `user_xp_summary`, `award_user_xp` (SECURITY DEFINER, revocada de `anon/authenticated`), y dos wrappers callable por el cliente: `record_calculator_xp`, `record_production_with_xp`. Caps diarios/de por vida por tipo de evento confirmados en una tabla de reglas interna. Idempotencia confirmada vía índice único + `pg_advisory_xact_lock` por usuario. El bug histórico `column movement.type does not exist` está **mitigado dentro de la misma migration**: el backfill de `first_production` lee `to_jsonb(movement) ->> 'movement_type'`/`'type'` con `coalesce(...,'add')`, con comentario inline explicando que `product_stock_movements` tuvo ambos nombres de columna históricamente. No existe una migration de "fix" posterior dedicada a XP — no fue necesaria porque el guard ya está en la migration original. **Aplicación real en Supabase remoto REQUIERE VERIFICACIÓN** (docs previos registran al menos un error durante el intento de aplicación; no hay evidencia en el repo de que se haya resuelto en producción).

Sorteos/niveles: `src/lib/xp/raffle-bonuses.ts` existe y está completamente gateado por `XP_RAFFLE_BONUSES_ENABLED` (env var no seteada en el repo → apagado por defecto), consistente con "desacoplado hasta revisión legal".

## 13. E-commerce y pagos

**Verificado:** tablas `business_payment_accounts`, `business_payment_oauth_states`, `business_orders`, `business_order_items`, `business_stock_reservations`, `business_payments`, `business_payment_webhook_events` (todas en `20260908014943_business_ecommerce_base.sql`), separadas de `business_sales`/`business_sale_items` (vínculo opcional vía `order_id`/`sale_id`, no fusión). Aislamiento por seller confirmado vía RLS (`user_id = auth.uid()` + `has_platform_access`) y RPCs `security definer` que filtran por `store.user_id` internamente, revocadas de `anon/authenticated` (solo `service_role`). OAuth de Mercado Pago: `src/app/api/business/mercadopago/{connect,callback,disconnect}/route.ts` con PKCE. Webhook con doble capa de idempotencia: `business_payment_webhook_events` (unique `provider+provider_event_id`) y `business_payments` (unique `provider+provider_payment_id`, `on conflict do update`). Comisión de marketplace configurable vía `BUSINESS_MARKETPLACE_FEE_PERCENT` (env, no hardcoded).

No se encontró ninguna referencia a un deadlock (`40P01`) histórico en migrations ni mensajes de commit del área e-commerce; el código actual usa `lock_timeout`, locks ordenados y `pg_advisory_xact_lock` de forma proactiva. **Si el deadlock ocurrió y cómo se resolvió REQUIERE VERIFICACIÓN EN SUPABASE REMOTO** (logs de Postgres), no puede confirmarse ni descartarse solo con el repo.

## 14. Storage e imágenes

**Verificado — 3 buckets:** `stampy-knowledge-documents` (privado, PDFs, `20260828103109`), `business-storefront-assets` (público, escritura por el propio dueño del negocio, `20260907213952`), `printer-catalog-images` (público de lectura, `20260909163023`). Catálogo de impresoras confirmado como global/compartido: `printer_templates.image_path` con comentario explícito "Shared by every linked user printer". Escritura del bucket de catálogo restringida a admin (`public.is_admin(auth.uid())` en insert/update/delete); usuarios normales solo tienen `select`.

## 15. Convenciones de implementación

- reutilizar componentes y motores existentes;
- no crear sistemas paralelos para resolver una variante de acceso;
- no crear APIs genéricas de mutación;
- preferir DTOs mínimos;
- no usar `select("*")` en endpoints públicos;
- no confiar en IDs de usuario enviados por frontend;
- no confiar en cantidades o split de stock enviados por frontend;
- operaciones críticas deben ser atómicas e idempotentes cuando corresponda;
- mantener mobile y accesibilidad;
- no introducir dependencias grandes por una necesidad menor.

## 16. Stampa Maker (nuevo, 2026-09-17)

Sección nueva `/stampa-maker` (protegida como el resto de "Plataforma": no
está en `isFreeAccountRoute`, requiere `accessPlatform`). Primera
herramienta: `/stampa-maker/carteles` (Creador de Carteles), texto ->
geometría 3D de letras corpóreas huecas (fondo cerrado, frente abierto) ->
preview three.js -> export STL (palabra completa o ZIP de letras
individuales recentradas, vía `jszip`). Cada letra terminada es un único
sólido soldado por coordenadas compartidas (1 connected component; sin
CSG/boolean 3D). Pipeline geométrico propio en `src/lib/maker/geometry/*`
(opentype.js + clipper-lib + earcut, sin Web Workers). No toca auth, RLS,
pricing ni stock existentes. Detalle completo, dependencias y limitaciones
conocidas en `docs/STAMPA_MAKER.md`.

## 17. Validación técnica

**Verificado (2026-09-15):** `package.json` no tiene script `test`. Comandos reales que funcionan:

- `npx tsc --noEmit` → limpio, sin errores.
- `npm run build` → build de producción exitoso, todas las rutas compilan (ver lista completa en `CURRENT_STATE.md`).
- `git diff --check` → sin errores de whitespace.
- `node --test tests/*.test.mjs` → 474 tests, 473 pasan, 1 falla (ver `CURRENT_STATE.md`, es el fallo históricamente documentado, no uno nuevo).

No hay `npm run lint` verificado en esta auditoría (fuera de foco; comando existe en scripts pero no se ejecutó).

## 18. Explorar Modelos / búsqueda federada (2026-09-21)

Módulo `src/lib/model-search/` (server) + `src/components/explorar-modelos/` (UI) + `GET /api/model-search` + página `/explorar-modelos`.

- **Contrato** (`types.ts`): `ModelSearchProvider` (`id`, `isEnabled()`, `getCapabilities()`, `health()`, `search()`), DTO `ModelSearchResult` (incluye `priceType = free|paid|unknown`, `price` y `currency`; campos no informados = `null`/`"unknown"`), cursor por provider con marca explícita de provider agotado.
- **Providers** (`providers/`): `cults.ts` (GraphQL oficial `POST https://cults3d.com/graphql`, HTTP Basic con `CULTS_USERNAME` + `CULTS_API_KEY`), `myminifactory.ts` (API v2 oficial, `GET /api/v2/search`, `MYMINIFACTORY_API_KEY`) y `thingiverse.ts` (API oficial `GET /search/{term}?type=things`, Bearer `THINGIVERSE_ACCESS_TOKEN`). Sin credencial completa → `disabled` y la fuente no se muestra. Hosts hardcodeados; nunca se hace fetch de URLs del usuario. Agregar una fuente = archivo nuevo + `sources.ts` + `registry.ts`.
- **Orchestrator** (`service.ts` `searchModels`): `Promise.allSettled`, timeout individual (4,5 s, con `AbortController` + `Promise.race`), estado por fuente (`ok|timeout|error|disabled|unsupported`), resultados parciales y merge round-robin. Las capabilities distinguen filtro de precio `native|post|none` y si el provider reporta precio. Cults filtra Gratis/De pago en origen; MyMiniFactory se post-filtra solo por `licenses[].store`; Thingiverse no participa en esos filtros porque reporta `unknown`. `unknown` nunca pasa como Gratis/Pago. El cursor conserva `null` para providers agotados y la UI deduplica por `provider:externalId`, evitando repetir página 1 o cards solapadas. Los filtros comerciales existentes mantienen su capability nativa. La UI y el futuro tool de Stampy (`models.search`) deben llamar a este servicio, no a los providers.
- **Licencias** (`license.ts`): MMF por `licenses[]` (`commercial-use`, `mention`, `remix`, `store`); Thingiverse por tabla explícita de nombres de licencia; todo lo demás `unknown`. `isFree` de Thingiverse es `null` (la API no expone precio); "gratis" desconocido nunca cuenta como gratis.
- **Seguridad** (`sanitize.ts`): URLs solo `https`, sin credenciales, dominio del provider (o subdominio); si `originalUrl` es inválido el resultado se descarta; thumbnail inválido → `null`. Texto plano acotado; sin `dangerouslySetInnerHTML`. Thumbnails con `<img>` directo a la CDN de la fuente (sin proxy ni storage de Stampa). Credenciales solo server (`process.env`), nunca `NEXT_PUBLIC_*`.
- **Cache** (`cache.ts`): en memoria, key por provider + query + precio + uso comercial + orden + página + tamaño, TTL 10 min, máx. 300 entradas, solo respuestas OK. No hay DB, tabla ni crawler. Es por instancia del servidor (no compartido).
- **Rate limit** (`rate-limit.ts`): ventana fija en memoria, 20 req/min por IP (anonymous) y 40/min por usuario. Best-effort por instancia; el resto de la infra de rate limit del repo usa tablas de logs por usuario autenticado y no sirve para anonymous.
- **Acceso**: `/explorar-modelos` está en `isPublicRoute` de `src/utils/supabase/middleware.ts` y `/api/model-search` en `publicApiRoutes`; `MainLayout` muestra la página sin shell a anonymous y con shell a autenticados. La API resuelve el tier con `getCurrentUserAccess` (`authenticated` ⇒ búsqueda completa; `accessPlatform` solo distingue Paid para la UI). No se toca `has_platform_access()`.
- **Calculadora**: `/calculadora?action=calculate&name=…` (reutiliza el prefill de Stampy). Solo transfiere `name`, mostrado como "Modelo de referencia" y precargado en el nombre del producto a guardar; `source`/`originalUrl` no se guardan porque el producto no tiene lugar para metadata externa.
- **Navegación**: sidebar desktop (Plataforma y grupo Gratis), bottom nav mobile de Free (5.º ítem "Explorar"), acceso rápido en Inicio (paid) y entrada en la búsqueda global. El menú radial mobile de paid no se modificó: tiene 7 ítems para 6 ángulos definidos.
- No hay eventos/analytics en el repo: no se registran `model_search`/`model_result_open`/`model_calculate`.

## 18b. Librería STL: Grupos + detalle + viewer 3D (2026-10-09)

Rutas: `/libreria-stl` (grupos + búsqueda de modelos) → `/libreria-stl/[group]` (slug o id; `otros-modelos` virtual) → `/libreria-stl/[group]/[model]` (id del modelo; si el grupo de la URL no coincide, redirige al canónico). Todas bajo el gate de plataforma del middleware. Datos: `stl_categories` (= grupo) / `stl_models` / `stl_variants` leídos con el cliente Supabase + RLS (`src/lib/stl/queries.ts`); lógica pura en `src/lib/stl/library.ts` (agrupado, contadores, resolución de slug, soporte del viewer, formato de dimensiones). Ver D025.

- Viewer: `src/components/stl/Model3DViewer.tsx` (Three.js directo, render on-demand, sin drei/fiber). Flujo: `POST /api/stl/preview {variantId}` → URL firmada (300 s, sin `download`) → `fetch` con progreso y tope de 60 MB → `STLLoader` → `parseModel3D` (`STLLoader` o `ThreeMFLoader` según el `format` que devuelve el servidor; 3MF devuelve un Group con varias mallas, se unifica con material neutro y se centra con `Box3`) → `OrbitControls` (drag/rueda/pinch). Cleanup: `dispose` de geometry/material/controls/renderer + `forceContextLoss` + abort del fetch. Errores con estado propio: sin acceso, archivo faltante, red, muy pesado, STL dañado, WebGL no disponible, contexto perdido.
- `/api/stl/download` y `stl_downloads` no cambiaron; `StlDownloadButton` reutiliza el mismo flujo.
- Admin: `/admin/stl/categorias` = **Grupos** (alta/edición, portada vía `FileUploadDropzone` en `stl-thumbnails`, orden, publicado; sin hard delete: se despublica); el formulario de modelo asigna grupo con `Combobox` (o "Sin grupo").
- Sin migration: el schema `stl_*` no está versionado en `supabase/migrations` (viene de antes); RLS/bucket `stl-files` privado no se tocaron.

### 18c. Librería STL: previews 360° en cards (2026-10-11)

- Las cards **no** montan Three.js: usan un WebM 360° prerenderizado (`stl_models.preview_url`, nullable; una vez por modelo, no por variante). El viewer real sigue solo en el detalle.
- Generación **client-side desde el Admin** (`src/lib/stl/generate-preview.ts` + `record-turntable.ts`): descarga el archivo por `POST /api/stl/preview` (misma autorización que el viewer; `stl-files` sigue privado), parsea con `parseModel3D` (STL o 3MF), usa los helpers compartidos de `model-display.ts` (material neutro, centrado, Z-up, luces, encuadre; también los usa el viewer), gira 360° en un canvas offscreen 512×512, 4 s, 24 fps y graba con `captureStream` + `MediaRecorder` (VP9 → VP8 → webm). Requiere Chromium.
- Storage: bucket público `stl-previews` (solo `video/webm`, escritura solo Admin), path determinístico `{modelId}/preview.webm` (upsert: regenerar reemplaza). `preview_url` = URL pública + `?v=timestamp` (anti-cache). Orquesta `preview-service.ts` (`generateAndStorePreview`, nunca lanza).
- El fallo del preview **no** bloquea el alta/edición: el modelo se guarda primero; el Admin muestra "No pudimos generar la vista 360°. El modelo fue guardado correctamente." y la card usa el thumbnail. Reemplazar el archivo principal invalida `preview_url` (`saveStlModel({ fileChanged })`) y se regenera.
- Card: `ModelPreviewCardMedia` (thumbnail → video WebM). **Ciclo ambiental** (`preview-cycle.ts`, coordinador único de la página): sin interacción, UNA sola card visible (≥50 %, con preview, sin error, sin `prefers-reduced-motion`) reproduce una vuelta y al `ended` pasa a la siguiente (A→B→C→A; si hay una sola, repite tras ~2,5 s). Hover (solo puntero real) y focus tienen prioridad absoluta (repite mientras dure) y al salir el ciclo vuelve tras ~1 s desde la card siguiente. Sin `loop`; `preload="none"`, `src` solo al activarse (se libera al salir del viewport); error de video → thumbnail y la card queda fuera del ciclo; pestaña oculta pausa. Badge "360°" solo con `preview_url`. Constantes en `AMBIENT_TIMING` (`preview-media.ts`).
- Miniatura automática: `generateModelAssets` parsea y arma la escena UNA vez y captura un WebP 512 (vista 3/4, yaw 40°) con `canvas.toBlob` antes de grabar el WebM; ambos assets fallan de forma independiente. Va a `stl-thumbnails/{modelId}/thumbnail.webp` (upsert) → `thumbnail_url`. **Regla manual vs generada sin columna nueva:** una miniatura es "generada" si su URL termina en `/stl-thumbnails/{modelId}/thumbnail.webp`; solo esas (o una vacía) se regeneran solas (p. ej. al reemplazar el archivo). Una cargada a mano nunca se pisa salvo el botón explícito "Regenerar miniatura" del Admin.
- Compat: `fetchStlLibrary` reintenta sin `preview_url` si la migration aún no está aplicada. Migration: `20261011120000_stl_model_preview_360.sql`.

### 18d. Librería STL: 3MF multiplate (Plate 1) + colores (2026-10-13)

- **Pipeline único:** `prepareModelForDisplay(THREE, format, buffer)` (`src/lib/stl/prepare-model.ts`) devuelve `{ object3d, format, selectedPlate, plateCount, colorMode, slicer, fallbackReason, dispose }` y alimenta viewer, miniatura WebP y WebM (`generateModelAssets` prepara UNA vez). Ninguna superficie parsea ni aplica material por su cuenta.
- **Estructura real encontrada** (archivos de Bambu Studio 02.07 y OrcaSlicer 2.4 inspeccionados sin geometría, + fuente pública de Bambu para los nombres de clave): `_rels/.rels` → `3D/3dmodel.model` (objeto envoltorio `<object id>` → `<component p:path="/3D/Objects/…model" objectid>`; `<build><item objectid>`), `Metadata/model_settings.config` (`<object id>` con `metadata extruder`, `<part id>` = objectid del componente, `<plate>` con `plater_id` y `<model_instance>` `object_id`/`instance_id`), `Metadata/project_settings.config` (JSON, `filament_colour`). Bambu y Orca comparten formato; Orca se distingue por `<metadata name="OrcaSlicer">`/`Application`. El orden del `<build>` **no** coincide con el de las camas (se mapea por `object_id`, nunca por posición). Un 3MF ya sliceado para impresión puede traer plates con `<build/>` vacío (se trata como genérico).
- **Detección/selección** (`three-mf-package.ts`, puro y testeable): reconoce slicer solo si hay `BambuStudio:3mfVersion` + `model_settings.config` con `<plate>`; cada `model_instance` se mapea al n-ésimo build item con ese `objectid`; todo item debe quedar en exactamente una cama, si no → **fallback al build completo** (`kind: "generic"`). `ThreeMFLoader` devuelve un child por build item en el orden del `<build>` (verificado con el loader real en Chromium): `select3mfPlate(root, info, plateIndex)` quita los demás children (V1 visible: `plateIndex = 0`; ya soporta 1, 2, … sin reescribir el parser). 3MF sin metadata reconocible → render completo; STL no usa plates.
- **Colores:** 3MF con materiales estándar (`basematerials`, color groups, texturas): `ThreeMFLoader` ya los reconstruye y se **conservan**. Mallas sin color (`__DEFAULT`) → Bambu/Orca: pieza (componente) → `extruder` de la parte u objeto → `filament_colour[extruder-1]` (solo `#RRGGBB[AA]` válidos); sin dato confiable → neutro. Facetas con `paint_color` (pintura multicolor) **no se decodifican** (la codificación del árbol de subdivisión no se pudo validar con un archivo real con geometría): esa pieza queda neutra. STL: neutro. Es el color *visual configurado* en el archivo, no un filamento ni material físico de Stampa.
- **UI:** el viewer agrega "Mostrando cama 1 de N" solo cuando hay más de una cama; sin selector.
- **Seguridad de parsing:** todo en memoria; antes de parsear se valida el ZIP (≤20 000 entries, ≤512 MB por entry y ≤1 GB declarado descomprimido; excedido → `Model3DLoadError("corrupt")`); solo se descomprimen entries con nombre exacto validado (sin `..`, `\`, `:`; nada se escribe a disco); XML con scanner propio que rechaza `DOCTYPE`/`ENTITY`; modelo raíz ≤64 MB (mallas descartadas antes de escanear), configs ≤8 MB. Sin dependencias nuevas (usa el `fflate` que ya empaqueta `ThreeMFLoader`).
- **Diagnóstico:** `node scripts/inspect-3mf.mjs archivo.3mf` imprime entries, slicer, camas, piezas, filamentos/colores y sub-modelos con `paint_color` usando el mismo módulo.
- **Verificado / no verificado:** Node no tiene `DOMParser`, así que los tests usan un doble de `ThreeMFLoader` con la forma real; el loader real, la miniatura WebP (512 px) y el WebM (VP9, ~87 frames) se probaron en Chromium con 3MF sintéticos de 3 camas (`tests/helpers/bambu-3mf-fixture.mjs`). Los 3MF reales disponibles no traían geometría (sub-modelos ausentes). Falta un 3MF real completo (camas + multicolor, idealmente pintado) para validar colores/paint.

## 19. Acceso Beta por código de invitación (2026-10-05)

Migration `20261005120000_beta_access_codes.sql` (no aplicada en remoto; ver TASKS.md). Diagnóstico read-only: `supabase/diagnostics/20261005_beta_access_state.sql`.

- **Capa de acceso reutilizada:** un canje escribe una fila `grant_type = 'beta_tester'` en `user_access_grants` (ya parte de `evaluateAccessPolicy`/`has_platform_access`). No toca `profiles.membership_*` ni `subscriptions`: Beta ≠ Paid.
- **Tablas nuevas (solo RPC, RLS activo, sin acceso de `anon`/`authenticated` salvo `select` de las propias redemptions):** `beta_access_codes` (solo `code_digest` SHA-256 del código normalizado, nunca plaintext; `label`, `active`, `max_uses`, `redeem_until`, `access_expires_at`), `beta_access_redemptions` (único `(code_id, user_id)`; `revoked_at`; los usos de un código = filas aquí) y `beta_access_failed_attempts` (anti fuerza bruta).
- **`redeem_beta_access_code(p_code)`** (`security definer`, ejecutable solo por `authenticated`): identidad = `auth.uid()`. Bloquea la fila del código (`FOR UPDATE`) mientras cuenta usos e inserta la redemption → atómico; el mismo usuario nunca consume otro uso (`already_redeemed`); devuelve `{status}` (no lanza) para que los intentos fallidos persistan. Límite: 5 inválidos/15 min **por usuario** (`rate_limited`); sin contador global compartido (un usuario no puede bloquear a los demás). El límite no frena a quien crea muchas cuentas: por eso el código debe ser largo y aleatorio. Nunca acorta un Beta existente.
- **Admin:** `create_beta_access_code(...)` y `revoke_beta_access(user_id)` (admin vía `is_admin(auth.uid())`, o sesión `postgres`/`service_role`; sin UI). Revocar también funciona desde `/admin/usuarios` ("Revocar Beta").
- **`has_platform_access(uuid)`:** su definición remota no está versionada y **la migration nunca la crea, reemplaza ni altera**. Solo la verifica al inicio (antes de crear nada) y **aborta con un mensaje claro** si no menciona `user_access_grants` + `status` + `expires_at` (fail closed; chequeo necesario, no suficiente: hay que leer la definición con el diagnóstico). Si es incompatible, se ajusta manualmente en un paso aparte y revisado, y recién entonces se aplica la migration. Free sigue sin acceso.
- **App:** `src/lib/beta-access/code.ts` (normalización idéntica a SQL, DTO seguro), `src/app/beta-access/actions.ts` (server action: usa solo la sesión, nunca expone digests ni errores RPC), `BetaCodeRedeemCard` (Perfil y Sin acceso), campo opcional en `/registro`.
- **Signup/email:** el código nunca va a metadata de auth ni a la DB en plaintext. Con sesión inmediata se canjea tras `signUp`; si exige confirmar email se guarda en `localStorage` (7 días) y `PendingBetaCodeRedeemer` (root layout) lo canjea al autenticarse. Fallback siempre disponible: Perfil / Sin acceso → "Canjear código".
- **Hardening de privilegios de `user_access_grants`** (parte de la migration, sin tocar `has_platform_access` ni `service_role`): el diagnóstico remoto (2026-10-05) mostró `TRUNCATE`/`REFERENCES`/`TRIGGER` para `anon` y `authenticated` (TRUNCATE ignora RLS: cualquier usuario podía vaciar todos los grants). Se revoca todo a `anon` y `TRUNCATE, REFERENCES, TRIGGER` a `authenticated`/`PUBLIC`. Se **conservan** `SELECT/INSERT/UPDATE/DELETE` de `authenticated` porque el admin gestiona grants con su sesión (`grantBetaAccessAdmin`, `/admin/usuarios` "Revocar Beta") confinado por las policies existentes ("Admins can manage access grants" ALL con `is_admin`, "Users can view own access grants" SELECT). Reducir esos privilegios exigiría mover la gestión a RPC `security definer` (fuera de alcance). El canje Beta no depende de estos privilegios (RPC `security definer`).
- **Legacy `invite_codes`** (plaintext, no atómico, canje solo en `/auth/callback`, sin migration en el repo): el Beta Access **no depende de él ni comparte tablas, RPC, campo de registro o metadata** (campos separados `ref-code` / `beta-code`; test de aislamiento). Único punto en común: ambos pueden escribir una fila `beta_tester` en `user_access_grants` (el canje nuevo extiende y nunca acorta). **`/admin/codigos` no debe usarse para crear el código Beta.** No se migró ni borró; es deuda técnica (ver TASKS).
- **Puente con `invite_codes` (2026-10-28, D032):** migration `20261028120000_beta_redeem_legacy_invite_codes.sql` (aplicar DESPUÉS de la de Beta). `redeem_beta_access_code` busca primero el hash y, si no existe, el código en `invite_codes` (solo `beta_tester`/`manual_free_access`) vía la función interna `redeem_legacy_beta_invite` (no ejecutable por API roles). Misma identidad (`auth.uid()`), mismo rate limit, fila bloqueada `FOR UPDATE`, idempotente, `used_count` + redemption + grant escritos como lo hacía el callback pero extendiendo el grant existente. Los descuentos nunca otorgan acceso. Esto reemplaza el aislamiento total descrito arriba: **el Beta ya no es independiente de `invite_codes`** (los códigos legacy existentes se respetan sin migrarlos). Fail-closed: aborta si falta Beta Access, si faltan tablas/columnas legacy o si `user_access_grants.grant_type` no es text. En `/registro`, un código escrito en "Código de referido" con sesión inmediata recibe un canje silencioso (el callback solo corre al confirmar email). Diagnóstico read-only: `supabase/diagnostics/20261028_codes_state.sql`.
- **Descuentos en el checkout (2026-10-29, D033):** ver §22. Antes de esa fecha `discount_percent` / `discount_fixed_amount` / `fixed_price` se guardaban en `invite_codes` pero ninguna ruta los aplicaba.
- **Tests:** `tests/beta-access.test.mjs` (lógica, política de acceso, análisis estático) y `tests/beta-access-db.test.mjs` (opt-in: Postgres embebido real con concurrencia; `npm i --no-save embedded-postgres pg`).

**Nota STL admin (2026-10-09):** `stl_models.name` es NOT NULL en el schema real (también existe `title`). El formulario arma el payload con `buildStlModelPayload` (`src/lib/stl/model-payload.ts`): el título del form se escribe en `name` **y** `title`; lo mismo la variante. La Librería muestra `title || name`.

## 20. UX V2 — dashboards y rediseño (2026-10-22)

Rama `feature/universo-stampa-ux-v2`. Ver D028.

- **Componentes compartidos:** `src/components/ui/dashboard.tsx` (`PageHeader`, `StatCard`, `Panel`, `PanelEmpty`). Los dashboards separan contenedor (datos) y vista (`*View`, sin acceso a datos).
- **Mi Taller:** `src/lib/workshop/routes.ts` (pestañas, rutas y filtros de destino), `dashboard.ts` (`buildWorkshopSummary`, puro), `load-summary.ts` (lecturas RLS compartidas con Inicio), `src/components/workshop/workshop-dashboard.tsx`. Filtros de destino nuevos: `/mi-taller/inventario?estado=sin-stock`, `/mi-taller/productos?estado=recalcular`; `/mi-taller/inventario?action=registrar-produccion` abre el modal existente de Registrar producción.
- **Mi Negocio:** `src/components/business/business-dashboard.tsx` + `src/lib/business/dashboard.ts` (pedidos pendientes = `awaiting_payment` vigente + `payment_review`; alertas). Conserva las nueve herramientas agrupadas. `/mi-negocio/pedidos?estado=…` preselecciona el filtro.
- **Inicio:** `src/components/home/home-dashboard.tsx`; cada bloque carga y falla por separado. "Continuar aprendiendo" = curso con la `lesson_progress.completed_at` más reciente (`src/lib/academy/continue-learning.ts`); sin cursos, el primer curso publicado.
- **Calculadora:** `calculateMarketplacePrice` en `src/lib/calculator/pricing.ts` (comisión sobre el precio final, ver D028; estados `ok`/`not_configured`/`invalid_commission`, `netReceived`); `validateCalculatorSettings` valida rangos al guardar; `MarketplacePriceCard` y `CalculatorSettingsModal` en `src/components/calculadora/`. Los diálogos de confirmación/toasts de `app-feedback` quedan por encima de `Dialog` (z 160/170 vs 150).
- **Stampy:** solo UI en `src/app/stampy/page.tsx` (estado de bienvenida, composer auto-expandible, scroll dentro del contenedor, indicador de respuesta lenta). Backend, historial, herramientas y acciones sin cambios. Sin streaming (sigue pendiente).
- **Sorteos:** `src/components/raffles/raffles-view.tsx` + `src/lib/raffles/status.ts` (estado por fecha real y finalizados agrupados desde `raffle_winners`). Chances: `getUserRaffleChances` (D029), compartido por la página, el registro de ganadores y `src/lib/stampy/tool-contexts/raffles-context.ts` (que ahora lee `referrals.referrer_user_id`). No se tocó la selección de ganadores.
- **Librería STL:** portadas de grupo en 4:3 (`StlGroupCard`).

## 21. Feature flags — lanzamiento progresivo (2026-10-24)

Rama `feature/universo-stampa-feature-flags`. Ver D030. Controla la **disponibilidad pública** de cada herramienta sin deploy; no quita funcionalidades ni toca datos.

- **Registro único:** `src/lib/features/registry.ts` (`FEATURE_REGISTRY`, 12 funcionalidades: `academia`, `stampy`, `calculadora`, `stampa_maker`, `sorteos`, `libreria_stl`, `explorar_modelos`, `mi_taller`, `mi_negocio`, `tienda_online`, `redes`, `canales`). Cada una define id estable (clave persistida), nombre, descripción, grupo, prefijos de páginas (`routes`), de API (`apiRoutes`), `defaultEnabled` (todas `true`) y nota para el panel. `findFeatureForPath(path)` resuelve la dueña de cualquier ruta (prefijo más largo; query/hash ignorados; URLs absolutas → `null`). `FEATURE_PROTECTED_ROUTES` (login, registro, recuperación, perfil, configuración, onboarding, `/sin-acceso`, `/no-disponible`, pagos de membresía, `/admin`, webhooks/callback de Mercado Pago, `/api/business/orders`) nunca pertenece a una funcionalidad.
- **Persistencia:** tabla `platform_feature_flags (feature_id pk, enabled, updated_by, updated_at)` — migration `20261024120000_platform_feature_flags.sql` (**no aplicada en remoto**). Lectura `anon`+`authenticated`; escritura solo `is_admin(auth.uid())` (RLS insert/update, sin delete); trigger que fija `updated_by/updated_at` desde la sesión. **No siembra filas.** Sin fila = "sin configurar" → rige `defaultEnabled` (acceso actual preservado); fila `enabled=false` = deshabilitada explícitamente.
- **Resolución:** `resolve.ts` (puro): `resolveFeatureAccess(snapshot, id, { isAdmin })`. El bypass de admin (`capabilities.accessAdmin`, es decir `profiles.role`) aplica **solo** a flags; membresía, ownership y RLS siguen intactos. `loader.ts`: una consulta (`select feature_id, enabled`), cache de 5 s por runtime, último estado conocido. Tabla inexistente (42P01/PGRST205) → `uninitialized` (no restringe). Otro error → `stale` (último estado) o `unavailable` (falla cerrada para no-admin).
- **Capas que validan** (la ocultación visual no protege):
  - Páginas: `src/utils/supabase/middleware.ts` (proxy). Orden: login → admin → **flag** → plan (`/sin-acceso`). Redirige a `/no-disponible?herramienta=<id>` (el nombre sale del registro, nunca del texto de la URL). Aplica también a rutas públicas controladas (`/calculadora`, `/explorar-modelos`, `/tienda`).
  - Server Actions: `authorizeBusinessAccess` (Mi Negocio, 34 acciones), `productos/actions` (Mi Taller), `jarros/actions` (Stampa Maker), `askStampyAction`, feedback/ajustes de Stampy y confirmaciones de `action-requests` (Stampy + Mi Taller).
  - API routes: `featureGuardResponse` (403 `feature_unavailable`) en `/api/stl/*`, `/api/model-search`, `/api/calculator/*`, `/api/business/mercadopago/{connect,disconnect}` y el checkout de la tienda pública. **No se gatean** webhooks, callbacks, `orders/expire` ni `/api/mercadopago/*` (cortarían pagos en curso).
  - UI: `FeatureVisibilityProvider` (`MainLayout`) vuelve a leer el estado en cada navegación; sidebar, barra inferior, menú radial (`getRadialArcAngles` para cualquier cantidad), accesos rápidos y paneles de Inicio, buscador global (`filterGlobalSearchItems`), pestañas de Configuración, lanzador de Stampy, chat de clases y enlaces contextuales (`FeatureLink`) filtran por ruta; los grupos vacíos desaparecen. Mientras no cargaron flags/acceso, lo controlado se oculta.
  - Stampy: `src/lib/stampy/feature-gate.ts` (`loadStampyFeatureGate`) filtra herramientas recomendadas, contratos y acciones por ruta, no ejecuta herramientas de Mi Taller/Mi Negocio/Academia deshabilitadas y añade al turno una nota "herramientas todavía no disponibles". Sigue respondiendo preguntas generales.
- **Límite conocido:** lecturas/escrituras que el navegador hace directo contra Supabase (RLS) no pasan por el proxy ni por las acciones; seguirán protegidas por membresía/ownership/RLS pero no por la flag. La flag controla páginas, acciones y APIs del servidor. Llevarla a RLS exigiría una decisión aparte.
- **Admin:** `/admin/funcionalidades` (`FeatureFlagsManager` + `actions.ts` con `requireAdmin` server-side, validación contra el registro y confirmación al deshabilitar).
- **PWA:** no hay service worker (solo manifest sin shortcuts): no hay caché de navegación que invalidar; el cambio se ve en la siguiente navegación (TTL ≤ 5 s por instancia).
- **Agregar una funcionalidad:** sumar id a `FEATURE_IDS` + entrada en `FEATURE_REGISTRY` (rutas), usar `featureGuardResponse`/`isFeatureAvailable` en sus handlers y, si tiene entrada de navegación, nada más (el filtrado es por ruta). No requiere migration.

### 21.1 Cobertura de escrituras directas del navegador (estabilización, 2026-10-26)

Las páginas están bloqueadas por el proxy, pero estas operaciones se ejecutan desde el navegador con la sesión del usuario (`utils/supabase/client`) y **no pasan por el servidor**: la flag no las impide si alguien las invoca a mano. Siguen protegidas por RLS, `has_platform_access` y propiedad (`user_id`). Riesgo = impacto de que la herramienta siga operando con la flag apagada.

| Herramienta | Operaciones directas | Riesgo |
| --- | --- | --- |
| Mi Taller | RPC `adjust_product_stock`, `adjust_component_stock`, `adjust_filament_stock`, `assemble_product_from_components`, `record_production_with_xp`; `products`, `product_components`, `product_component_filaments`, `filaments` (insert/update/delete) | **Alto** (mueve stock/XP) |
| Mi Negocio | `/presupuestos`: `budgets`, `budget_items`, `clients`, `products` (insert/update/delete). Ventas, catálogo, pedidos, clientes: solo vía Server Actions (protegidas) | Medio (presupuestos) |
| Stampa Maker | `useMugProjects`, `useNeonProjects`, `useMakerLibrary`: tablas de proyectos + Storage del propio usuario | Bajo (datos propios, sin efecto en otros) |
| Academia | `lesson_progress` (insert/update) | Bajo |
| Calculadora | `calculator_settings`, `calculator_product_types` (`product-types-manager`), RPC `record_calculator_xp`, `ensure_default_calculator_product_types` | Bajo (configuración propia; XP con topes en servidor) |
| Librería STL | `stl_downloads` (upsert; registro de descarga). La descarga y el visor pasan por `/api/stl/*` (protegidas) | Bajo |
| Tutoriales | `tool_tutorials` (solo lectura: interruptor y video opcional), `user_tool_tutorial_views` (upsert de la propia fila) | Bajo |
| Configuración | `printers`, `filaments`, `business`, `settings` | Esencial y **compartida** (Calculadora, Mi Taller, Stampy): no se condiciona a una flag |

**No se protegieron** por flag: el navegador no es una frontera de confianza, así que un chequeo en el cliente no aporta seguridad, y moverlas al servidor sería una refactorización masiva fuera de alcance. Para cerrarlas de verdad hace falta SQL nuevo y revisado, **no aplicado**:

1. Helper `public.platform_feature_enabled(p_feature text) returns boolean` (`stable`, `security definer`, `search_path` fijo): `true` si no hay fila (default habilitada) o `enabled`; `true` para `is_admin(auth.uid())`.
2. Mi Taller (prioridad): agregar el chequeo al inicio de cada RPC de stock/producción. Las `adjust_*` y `assemble_product_from_components` **no están versionadas** en `supabase/migrations`: primero hay que volcar su definición remota. `record_production_with_xp` y `record_calculator_xp` sí están versionadas.
3. Tablas: policies `AS RESTRICTIVE` por herramienta solo donde la tabla no sea compartida. `products`, `filaments`, `printers` y `clients` son compartidas entre Calculadora, Mi Taller, Mi Negocio y Stampy (restringirlas por Mi Taller rompería "guardar como producto" y el catálogo comercial); `budgets`/`budget_items` sí serían exclusivas de Mi Negocio. El `CREATE TABLE` y el RLS base de estas tablas tampoco están versionados (RIESGO-03 de QA_REPORT).
4. Revisar `has_platform_access()` (definición remota desconocida) y probar con cuentas Free/Paid/Admin en un Supabase de test antes de aplicar.

Stampy: `createStampyActionRequest` y `fetchStampyPageContext` ahora validan la flag (Stampy + herramienta destino). `markStampyActionRequestOpened` y `cancelStampyActionRequest` **no** se gatean a propósito: solo cambian el estado de una solicitud propia pendiente y no ejecutan nada; gatear la cancelación dejaría tarjetas sin poder descartarse.

## 22. Visibilidad de cursos (2026-10-26)

- **Modelo:** reutiliza `courses.status` (sin columnas nuevas). Valores canónicos `published | coming_soon | hidden`; los históricos `draft`/`archived`, vacíos o desconocidos se leen siempre como `hidden` (`src/lib/academy/visibility.ts`, `normalizeCourseVisibility`). Nada se publica por error. Aplica igual a cursos y talleres (`course_kind`).
- **Reglas** (`resolveCourseAccess`): publicado = entra y registra progreso; en preparación = visible en el catálogo, sin acceso a clases ni progreso; oculto = inexistente para alumnos. Administradores (`profiles.role`) conservan acceso completo (`adminPreview`). Se SUMAN a Academia (feature flag) y a membresía (`authenticated != paid`).
- **Servidor:** `/cursos/[id]/page.tsx` es ahora una página de servidor que usa `loadCourseGate` (`src/lib/academy/access.ts`: feature flag → membresía → visibilidad) y recién entonces monta `course-detail-client.tsx`; en preparación renderiza `CourseComingSoonScreen` (sin datos de clases) y oculto responde 404. El progreso pasa por `setLessonProgressAction` (`src/app/cursos/actions.ts`, usa `loadLessonGate`); el contexto de clase de Stampy se descarta si la clase no es de un curso publicado. El cambio de visibilidad es `updateCourseVisibilityAction` (solo admin, solo escribe `status`, revalida `/admin/cursos`, `/cursos` (layout), `/talleres`, `/academia`, `/`).
- **Base (migration `20261026120000_academy_course_visibility.sql`, no aplicada):** CHECK ampliado `NOT VALID` (o `ALTER TYPE ... ADD VALUE` si fuese enum), helpers `academy_*_is_open` (SECURITY DEFINER), policies **RESTRICTIVE** de SELECT en `courses`, `course_modules`, `lessons`, `lesson_resources`, `lesson_transcripts(+segments)`, `stampy_knowledge_chunks`; INSERT/UPDATE/DELETE restrictivas en `lesson_progress` (SELECT intacto: se conserva el historial); única policy permissive nueva: ficha de cursos `coming_soon` para usuarios con acceso; trigger que impide a no-admins cambiar `status`; `match_stampy_knowledge_chunks` excluye chunks de cursos no publicados. Las policies existentes no se tocan (el schema base de Academia no está versionado).
- **Catálogo:** `/cursos`, `/talleres` y `/academia` piden `published` + `coming_soon` y separan con `splitCatalogCourses`; los «en preparación» van solo en la sección «Próximamente» (`ComingSoonSection`, tarjeta no enlazable). Rutas recomendadas, buscador, «continuar aprendiendo», recomendaciones y el indexador de Stampy solo usan `published`.
- **Inscripciones:** no existe una tabla de inscripciones; el único registro de avance es `lesson_progress`, que ninguna acción de visibilidad borra ni modifica.

## 22. Códigos de descuento en el checkout de la membresía (2026-10-29)

Migration `20261029120000_discount_code_checkout.sql` (NO aplicada en remoto; aplicar después de `checkout_attempts` y de las de Beta). Diagnóstico read-only: `supabase/diagnostics/20261029_discount_codes_state.sql`. Deploy: `docs/DEPLOY_DISCOUNT_CODES.md`.

- **Interruptor:** `DISCOUNT_CODES_ENABLED=true` (variable de servidor, default apagado). Apagado: la pantalla Sin acceso no muestra el campo y `create-subscription` rechaza cualquier `discount_code` con 409 `discount_codes_disabled` (nunca lo ignora ni cobra el precio normal por error). Sin `discount_code` el checkout es el de siempre, byte a byte.
- **Una sola regla de precio, en la base:** `discount_code_final_amount(code_type, value, base)` (porcentaje con `0 < v < 100`, monto fijo, precio fijo; 2 decimales; un resultado `<= 0` o `>= base` no es descuento). La app nunca calcula un precio con descuento: el cliente solo envía el TEXTO del código (+ la clave de idempotencia); el precio de lista sale de `membership_settings` (`src/lib/mercadopago/membership-price.ts`).
- **Reserva → confirmación:** `reserve_discount_code(user, code, base, currency, dry_run, ttl)` (solo `service_role`; identidad = la sesión leída en el servidor) valida, calcula y reserva atómicamente (lock advisory por usuario + fila del código `FOR UPDATE`). `attach_discount_reservation` verifica en la base que el intento de checkout lleva exactamente el monto reservado. El uso se **consume** (`confirm_discount_reservation` → `invite_code_redemptions` + `used_count`) cuando Mercado Pago informa `authorized` (webhook y `sync-subscription`, idempotente y no bloqueante); se **libera** al cancelarse antes de autorizar, al fallar el checkout o al reemplazarlo. Los asientos se cuentan según §22.1.
- **Solo duración `forever`:** Mercado Pago tiene un único monto recurrente; `once` ("primer mes") responde `unsupported` y el panel no permite guardarlo. Cada renovación se cobra al monto con descuento; cambiar después el precio base no altera suscripciones existentes.
- **Checkout pendiente con otro monto (§22.2):** un checkout `completed` cuya suscripción sigue `pending` (nunca autorizada) se reemplaza cuando el monto que corresponde a esta compra es otro: el usuario aplica un código y tenía uno sin descuento, **o quita el código y tenía uno con descuento**, o cambia de código. Se cancela la preapproval en Mercado Pago (`PUT /preapproval/{id}`, `MercadoPagoPreapprovalClient.cancel`) **antes** de `close_pending_checkout` y recién entonces se crea el intento nuevo con clave nueva. Si Mercado Pago no confirma la cancelación no se cambia nada. Nunca se toca una suscripción `authorized`/`active`/`paused` ni un intento en `creating`/`reconciliation_required`.
- **Reintentos:** la clave de idempotencia del navegador va atada al código (aplicar, cambiar o quitar un código = intento nuevo; reintentar el mismo = mismo intento). Si el descuento no se pudo registrar tras crear el checkout, responde 503 `discount_persistence_pending` y el reintento reutiliza checkout y reserva.
- **Seguridad:** tablas `discount_code_reservations` y `discount_code_failed_attempts` con RLS y sin acceso de `anon`/`authenticated`; todas las funciones ejecutables solo por `service_role`; límite de 8 intentos inválidos / 15 min por usuario (también en la vista previa); los códigos Beta / acceso gratis responden `invalid` (no revelan que existen). No acumula con precio fundador (hoy inactivo).
- **Código:** `src/lib/discounts/{discount-codes,repository}.ts`, `src/lib/mercadopago/{discount-checkout,membership-price}.ts`, `create-subscription/route.ts`, `sin-acceso/actions.ts` (`previewDiscountCodeAction`, dry run), `DiscountCodeField`.
- **Tests:** `tests/discount-codes-db.test.mjs` (opt-in, Postgres real: precios, límites, carrera de 12 compradores, TTL, confirmación idempotente, reemplazo, permisos) y `tests/discount-checkout.test.mjs` (orquestación con fakes + guards estáticos).

### 22.1 Asientos, reservas vencidas y notificaciones tardías (2026-10-30, D034)

Migration `20261030120000_discount_checkout_consistency.sql` (no aplicada en remoto; requiere la de 22; no edita la anterior).

- **Hallazgo:** una reserva con la preapproval ya creada vencía por reloj (30 min) como una sin checkout. El asiento pasaba a otro comprador y, si el primero autorizaba tarde, `confirm_discount_reservation` lo honraba igual → se superaba `max_uses`. Hay un test de control que lo reproduce con la migration anterior sola.
- **Invariante (`discount_reservation_holds_seat`, definición única):** una reserva *sin* intento de checkout retiene el asiento hasta `expires_at` (nada existe en Mercado Pago, soltarla es seguro); una reserva *con* intento abierto (`creating`/`reconciliation_required`/`completed`) retiene el asiento mientras ese intento siga abierto, **sin importar el reloj**. Se libera solo cuando la suscripción se autoriza (queda consumida), se cancela en Mercado Pago, el usuario la reemplaza o el intento se cierra. Capacidad = `max(used_count, redemptions reales) + asientos retenidos`.
- **Notificaciones tardías y reintentos:** `confirm_discount_reservation` bloquea la fila del código (mismo orden que `reserve`), es idempotente (10 notificaciones simultáneas = un uso) y devuelve `confirmed`, `already_confirmed`, `confirmed_over_limit` o `none`. Una cancelación posterior nunca libera un uso confirmado.
- **Caso anormal (reserva ya liberada a mano / intento cerrado / fila vieja):** si el asiento sigue libre se confirma normal; si el código ya está lleno **no se rechaza ni se cancela al pagador**: se registra con `over_limit = true`, el contador refleja la realidad, el código queda cerrado para los demás y el webhook deja un `console.warn`. Es la única forma de superar el límite y solo por un pago que ya ocurrió (decisión comercial: ver `docs/DEPLOY_DISCOUNT_CODES.md`).
- **Costo:** un checkout abandonado cuyo link ya se creó retiene su asiento hasta que el usuario vuelva (y lo reemplace o complete) o se cancele en Mercado Pago. No hay recuperación automática: cancelar una preapproval ajena desde un proceso podría cancelar a quien está pagando en ese instante.

### 22.2 Checkout siempre coherente con el precio confirmado (2026-10-30)

`executePlainCheckout` / `executeDiscountedCheckout` (`src/lib/mercadopago/discount-checkout.ts`). La base devuelve el único intento abierto del usuario sea cual sea la clave de idempotencia; si ese intento lleva otro monto que el de esta compra se reemplaza (ver arriba) y el resultado se **verifica** (`describe_open_checkout`) antes de devolver el link. Sin el descuento deployado en la base (RPC inexistente) el checkout sin código se comporta exactamente como antes. Cambio de comportamiento para todos los usuarios: un checkout pendiente con un precio de lista viejo (el admin cambió `membership_settings`) también se reemplaza. Doble click / reintentos: una sola preapproval viva, mismo link, una sola cancelación.


## 23. Temas claro / oscuro (2026-10-29)

Sistema global de apariencia: **Claro**, **Oscuro** (aspecto original) y **Automático** (sigue el sistema operativo en vivo). Decisión y alternativas en D035.

**Cómo funciona**

- `src/lib/theme/theme.ts`: constantes, resolución y persistencia. La preferencia (`light` | `dark` | `system`) vive en `localStorage["stampa-theme"]`; el tema resuelto se publica como `data-theme="light|dark"` (y `color-scheme`) en `<html>`. `DEFAULT_THEME_PREFERENCE = "system"` (sin elección previa se sigue la apariencia del dispositivo: SO oscuro = aspecto original, SO claro = modo claro). Landing, tienda pública y viewers 3D siguen oscuros.
- `THEME_INIT_SCRIPT` se inyecta inline en `<head>` del layout raíz (renderizado en el servidor, bloqueante): fija el tema **antes del primer render**, sin parpadeo ni dependencia de cookies (no vuelve dinámico el layout). `<html>` lleva `suppressHydrationWarning` porque el script modifica atributos antes de hidratar.
- `src/components/theme/theme-provider.tsx`: `ThemeProvider` + `useTheme()` (`preference`, `resolvedTheme`, `setPreference`) sobre `useSyncExternalStore` (sincroniza pestañas por `storage` y el SO por `matchMedia`).
- `src/components/theme/theme-switcher.tsx`: `ThemeMenu` (botón en header desktop y móvil) y `ThemeSwitcher` (Configuración → Cuenta → Apariencia).

**Tokens y paletas (CSS)**

- `src/app/globals.css`: variables semánticas `--stampa-*` para oscuro (`:root`) y claro (`:root[data-theme="light"]`), expuestas a Tailwind (`bg-stampa-surface`, `border-stampa-border`, `text-stampa-text`…). Nuevos: `fg` (tinta de primer plano: blanco en oscuro, tinta cálida en claro), `shade` (sombreado translúcido), `stampa-accent` (naranja para **texto/iconos**; en claro se oscurece para contraste), `stampa-raised`/`stampa-deep`/`stampa-sunken`/`stampa-body`.
- `src/app/theme-palette.css` (**generado** con `node scripts/generate-theme-css.mjs`, volver a correrlo si se agregan clases `text-{color}-100/500`): en claro espeja las escalas neutras de Tailwind (gray/zinc/neutral/slate/stone 50–900; **950 no se toca**: es la tinta fija de los botones naranjas) y oscurece los tonos 200–400 de los colores cromáticos. El modo oscuro no redefine nada: usa los valores por defecto de Tailwind, por lo que es equivalente al diseño anterior por construcción.
- Sin filtros ni inversiones globales de color.

**Convenciones para código nuevo (y futuros tutoriales)**

- Texto/superficies/bordes neutros: tokens (`text-fg`, `bg-fg/5`, `border-fg/10`, `bg-stampa-surface`, `text-stampa-text-muted`, `bg-shade/20`). **No** usar `text-white`/`bg-white/N`/`bg-black/N` para neutros: el blanco/negro literal queda reservado para texto sobre fondos saturados (botón naranja, badges de color, overlays sobre imagen).
- Naranja: `bg-stampa-orange`/bordes/anillos son marca y no cambian; para texto o iconos usar `text-stampa-accent`.
- No usar hex ni `rgba()` arbitrarios para superficies de UI.
- Zonas que deben verse oscuras en ambos temas (viewers 3D, landing de marketing, tienda pública): envolver con la clase **`theme-force-dark`** (redefine los tokens para ese subárbol). `theme-force-light` hace lo inverso. Los tutoriales gráficos (§24) usan solo tokens.
- Excepciones documentadas: PDF de presupuestos y ticket de venta (papel, no dependen del tema).


## 24. Tutoriales gráficos y video (2026-10-29)

Sistema único de ayuda por sección. Guía completa en `docs/TUTORIALS.md`; decisión en D036.

- **Contenido como dato:** `src/lib/tutorials/definitions/*.ts` (un `TutorialDefinition` por sección: id, título, descripción, `version`, 3–5 pasos con ilustración declarativa y `video?` opcional). `registry.ts` lista los tutoriales y mapea rutas → id (`TUTORIAL_ROUTES`, `resolveTutorialId`). Agregar un tutorial no requiere tocar componentes.
- **UI única:** `GlobalToolTutorial` (montado en `main-layout` solo con `accessPlatform`, igual que antes) → `TutorialModal` (`Dialog` compartido) → `TutorialPanel` + `TutorialIllustration`. Reemplaza el modal video-only y el componente `ToolTutorial` (sin usos), eliminado.
- **Persistencia:** `user_tool_tutorial_views` sigue siendo la fuente de verdad, con `seen_version` (migration `20261031090000`, no aplicada en remoto; las filas existentes valen versión 1, nadie ve de nuevo lo que ya cerró). Espejo `localStorage` por `userId` como respaldo. Sin la migration el código reintenta sin la columna.
- **`tool_tutorials`** deja de ser fuente del contenido: solo aporta `is_active = false` (apagar un tutorial sin deploy) y un `video_url` si el tutorial no define uno en el código. Los textos de esa tabla ya no se usan.
- **Video:** `resolveTutorialVideo` (solo `https`; YouTube vía `youtube-nocookie`, Bunny, o enlace externo). El `iframe` se monta recién al elegir "Ver video", sin autoplay; sin video no se muestra nada de video.
- **Tests:** `tests/tutorials.test.mjs`.
