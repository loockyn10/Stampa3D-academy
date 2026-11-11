# Puesta en producción — agenda de precio (Pioneros $9.900 × 6 períodos → $19.900)

**Estado (2026-11-12):** todo el código está commiteado en local, probado y **apagado**. Nada se aplicó en Supabase, Vercel ni Mercado Pago; sin push ni deploy. Este documento es solo el orden de salida y lo que falta.

## Qué queda configurado de antemano
- Contratar la promoción **no** depende de que el cambio de importe esté validado: con `PRICE_SCHEDULES_ENABLED=true` se pueden vender cupos; el sistema registra las condiciones, la aceptación y el calendario de cada suscripción.
- El cambio real de importe (`PUT` a Mercado Pago) y los avisos al cliente quedan apagados hasta `PRICE_STEP_UP_ENABLED=true`. Mientras tanto el runner solo informa lo que haría (`dry_run`) y no se le dice nada al cliente sobre un cambio que no ocurriría.
- **Alertas** para que la validación no quede pendiente: banner en `/admin` y `/admin/promociones` + correo a `PRICE_ALERT_EMAIL` (una vez por nivel: 120, 75, 45 y 28 días antes de que termine la primera promoción, y «vencida» si pasa sin habilitar) + línea `ALERTA` en los logs del cron desde los 45 días. También avisa si una agenda queda en revisión, reautorización o sin reintentos.

## Orden de salida (cada paso lo autorizás y lo ejecutás vos)
1. **Antes de la migration:** correr `supabase/diagnostics/20261112_price_schedules_compat.sql` en el SQL Editor. Todas las filas deben dar `ok = true`.
2. **Aplicar** `supabase/migrations/20261112120000_price_schedules.sql` (solo agrega objetos nuevos; **no** aplicar `20261111120000_pioneer_edition.sql`, que queda como referencia). Después correr `20261112_price_schedules_postcheck.sql`: todo `ok = true`.
3. **Desplegar** el código (push + deploy: autorización aparte). Antes, confirmar que `0c987c2` está incluido (protege el cambio masivo de precios).
4. **Variables en Vercel (Production)**, sin pegarlas en el chat:
   - `PRICE_SCHEDULES_ENABLED=true`
   - `RESEND_API_KEY`, `PRICE_NOTICE_FROM` (remitente verificado en Resend, p. ej. `Universo Stampa <avisos@tudominio>`), `PRICE_ALERT_EMAIL` (a dónde llegan las alertas)
   - `DISCOUNT_CODES_ENABLED=true` (ya hace falta para cualquier código)
   - **No** poner todavía `PRICE_STEP_UP_ENABLED`. Redeploy.
5. **Crear el código** en `/admin/codigos`: tipo *Precio Especial Fijo* = 9900, marcar «Precio especial solo por períodos mensuales», períodos = 6, precio posterior = 19900, aviso previo = 20 días, límite de usos = 20. El código **PIONEROS** se crea inactivo y se activa solo si las condiciones quedan guardadas.
6. **Primera compra real** con tu propia cuenta (es un cupo real, no una prueba): ver que `/sin-acceso` muestra las condiciones y la casilla, que Mercado Pago muestra «$9.900/mes por 6 meses, luego $19.900/mes» y que en `/admin/promociones` aparece la agenda con su fecha de fin. Si Mercado Pago rechazara el texto del checkout (su largo máximo no está documentado), se verá en este paso y se acorta.
7. **Antes de que termine la primera promoción** (las alertas te avisan): validar el cambio de importe con una suscripción propia en producción y dinero real (autorización aparte), y recién entonces `PRICE_STEP_UP_ENABLED=true`. Con la validación hecha, el sistema avisa por correo ≥ 20 días antes, cambia el importe, lo verifica y registra todo.

## Qué no cubre / decisiones tuyas pendientes
- **Validación del `PUT` en Mercado Pago** (reautorización, desde qué cobro rige): bloquea solo el cambio, no las ventas. Si exigiera reautorización, la agenda queda en «Requiere reautorización», el importe vuelve al promocional y se activa la alternativa con acción del cliente (suscripción nueva al precio aceptado, o vencimiento natural).
- **Textos legales** de las condiciones y del aviso (consultar abogado) y la baja online (D045).
- **Resend:** cuenta, dominio verificado y clave. Sin correo configurado no se sube nunca el precio.
- Un único cron diario en Vercel: alcanza (el aviso es a ~30 días del cambio), pero no hay margen para fallas largas del cron.
