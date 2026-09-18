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
- Testing: sin Jest/Vitest/Playwright. Existen 48 archivos en `tests/*.test.mjs` escritos con `node:test`, no cableados a `package.json` — se ejecutan manualmente con `node --test tests/*.test.mjs`. Ver `CURRENT_STATE.md` para resultado real de la corrida.

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
