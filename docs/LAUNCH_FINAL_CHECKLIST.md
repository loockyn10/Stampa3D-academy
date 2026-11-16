# Checklist final de lanzamiento — Universo Stampa

Actualizado 2026-11-15. Estados: **TERMINADO** · **LISTO PARA TESTEAR** · **REQUIERE CONFIGURACIÓN** · **BLOQUEANTE** · **POSTLANZAMIENTO**.

## Tareas

| # | Tarea | Estado | Dónde / nota |
|---|---|---|---|
| 1 | Registro sin código Beta ni referido | LISTO PARA TESTEAR | `/registro` · D053 · interruptores en `src/lib/registration/public-signup.ts` |
| 2 | Aviso del correo de Mercado Pago junto al email | LISTO PARA TESTEAR | `/registro` (recomendación; la alternativa está en `/sin-acceso`) |
| 3 | Código de descuento siempre visible + condiciones Pioneros | LISTO PARA TESTEAR | `/sin-acceso` (necesita sesión y `DISCOUNT_CODES_ENABLED=true`) |
| 4 | `returnTo` de «Quiero Premium» conservado en registro, confirmación y login | TERMINADO | Mecanismo existente; verificado en código y en navegador sin sesión |
| 5 | Pantallas de correo (reenvío, recuperación, enlace vencido, contraseña actualizada) | LISTO PARA TESTEAR | `/verificar-email`, `/recuperar-password`, `/actualizar-password` |
| 6 | Resend: cuenta, dominio verificado, API key | REQUIERE CONFIGURACIÓN | `docs/RESEND_EMAIL_SETUP.md` §2 |
| 7 | SMTP de Supabase Auth con Resend + límites + plantillas en español | REQUIERE CONFIGURACIÓN | `docs/RESEND_EMAIL_SETUP.md` §3. **Hasta hacerlo, los límites del correo de Supabase pueden bloquear registros** |
| 8 | Variables en Vercel Production | REQUIERE CONFIGURACIÓN | `DISCOUNT_CODES_ENABLED=true`, `PRICE_SCHEDULES_ENABLED=true`, `RESEND_API_KEY`, `PRICE_NOTICE_FROM`, `PRICE_ALERT_EMAIL`. **No** `PRICE_STEP_UP_ENABLED`. Confirmar `NEXT_PUBLIC_APP_URL`, `MERCADO_PAGO_WEBHOOK_SECRET`, `CRON_SECRET` |
| 9 | Código PIONEROS creado en `/admin/codigos` con condiciones por períodos | REQUIERE CONFIGURACIÓN | Precio especial 9900 · períodos 6 · posterior 19900 · aviso 20 · límite 20 usos. Sin `PRICE_SCHEDULES_ENABLED=true` el checkout lo rechaza («todavía no está disponible») |
| 10 | Primera compra real con PIONEROS (cuenta propia) | BLOQUEANTE | Única prueba de punta a punta del precio promocional en Mercado Pago (`DEPLOY_PRICE_SCHEDULES.md` paso 6) |
| 11 | Sorteos apagado para el público | REQUIERE CONFIGURACIÓN | `/admin/funcionalidades` → Sorteos deshabilitado (hoy no se pudo verificar el valor en producción) |
| 12 | Enlace de Telegram del pie apunta a `t.me/extruye` | REQUIERE CONFIGURACIÓN | `/admin/redes-canales` (dato de la base, QA-027) |
| 13 | Textos legales (términos, privacidad, membresía, Pioneros, baja/arrepentimiento) | BLOQUEANTE | `docs/LEGAL_REVIEW_PACK.md`: decisiones del dueño + abogado. El pie los muestra «pendiente» |
| 14 | Supabase Pro | REQUIERE CONFIGURACIÓN | `docs/SUPABASE_PRO_READINESS.md` (no resuelve el correo por sí solo) |
| 15 | Validar el cambio $9.900 → $19.900 por API y activar `PRICE_STEP_UP_ENABLED` | POSTLANZAMIENTO | Obligatorio **antes del 7.º período** de los primeros Pioneros. Alertas en `/admin` y por correo |
| 16 | Texto del cobro en Mercado Pago dice «Academia Stampa» | POSTLANZAMIENTO | Decisión de marca (`LEGAL_REVIEW_PACK.md` §3.2) |
| 18 | Recorridos Free / Premium separados, aviso «Desbloquear con Premium», onboarding solo Premium | LISTO PARA TESTEAR | D054 · pruebas 16–19 |
| 19 | Cupos PIONEROS consumidos solo con el primer pago aprobado | LISTO PARA TESTEAR | Funciona ya con el código desplegado; la migration agrega la doble verificación en la base |
| 20 | Migration `20261115120000_discount_confirm_on_first_payment.sql` | REQUIERE CONFIGURACIÓN | Antes: `supabase/diagnostics/20261115_discount_first_payment_state.sql` (A todo `true`, revisar B). Sin ella no hay resumen de cupos ni liberación automática de checkouts abandonados |
| 21 | Registro sin confirmación de correo (D055) | REQUIERE CONFIGURACIÓN | Supabase → Authentication → Sign In / Providers → Email → **Confirm email apagado**. Recomendado: CAPTCHA en Auth (no implementado) |
| 17 | Programa de referidos y sorteos | POSTLANZAMIENTO | Con ~20–30 miembros: `REFERRAL_PROGRAM_PUBLIC = true` + bases legales |

## Pruebas para mañana (en orden)

Usar una cuenta propia nueva (no un cliente). Ninguna prueba hasta la 9 cobra dinero.

1. **Registro limpio** — Entrar a `/landing` → «Quiero Premium». Esperado: `/registro` con título «Estás a un paso de Universo Premium», solo Nombre, Email y Contraseña, y el recuadro naranja del correo de Mercado Pago debajo del email. Error: aparece un campo de invitación/referido o el recuadro no se ve en celular.
2. **Entrada directa (Premium)** — Crear la cuenta (con «Confirm email» ya apagado). Esperado: sin pasar por `/verificar-email` ni por `/login`, entra a `/sin-acceso` «Activá tu membresía Premium»; no llega ningún correo de confirmación. Error: aparece «Revisá tu correo» (Confirm email sigue activo) o pide iniciar sesión.
3. **Sesión persistente** — Recargar `/sin-acceso` y cerrar/reabrir la pestaña. Esperado: sigue con sesión. Error: vuelve a `/login`.
4. **Correo ya registrado** — Volver a registrarse con el mismo correo (en ventana privada). Esperado: «No pudimos crear la cuenta con ese email. Si ya tenés una, iniciá sesión o recuperá tu contraseña.». Error: texto en inglés o entra a la cuenta existente.
5. **Código visible** — En `/sin-acceso` (celular y computadora). Esperado: campo «Código de descuento» visible sin tocar nada, placeholder «Ingresá tu código promocional», botón «Aplicar». Error: aparece «Tengo un código» o el campo no está (revisar `DISCOUNT_CODES_ENABLED`).
6. **Códigos inválidos** — Probar `XXXX`, un código vencido y uno agotado (crearlos inactivos en `/admin/codigos` si hace falta). Esperado: «Código inválido.», «Este código venció.», «Este código ya alcanzó el límite de usos.». Error: texto técnico o se aplica igual.
7. **PIONEROS** — Aplicar `PIONEROS`. Esperado: «Precio regular» tachado, $9.900/mes, recuadro verde «Pagás $9.900 por mes en lugar de …», bloque «Promoción especial» con precio, 6 períodos y $19.900 desde el período 7; botón deshabilitado hasta marcar la casilla. Error: dice «todavía no se puede aplicar» (falta `PRICE_SCHEDULES_ENABLED=true`) o falta la casilla.
8. **Sin código** — Quitar el código (✕). Esperado: vuelve al precio regular y desaparecen las condiciones. Error: queda el precio promocional.
9. **Compra real PIONEROS** (cobra $9.900) — Marcar la casilla → «Activar membresía». Esperado: Mercado Pago muestra «$9.900/mes por 6 meses, luego $19.900/mes»; al volver, acceso Premium; en `/admin/promociones` aparece la agenda con su fecha de fin y el código con 1 uso. Error: Mercado Pago rechaza el texto, el acceso no se activa tras «Actualizar acceso», o no aparece la agenda.
10. **Recuperar contraseña** — Cerrar sesión → `/recuperar-password`. Esperado: mensaje neutro, botón en espera de 60 s, mail en español; el enlace lleva a `/actualizar-password` y luego «Contraseña actualizada». Error: el enlace abre «venció o ya se usó» en el mismo navegador recién pedido.
11. **Enlace viejo** — Reabrir el mismo enlace de recuperación. Esperado: «El enlace … venció o ya se usó» con «Pedir un enlace nuevo». Error: mensaje genérico o en inglés.
12. **Login con destino** — Desde `/landing` «Ya tengo cuenta» con la cuenta Premium. Esperado: entra a la app (Premium no ve `/sin-acceso`). Con una cuenta Free termina en `/sin-acceso`.
13. **Perfil** — `/perfil` con la cuenta Free. Esperado: sin tarjeta «Tu código de referido»; sigue «Canjear código de invitación». Error: se anuncia el programa de referidos.
14. **Navegación** — Sidebar y menú móvil: Sorteos no aparece para usuarios comunes (tras apagarlo). Sin desplazamiento horizontal a 375 px.
15. **Admin** — `/admin/codigos` (ver PIONEROS con «$9900 x 6 meses, luego $19900») y `/admin/promociones` (interruptores: agendas encendidas, cambio de importe **apagado**, correo configurado).
16. **Registro Free** — `/landing` → «Crear cuenta gratuita» → registro. Esperado: entra directo a la Calculadora (área gratuita) sin correo, sin segundo login, sin onboarding ni pantalla de pago. Error: termina en «Activá tu membresía Premium», `/verificar-email` o `/login`.
17. **Recuperación revoca otras sesiones** — Con la cuenta abierta en dos navegadores, recuperar la contraseña desde uno. Esperado: tras «Contraseña actualizada» ese navegador sigue adentro; el otro pierde la sesión como máximo al vencer su token (≈1 h) o al recargar tras ese plazo. Error: el otro navegador sigue adentro indefinidamente.
18. **Sección Premium desde Free** — Con la cuenta Free, tocar Stampy o Academia en el menú. Esperado: aviso «Stampy IA es parte de la membresía Premium» con «Desbloquear con Premium» y «Seguir con mi cuenta gratuita»; el precio y el código aparecen solo tras «Desbloquear». Error: aparece el checkout directo o un modal.
19. **Abandono** — Desde el checkout ir a Mercado Pago y volver sin pagar (botón «volver» de Mercado Pago). Esperado: `/pago/estado` verifica unos segundos y muestra «No se completó el pago… no se cobró nada» con «Volver a intentar el pago» y «Seguir con mi cuenta gratuita»; la cuenta sigue Free. En `/admin/codigos` (con la migration) el código muestra 1 reservado, 0 pagados. Error: «El pago fue rechazado» o Premium activo sin pagar.
20. **Cupo al pagar** — Después de la compra real (prueba 9): `/admin/codigos` muestra PIONEROS con 1 pagado. Al día siguiente sigue en 1 (la conciliación no suma por la renovación ni por webhooks repetidos).
