# Despliegue: códigos de descuento en el checkout

Rama: `feature/discount-codes-checkout` (cortada desde `main`, con el commit de los códigos Beta). **Nada de esto se ejecutó**: no hubo push, merge, deploy ni SQL remoto.

## 1. Qué cambia

| Pieza | Efecto |
|---|---|
| `20261029120000_discount_code_checkout.sql` | Crea `discount_code_reservations`, `discount_code_failed_attempts` y 8 funciones (solo `service_role`). No modifica filas de `invite_codes`, `checkout_attempts`, `subscriptions` ni `profiles`. |
| `20261030120000_discount_checkout_consistency.sql` | Agrega `over_limit`, la definición única de «asiento retenido» y reemplaza `reserve_discount_code` / `confirm_discount_reservation` (mismas firmas y permisos). Aditiva; no edita la anterior. |
| Código | `create-subscription` acepta un `discount_code` opcional; el webhook y `sync-subscription` consumen / liberan el uso; Sin acceso muestra "Tengo un código de descuento"; el panel solo permite "Para siempre". |
| `DISCOUNT_CODES_ENABLED` | **Apagado por defecto.** Con la migration aplicada y el código desplegado, nada cambia hasta ponerlo en `true`. |

## 2. Orden

1. Aplicar antes: las migrations de Beta (`20261005…` y `20261028…`) si todavía no lo están, y confirmar que `checkout_attempts` existe.
2. Backup / punto de restauración de Supabase.
3. Correr en el SQL Editor `supabase/diagnostics/20261029_discount_codes_state.sql` (solo lectura). Revisar `0_VERDICT` y la sección `A_columns` (la migration aborta sin cambios si falta una columna o `invite_codes.id` no es `uuid`).
4. Aplicar, **en este orden y juntas**, `supabase/migrations/20261029120000_discount_code_checkout.sql` y `supabase/migrations/20261030120000_discount_checkout_consistency.sql`. Volver a correr el diagnóstico: `Discount checkout migration: applied`, `Seat accounting migration: applied` y `C_functions` con `authenticated_execute=false` en todas. **No activar el interruptor si la segunda no figura aplicada** (sin ella una reserva con checkout abierto vence a los 30 minutos y un pago tardío puede superar el límite).
5. Desplegar el código. Con la migration sin aplicar y el interruptor apagado el checkout funciona como siempre. **No** activar el interruptor sin la migration: el checkout con código respondería 503.
6. Probar con **usuarios de prueba de Mercado Pago** (credenciales de prueba, nunca cobros reales) y recién entonces `DISCOUNT_CODES_ENABLED=true` en Vercel (redeploy).

## 3. Pruebas manuales (sandbox)

1. Crear en `/admin/codigos` un código porcentual «Para siempre» con límite de 1 uso.
2. Usuario Free A: Sin acceso → "Tengo un código de descuento" → aplicar → ver precio tachado y final → "Activar membresía": el link de Mercado Pago debe mostrar el monto con descuento.
3. Usuario Free B con el mismo código mientras A tiene su link de pago abierto: debe responder «límite de usos», **también pasados los 30 minutos** (el checkout abierto de A conserva su asiento). Solo si A nunca llegó a generar el link, la reserva vence a los 30 minutos y B puede usarlo.
4. A autoriza la suscripción: el uso queda consumido (`used_count` 1, una fila en `invite_code_redemptions`, reserva `confirmed`). Una segunda autorización/webhook no suma otro uso.
5. A cancela antes de autorizar: la reserva queda `released` y el uso vuelve a estar disponible.
6. Usuario con un checkout abierto SIN código que luego aplica uno: la preapproval vieja queda cancelada en Mercado Pago y el nuevo link lleva el monto con descuento. Verificar que no queden dos preapprovals vivas.
7. Código vencido, inactivo, inexistente, de "primer mes" y de acceso Beta: cada uno muestra su mensaje y no cambia el cobro.
8. Con `DISCOUNT_CODES_ENABLED` apagado: el campo no aparece y un POST con `discount_code` responde 409.
9. Quitar el código: aplicar un código, generar el link de Mercado Pago, volver y quitar el código, "Activar membresía" → debe llegar un link NUEVO al precio de lista y la preapproval anterior debe figurar `cancelled` en Mercado Pago (una sola viva). Repetir el click: mismo link, sin nueva cancelación. Doble click rápido: un solo checkout vivo.
10. Pago tardío: con `max_uses=1`, A aplica el código y genera el link; esperar más de 30 minutos; B debe recibir «límite de usos»; recién entonces A autoriza el pago: la reserva queda `confirmed` con `over_limit = false` y `used_count` 1. Reintentos de la misma notificación (reenviar el webhook) no suman otro uso.
11. Primer cobro y renovación: el monto de `subscriptions.amount` y de la preapproval es el del descuento.

## 4. Marcha atrás

- Apagar `DISCOUNT_CODES_ENABLED`: el checkout vuelve a cobrar el precio normal y rechaza códigos. Las reservas sin checkout expiran solas a los 30 minutos; las que ya tienen un link de pago abierto conservan su asiento hasta que ese checkout se autorice, se cancele o se reemplace (los checkouts con descuento ya creados siguen siendo válidos en Mercado Pago).
- Las suscripciones ya creadas con descuento siguen con su monto en Mercado Pago (no se modifican).
- La migration es aditiva; no hace falta revertirla.

## 5. Límites conocidos y decisiones comerciales abiertas (resolver ANTES de activar el interruptor)

1. **Checkouts abandonados retienen su asiento.** Un link de Mercado Pago ya creado puede autorizarse en cualquier momento, así que su asiento no vence por reloj; se libera cuando el usuario vuelve y lo reemplaza o completa, o cuando se cancela en Mercado Pago. En un código con pocos usos, unos pocos checkouts abandonados pueden dejarlo «agotado» para los demás. Opciones: (a) aceptar y fijar `max_uses` con margen; (b) liberar a mano (cancelar la preapproval pendiente en Mercado Pago, el webhook libera el asiento); (c) recuperación automática tras N horas — **no implementada**: cancelar una preapproval ajena desde un proceso podría cancelar a quien la está autorizando en ese instante. El diagnóstico muestra cuántos asientos retienen checkouts abiertos (`seat accounting`).
2. **Un pago hecho nunca se rechaza.** Si una autorización llega y el código ya estaba lleno (solo posible por intervención manual o datos anómalos) se honra al pagador, se marca `over_limit = true` y queda un `console.warn`. Decidir qué hacer con esos casos (dejarlos, o ajustar el monto con un `PUT /preapproval/{id}`, cuya aceptación sin reautorización del pagador no está verificada). Revisar `over_limit` en el diagnóstico antes y después de cada campaña.
3. **Un uso consumido no se devuelve** si la suscripción autorizada se cancela después.
4. **Reemplazo de checkouts pendientes (cambio de comportamiento):** además de aplicar o quitar un código, un checkout pendiente (nunca autorizado) con un precio de lista viejo también se reemplaza por uno al precio actual. Antes se entregaba el link viejo.
5. **Ventana mínima al reemplazar:** se cancela la preapproval pendiente en Mercado Pago antes de crear la nueva. Si el usuario estuviera autorizando justo en ese instante desde otra pestaña, esa autorización se perdería (queda cancelada y se le pide reintentar). Sin cobro previo, no hay doble cobro.
6. **Solo duración «Para siempre».** «Primer mes» queda guardado pero se rechaza como no soportado.
7. Sin precarga automática del código desde el registro.
