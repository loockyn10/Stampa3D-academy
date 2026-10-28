# Despliegue: códigos de descuento en el checkout

Rama: `feature/discount-codes-checkout` (cortada desde `main`, con el commit de los códigos Beta). **Nada de esto se ejecutó**: no hubo push, merge, deploy ni SQL remoto.

## 1. Qué cambia

| Pieza | Efecto |
|---|---|
| `20261029120000_discount_code_checkout.sql` | Crea `discount_code_reservations`, `discount_code_failed_attempts` y 8 funciones (solo `service_role`). No modifica filas de `invite_codes`, `checkout_attempts`, `subscriptions` ni `profiles`. |
| Código | `create-subscription` acepta un `discount_code` opcional; el webhook y `sync-subscription` consumen / liberan el uso; Sin acceso muestra "Tengo un código de descuento"; el panel solo permite "Para siempre". |
| `DISCOUNT_CODES_ENABLED` | **Apagado por defecto.** Con la migration aplicada y el código desplegado, nada cambia hasta ponerlo en `true`. |

## 2. Orden

1. Aplicar antes: las migrations de Beta (`20261005…` y `20261028…`) si todavía no lo están, y confirmar que `checkout_attempts` existe.
2. Backup / punto de restauración de Supabase.
3. Correr en el SQL Editor `supabase/diagnostics/20261029_discount_codes_state.sql` (solo lectura). Revisar `0_VERDICT` y la sección `A_columns` (la migration aborta sin cambios si falta una columna o `invite_codes.id` no es `uuid`).
4. Aplicar `supabase/migrations/20261029120000_discount_code_checkout.sql` y volver a correr el diagnóstico: `Discount checkout migration: applied` y `C_functions` con `authenticated_execute=false` en todas.
5. Desplegar el código. Con la migration sin aplicar y el interruptor apagado el checkout funciona como siempre. **No** activar el interruptor sin la migration: el checkout con código respondería 503.
6. Probar con **usuarios de prueba de Mercado Pago** (credenciales de prueba, nunca cobros reales) y recién entonces `DISCOUNT_CODES_ENABLED=true` en Vercel (redeploy).

## 3. Pruebas manuales (sandbox)

1. Crear en `/admin/codigos` un código porcentual «Para siempre» con límite de 1 uso.
2. Usuario Free A: Sin acceso → "Tengo un código de descuento" → aplicar → ver precio tachado y final → "Activar membresía": el link de Mercado Pago debe mostrar el monto con descuento.
3. Usuario Free B con el mismo código antes de que A pague: debe responder "límite de usos". Si A abandona y pasan 30 minutos, B puede usarlo.
4. A autoriza la suscripción: el uso queda consumido (`used_count` 1, una fila en `invite_code_redemptions`, reserva `confirmed`). Una segunda autorización/webhook no suma otro uso.
5. A cancela antes de autorizar: la reserva queda `released` y el uso vuelve a estar disponible.
6. Usuario con un checkout abierto SIN código que luego aplica uno: la preapproval vieja queda cancelada en Mercado Pago y el nuevo link lleva el monto con descuento. Verificar que no queden dos preapprovals vivas.
7. Código vencido, inactivo, inexistente, de "primer mes" y de acceso Beta: cada uno muestra su mensaje y no cambia el cobro.
8. Con `DISCOUNT_CODES_ENABLED` apagado: el campo no aparece y un POST con `discount_code` responde 409.
9. Primer cobro y renovación: el monto de `subscriptions.amount` y de la preapproval es el del descuento.

## 4. Marcha atrás

- Apagar `DISCOUNT_CODES_ENABLED`: el checkout vuelve a cobrar el precio normal y rechaza códigos. Las reservas vigentes expiran solas a los 30 minutos.
- Las suscripciones ya creadas con descuento siguen con su monto en Mercado Pago (no se modifican).
- La migration es aditiva; no hace falta revertirla.

## 5. Límites conocidos

- Solo duración «Para siempre». «Primer mes» queda guardado pero se rechaza como no soportado.
- Reemplazar un checkout pendiente depende de que Mercado Pago confirme `PUT /preapproval/{id}` con `status: cancelled`; si no lo confirma, no se aplica el descuento y el usuario puede continuar sin código.
- Una autorización que llega con la reserva ya vencida se honra (el precio ya está contratado) y puede superar `max_uses` en ese caso borde.
- No hay precarga automática del código desde el registro (el campo de registro mezcla referidos y códigos).
