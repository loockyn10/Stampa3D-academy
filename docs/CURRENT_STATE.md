# CURRENT_STATE

> Auditoría completa contra el repo ejecutada el 2026-09-15 (Claude Code). Lo marcado como “Verificado” fue comprobado leyendo código/migrations/tests reales. Lo marcado `REQUIERE VERIFICACIÓN EN SUPABASE REMOTO` no puede confirmarse desde el repo local (aplicación real de migrations, logs de Postgres, valores de env en producción).

## 1. Estado general

Stampa es una aplicación activa con múltiples módulos ya desarrollados en distintos grados, mayormente más completos de lo que la documentación previa asumía (ver hallazgos abajo — varios puntos marcados “diseñado pero no confirmado” están en realidad implementados).

**Build/tests verificados (2026-09-15):**
- `npx tsc --noEmit` → limpio.
- `npm run build` → exitoso (todas las rutas compilan, ver lista completa de rutas en §2 stack).
- `git diff --check` → sin errores.
- `node --test tests/*.test.mjs` (48 archivos, no cableados a `package.json`) → 474 tests, **473 pasan, 1 falla**: `tests/stampy-product-stock-tools.test.mjs` falla con `Unexpected dependency: @/lib/filaments/utils` (el mock del test no contempla esa dependencia). Es exactamente el fallo ya documentado históricamente — sigue sin resolverse, no es nuevo.

## 2. Estado verificado por dominio

### Base de plataforma — Verificado

Next.js 16 (App Router)/TypeScript/Tailwind 4/Supabase confirmados. Autenticación + `access-policy.ts`/`user-access.ts` confirmados como fuente de verdad de permisos, gateado en middleware (`src/proxy.ts` + `src/utils/supabase/middleware.ts`, default-deny). Nav desktop (`sidebar.tsx`) y mobile (`mobile-bottom-navigation.tsx`, `mobile-header.tsx`, `mobile-radial-menu.tsx`) confirmadas, distintas entre sí. **PWA: parcial** — existe `manifest.webmanifest` (vía `src/app/manifest.ts`) pero no hay service worker; no es instalable/offline en el sentido completo de un PWA.

### Academia — no auditado en profundidad en esta pasada

Rutas confirmadas (`/academia`, `/cursos`, `/talleres`), contenido interno no revisado en detalle — fuera del foco de riesgo de esta auditoría (acceso/RLS/pricing/ventas). **REQUIERE revisión dedicada si se prioriza.**

### Mi Taller — Verificado

Impresoras/filamentos físicos, catálogos, productos/recetas/componentes, inventario, producción confirmados con nombres reales de tabla (ver `ARCHITECTURE.md` §6). "Una bobina = una card" confirmado. "Registrar producción" vs "Ajustar inventario" confirmados como paths distintos. **Hallazgo nuevo:** riesgo real de doble conteo de material si se agrega a un mismo lote de producción un producto completo y, por separado, uno de sus propios componentes — ni la UI ni la RPC de consumo deduplican ese caso (`src/app/stock/page.tsx`, RPC `consume_filaments_for_production_targets`). No corregido (fuera de alcance de esta auditoría).

### Mi Negocio — Verificado, más completo de lo documentado

Catálogo (fabricado/reventa con constraint SQL de consistencia, borrado = archive/soft-delete real, no hard delete), Venta rápida, Ventas, Reposición (con edición masiva de costos y conversión a kg por peso real de bobina), Showroom/Depósito (split Showroom→Depósito **funciona correctamente**, probado contra el caso showroom=2/depósito=10/venta=5 → resultado showroom=0/depósito=7, igual al documentado), anulación de ventas (void real, idempotente, excluye ventas con pago online, excluida de métricas), métricas (facturación/ticket promedio/unidades/kg/top productos/comparación de período, todas excluyendo ventas anuladas) — todos confirmados implementados y funcionando según el código. Presupuestos y Mi Tienda no auditados en profundidad esta vez.

**Agregado 2026-09-18 — Clientes / cuenta corriente / pagos / ticket (implementado en código, migration `20260918120000_business_customer_accounts.sql` no aplicada aún en remoto — ver TASKS.md):** `Mi Negocio → Clientes` es un destino propio (listado con búsqueda, ficha con historial y cuenta corriente, registrar cobro). Ledger `customer_account_movements` + allocations `business_sale_payment_allocations` nuevos. `confirm_business_sale`/`confirm_business_showroom_sale` extendidas con `p_payments` (compat con `null`). `void_business_sale` revierte deuda con `sale_reversal`. Venta rápida tiene selector de cliente con `Combobox` reutilizable (antes `<select>` nativo) + alta rápida de cliente + selector de método de pago con split a cuenta corriente. Ticket imprimible en `/mi-negocio/ticket/[saleId]`. Métricas ganan `cashReceived`/`transferReceived`/`newCredit`/`debtCollections`/`outstandingReceivables`. Ver `docs/ARCHITECTURE.md` §6/§9 y `docs/DECISIONS.md` D020 para el detalle completo.


**Agregado 2026-09-21 — Explorar Modelos (implementado en código, sin credenciales configuradas):** módulo `src/lib/model-search/`, `GET /api/model-search`, página pública `/explorar-modelos`, providers MyMiniFactory y Thingiverse (ambos `disabled` sin `MYMINIFACTORY_API_KEY` / `THINGIVERSE_ACCESS_TOKEN`), nav desktop (sidebar Plataforma + grupo Gratis) y enlace desde la Calculadora. Tests: `tests/model-search.test.mjs` (41, con providers mockeados). **No verificado contra las APIs reales** (no hay credenciales en el repo): los campos de MyMiniFactory se tomaron del OpenAPI oficial y los de Thingiverse de su Swagger; la primera búsqueda real puede exponer diferencias (p. ej. dominios de CDN de thumbnails fuera del allowlist, que quedan como `null`). Ver `ARCHITECTURE.md` §18 y `DECISIONS.md` D021/D022.

### Calculadora pública / Free — Verificado

Un único motor de cálculo (`src/lib/calculator/pricing.ts`) sirve Anonymous/Free/Paid desde una sola página. Demo Anonymous vía env vars (`STAMPA_DEMO_PRINTER_TEMPLATE_ID`/`STAMPA_DEMO_FILAMENT_TEMPLATE_ID`). CTA de registro confirmado al intentar personalizar sin login. Las 3 tablas Free (`calculator_user_preferences`, `calculator_user_printer_templates`, `calculator_user_filament_templates`) y la migration `20260912034506_calculator_free_template_selections.sql` existen en el repo y su contenido coincide con lo documentado — guardan solo referencias, no crean stock físico. **Aplicación real en Supabase remoto REQUIERE VERIFICACIÓN EN SUPABASE REMOTO.**

### Stampy — Verificado

13 tools inventariadas (`src/lib/stampy/tool-registry.ts`); solo 5 ejecutables desde el chat, el resto son contratos informativos que el modelo no puede ejecutar. El único tool de escritura ejecutable (`products.recalculate`) re-valida auth/ownership de forma independiente en su propio server action — confirma "contexto ≠ autorización". Sanitización de contexto con límites duros confirmada.

### XP — Verificado, con caveat de despliegue

Ledger (`user_xp_events`) + summary + `award_user_xp` (SECURITY DEFINER, server-authoritative) + caps diarios/de por vida + idempotencia (unique `event_key` + advisory lock) confirmados en `20260909145259_xp_progression_foundation.sql`. El bug histórico `column movement.type does not exist` está mitigado **dentro de la misma migration** (usa `coalesce` sobre `'movement_type'`/`'type'` vía `to_jsonb`), no requirió una migration de fix separada — y no existe ninguna. **Si esta migration fue aplicada limpiamente en el Supabase remoto REQUIERE VERIFICACIÓN EN SUPABASE REMOTO** (el registro histórico de un error de aplicación no tiene evidencia en el repo de haberse resuelto en producción).

### E-commerce — Verificado

Tablas de payment accounts, OAuth state, orders/items, reservas, pagos y webhook events confirmadas (`20260908014943_business_ecommerce_base.sql`). Orders y sales confirmadas como entidades distintas. Aislamiento por seller, OAuth de Mercado Pago, doble idempotencia de webhooks (por evento y por pago) y comisión configurable por env, todos confirmados. No se encontró rastro de un deadlock histórico (`40P01`) en migrations/commits del área — el código actual usa locking proactivo (`lock_timeout`, locks ordenados, advisory locks). **Si el deadlock ocurrió alguna vez y cómo se resolvió REQUIERE VERIFICACIÓN EN SUPABASE REMOTO** (logs de Postgres no accesibles desde el repo).

## 3. Puntos de riesgo / bugs históricos — estado verificado

### Venta rápida: Showroom + Depósito — RESUELTO en código

El código actual (`confirm_business_showroom_sale`, `20260910140721_fix_business_sale_location_movements.sql`) consume stock total (showroom + depósito), Showroom primero. No se encontró ningún path que limite la venta solo por Showroom. **Prueba funcional en ambiente real sigue pendiente** (el repo confirma la lógica, no el comportamiento en producción).

### Anulación de ventas — RESUELTO en código, deuda de schema pendiente

`void_business_sale` vigente ya no referencia `location_breakdown` (usa `location_id`). La columna `location_breakdown` sigue existiendo en el schema (nunca se hizo `DROP COLUMN`) pero está huérfana — no debería producir el error histórico con el código actual. **REQUIERE VERIFICACIÓN EN SUPABASE REMOTO** que la migration esté aplicada y no queden funciones viejas remotas usando la columna.

### XP y movimientos — mitigado en la propia migration de fundación

`20260909145259_xp_progression_foundation.sql` ya maneja `movement.type`/`movement_type` de forma defensiva vía `coalesce` sobre `to_jsonb(movement)`. No hay evidencia de doble-XP (idempotencia por `event_key` único + advisory lock). **Si la migration fue aplicada limpiamente en remoto sigue REQUIRIENDO VERIFICACIÓN EN SUPABASE REMOTO.**

### Calculadora Free — Verificado en código

Anonymous no puede personalizar (CTA de registro confirmado). Free guarda solo referencias a templates, sin crear stock físico (confirmado, `POST /api/calculator/selections`). Paid sigue usando entidades físicas. Free no accede a rutas premium (middleware default-deny confirmado). **Aplicación de migrations/RLS en remoto sigue REQUIRIENDO VERIFICACIÓN EN SUPABASE REMOTO.**

### Test preexistente de Stampy — CONFIRMADO, sigue fallando

`tests/stampy-product-stock-tools.test.mjs` sigue fallando hoy con `Unexpected dependency: @/lib/filaments/utils` (mock incompleto). 473/474 tests pasan. No se corrigió (fuera de alcance de esta auditoría — es responsabilidad de una tarea de implementación, no de esta auditoría documental).

## 4. Ítems que estaban "diseñados pero no confirmados" — ahora verificados

### Ingreso de stock por scanner — IMPLEMENTADO

Confirmado en código: modo de ingreso (`StockReceiptDialog.tsx`), barcode tipo "case", `unitsPerScan`, cola de `pending` scans, confirmación atómica e idempotente vía RPC `confirm_business_stock_receipt` (`operationKey`). Prioridad de handlers de scanner coincide con lo documentado (stock intake > captura de barcode en catálogo > Venta rápida/Catálogo > fallback global a Venta rápida).

### Métricas semanales — IMPLEMENTADO

`get_business_metrics` (`20260910053553_business_polish.sql`) calcula facturación, cantidad de ventas, ticket promedio, unidades, kg (con peso real configurable por producto, no asume 1kg), top 5 productos y comparación contra período anterior, excluyendo ventas anuladas.

### Sistema de ayuda/onboarding global — no auditado en esta pasada

Fuera del foco de riesgo de esta auditoría (no es un tema de seguridad/consistencia de datos). Estado: **no verificado, pendiente si se prioriza**.

## 5. Deuda técnica conocida (verificada 2026-09-15)

- **Schema base pre-historial:** `has_platform_access()`, `is_admin()` y las tablas core (`products`, `filaments`, `printers`, `profiles`, `user_access_grants`) no tienen `CREATE`/definición en las 30 migrations presentes en el repo — deben venir de una migration base no versionada aquí o aplicada directo en remoto. Riesgo de schema drift real, no solo teórico.
- **RLS MEDIO:** `product_components`/`product_component_filaments` permiten SELECT/UPDATE solo por ownership, sin `has_platform_access` — un usuario Free/degradado podría leer o modificar recetas de Mi Taller vía REST directo aunque las RPCs normales sí validen acceso pago. No corregido (fuera de alcance).
- **Doble conteo de material:** en Mi Taller, agregar a un mismo lote de producción un producto y uno de sus propios componentes no se deduplica — riesgo real de consumo duplicado de filamento. No corregido (fuera de alcance).
- **`location_breakdown` huérfana:** columna jsonb sin usar desde `20260910140721`, nunca eliminada — limpiar en una migration futura si se decide.
- **Resend:** listado en el stack histórico pero sin ninguna referencia en código (`process.env.RESEND*` no aparece) — o se retiró sin actualizar docs, o nunca se integró. Confirmar con el equipo.
- **PWA parcial:** manifest existe, no hay service worker — no instalable/offline en el sentido completo.
- **Test suite no cableada:** 48 archivos de test en `tests/*.test.mjs` (node:test) no están en `package.json` scripts — se ejecutan manualmente. Considerar agregar un script `test`.
- Documentación histórica dispersa; esta migración documental busca eliminar esa dependencia.

## 6. Qué NO debe afirmarse sin verificar

No asumir desde esta documentación:

- que una migration fue aplicada remotamente;
- que una feature “reportada” sigue funcionando;
- que un endpoint mantiene el mismo contrato;
- que los nombres de tablas/columnas no cambiaron;
- que la navegación actual coincide con la arquitectura objetivo;
- que los tests reportados anteriormente siguen verdes;
- que el working tree está limpio.

La primera tarea de cualquier agente que dependa de uno de estos puntos es inspeccionar el repositorio.
