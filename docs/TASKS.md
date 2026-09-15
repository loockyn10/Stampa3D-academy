# TASKS

Este archivo contiene únicamente trabajo pendiente o próximo. Eliminar tareas terminadas en lugar de conservar un historial infinito.

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
