# TASKS

Este archivo contiene únicamente trabajo pendiente o próximo. Eliminar tareas terminadas en lugar de conservar un historial infinito.

## Now — Explorar Modelos (implementado 2026-09-21, ver CURRENT_STATE.md y ARCHITECTURE.md §18)

- [ ] Crear API key de MyMiniFactory y cargar `MYMINIFACTORY_API_KEY` en el entorno; hacer una búsqueda real y verificar campos, licencias y dominios de thumbnails.
- [ ] Enviar mail a MyMiniFactory (uso en SaaS con plan pago, cache permitido, rate limits, costos) y al Developer Program de Thingiverse; no cargar `THINGIVERSE_ACCESS_TOKEN` en producción hasta tener respuesta.
- [ ] Decidir dónde vive un rate limiter compartido si el hosting es serverless (hoy es en memoria por instancia).
- [ ] Menú radial mobile (`mobile-radial-menu.tsx`): 7 ítems y solo 6 ángulos definidos (Configuración queda sin posición). Bug preexistente sin resolver; por eso Explorar Modelos no se agregó ahí.
- [ ] Con una API key real de MyMiniFactory: probar si `store=0` funciona en `/search` (figura como parámetro pero ningún endpoint lo referencia) y, si es confiable, activar `freeFilter`.
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

## Next

- [ ] Auditar Academia, Presupuestos y Mi Tienda en profundidad (no cubiertos en esta pasada, foco fue acceso/RLS/pricing/ventas).
- [ ] Revisar onboarding/ayuda contextual después de estabilizar acceso Free.
- [ ] Decidir si vale la pena implementar service worker para PWA instalable real (hoy solo hay manifest).

## Blocked / Needs Decision

- [ ] Activar beneficios de sorteos por nivel únicamente después de revisión legal/producto.
- [ ] Materializar automáticamente preferencias Free en inventario Paid: actualmente **NO**; cualquier cambio requiere decisión explícita.
