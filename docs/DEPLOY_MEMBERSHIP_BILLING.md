# Despliegue y prueba: circuito de membresías con Mercado Pago (Sprint 1 / 1.1)

Decisiones: `docs/DECISIONS.md` D044 (billing) y D045 (baja: **pendiente de definición comercial**). Código: `src/lib/mercadopago/membership-*.ts`.
**No requiere migración.** Variable nueva: `CRON_SECRET` (y opcional de prueba `MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS`). Archivo nuevo: `vercel.json` (un cron). Rama: `feature/sprint1-subscriptions` (parte de `security/sprint0-profiles-guard`, que incluye la guarda de `profiles`).

## Estado (2026-11-05)

**Desarrollo local: terminado** (cierre del Sprint 1, 2026-11-05). No se implementan más cambios de pagos hasta la validación real. **Validación real con Mercado Pago: pendiente**; el sistema **no** está validado en producción.

| Paso | Estado |
|---|---|
| Código + tests automáticos (dobles de MP y Supabase) | **Hecho** — `tests/membership-cycle.test.mjs`, `tests/membership-reconcile.test.mjs` |
| Conciliación automática diaria (Vercel Cron) | **Hecho en código** — se activa al desplegar `vercel.json` en Production |
| Experiencia de baja | **Pendiente de definición comercial** (§7, D045). El código actual se conserva sin cambios |
| Entorno aislado de prueba (§5) | **No se crea por ahora** (decisión del dueño, 2026-11-05) |
| Prueba real con Mercado Pago (§6) | **Pendiente** — la hace el dueño cuando lo decida; bloqueante para cobrar |
| Merge a `main` / deploy | **No realizados** — checklist en §11 |

## 1. Problemas encontrados en el código anterior (confirmados leyendo el código)

1. **El webhook nunca activaba membresías nuevas.** Tomaba `external_reference` como `user_id`, pero el checkout actual envía `stampa_checkout_<id>`: la actualización de `subscriptions` y la lectura de `profiles` fallaban en silencio y el evento quedaba `processed = true`. Solo `/pago/estado` (sync) activaba, y solo si el usuario volvía a esa pantalla.
2. **Acceso sin pago aprobado.** El sync y el webhook activaban con la preapproval `authorized` (tarjeta vinculada) aunque el primer cobro no se hubiera aprobado.
3. **Renovación rechazada = un mes gratis.** El cobro recurrente extendía el acceso con `status = processed`, que Mercado Pago también usa para una cuota cuyo último reintento fue **rechazado**; además sumaba un mes desde *ahora* en cada notificación (cada reintento de MP regalaba tiempo).
4. **Firma opcional** (solo se validaba si llegaba el header), comparación no constante, evento guardado antes de validar.
5. **Siempre 200**, incluso ante caídas de MP o Supabase: Mercado Pago no reintentaba y la activación se perdía.
6. **Cancelar acortaba el acceso a `now`** cuando no encontraba el período pago, y no existía cancelación dentro de la app.
7. **`payments` duplicados** (un insert por notificación, sin clave) y el topic `payment` activaba 1 mes por `external_reference = user_id` (flujo legacy ya sin creador en el código).
8. `/sin-acceso` mostraba un precio inventado (`19900`) si fallaba la consulta y hacía `console.log` de la respuesta del checkout.

## 2. Qué cambia

| Pieza | Comportamiento |
|---|---|
| `membership-billing.ts` | Reglas puras: acceso solo con `payment.status = approved`; cada cobro cubre un período (`auto_recurring`) + 2 días de gracia; nunca acorta un vencimiento; no toca accesos sin vencimiento (otorgados por el equipo); resumen «Mi membresía». |
| `membership-sync.ts` | Circuito único (webhook, sync, cancelación): relee la preapproval y el cobro en MP, resuelve el dueño por `subscriptions` o `checkout_attempts`, guarda idempotente, extiende con compare-and-set. Errores transitorios vs. permanentes. |
| `membership-provider.ts` / `membership-store.ts` | Cliente HTTP de MP (timeouts de 6 s) e implementación Supabase con service role. |
| `POST /api/mercadopago/webhook` | Firma obligatoria. 503 sin secret · 401 firma inválida · 200 procesado/ignorado/error permanente · **500 error transitorio (MP reintenta)**. |
| `POST /api/mercadopago/sync-subscription` | Igual que antes para el cliente (`active`, `status`, `access_until`) + `membership`. Busca los cobros de la suscripción si el webhook todavía no llegó. |
| `GET /api/mercadopago/membership` | Resumen de solo lectura (Supabase). |
| `GET /api/mercadopago/reconcile` | **Sprint 1.1.** Conciliación programada (solo Vercel Cron con `CRON_SECRET`): re-sincroniza las suscripciones con renovación vencida o en reintento, los checkouts pendientes de los últimos 3 días y las que no se sincronizan hace 7 días. Idempotente, con presupuesto de 40 s y corte ante credenciales inválidas o 3 fallas seguidas. |
| `vercel.json` | Cron diario `15 9 * * *` (06:15 ART), compatible con el plan Hobby. Con Pro puede subirse a cada 6 h (`0 */6 * * *`) sin otros cambios. Los crons de Vercel solo corren en **Production**. |
| `billing-frequency.ts` | Cobro mensual siempre en producción. Solo en Preview/desarrollo, `MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS` (1–30) acorta el ciclo para ver una renovación real con usuarios de prueba. |
| `POST /api/mercadopago/cancel-subscription` | `{ subscription_id, confirm: true }`; solo la suscripción propia; `PUT /preapproval/{id}` `status=cancelled`; refleja el estado releído de MP. |
| UI | **Configuración → Membresía** y **Perfil** (accesible sin Premium) muestran plan, precio, renovación, estado de pago, acceso hasta, «Actualizar estado» y «Cancelar suscripción» con diálogo de confirmación. `/pago/estado` reintenta solo mientras el pago está pendiente. |

## 3. Notificaciones de Mercado Pago y conciliación (Sprint 1.1)

Según la documentación oficial vigente (fuentes al final):

1. **Qué recibimos:** `subscription_preapproval` (alta y cambios de la suscripción: autorizada, pausada, cancelada), `subscription_authorized_payment` (cada cuota y cada reintento de cobro) y, opcionalmente, `payment`.
2. **Cómo se configuran:** en **Tus integraciones → la aplicación → Webhooks**, eligiendo los eventos de «Planes y suscripciones». Nuestro checkout no manda una URL de notificación propia.
3. **Si una notificación falla:** Mercado Pago espera 200/201 en 22 s; si no, reintenta cada 15 minutos y después con intervalos más largos, sin un fin documentado. Por eso el webhook responde 5xx ante fallas transitorias. Una notificación se **pierde** de verdad solo si el webhook no está configurado, apunta a otra URL o el secreto no coincide.
4. **Renovación exitosa:** cuota con `payment.status = approved` (por webhook o por la conciliación, que busca las cuotas de la suscripción).
5. **Pago rechazado:** cuota con pago `rejected`. Mercado Pago reintenta hasta 4 veces en ~10 días y cancela la suscripción tras 3 cuotas rechazadas. El acceso no se extiende y vence solo.
6. **Sin intervención del usuario:** el webhook es la vía principal y la **conciliación diaria** es la red de seguridad. Con 2 días de gracia después de cada período, una renovación cuyo webhook se perdió se refleja antes de que el socio pierda el acceso.

## 4. Configuración a revisar antes de cobrar (sin compartir valores en el chat)

**Vercel (Production):**
- `MERCADO_PAGO_WEBHOOK_SECRET` — **obligatorio**: sin él el webhook responde 503 (MP reintenta; nadie se activa por webhook). Es la «clave secreta» de Webhooks de la **misma aplicación** de MP cuyo access token se usa.
- `MERCADO_PAGO_ACCESS_TOKEN` — credencial productiva.
- `CRON_SECRET` — **nueva**: valor aleatorio de al menos 16 caracteres (recomendado 32 o más). Vercel la envía sola a los crons. Sin ella la conciliación responde 401 y no corre.
- `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_APP_URL` (dominio final; arma el `back_url` → `/pago/estado`).
- **No** definir `MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS` en Production (igual se ignora ahí).
- `DISCOUNT_CODES_ENABLED=false` (sin cambios).

**Mercado Pago (aplicación productiva → Webhooks):**
- URL `https://<dominio>/api/mercadopago/webhook`, eventos de «Planes y suscripciones» (`payment` opcional).
- «Simular» debe responder **200** (el id simulado no existe y queda como `provider_not_found`). Si responde 401, el secreto de Vercel no es el de esa aplicación.

**Supabase (producción):** correr `supabase/diagnostics/20261105_membership_billing_state.sql` (solo lectura) bloque por bloque: A y B todo en `true`; revisar F (accesos vigentes sin cobro aprobado: deben ser otorgados a propósito).

## 5. Entorno aislado para las pruebas reales (referencia; no se crea por ahora)

**Decisión 2026-11-05:** no se crea un Supabase de prueba ni un entorno adicional; las pruebas reales las hace el dueño con la infraestructura existente. Cuidados si se prueba sobre producción: cambiar `MERCADO_PAGO_ACCESS_TOKEN` por el de un vendedor de prueba **rompe los cobros reales** mientras esté puesto, y cualquier prueba escribe filas en la base de producción. La alternativa de menor riesgo es una compra real con una cuenta propia (monto real, luego cancelada) y revisar las filas que genera. Esta sección queda como referencia si más adelante se decide aislar.

Un Preview de Vercel **no es aislado** si usa las variables de Production: escribiría en la base de producción y cobraría con la cuenta real. El entorno de prueba necesita **las tres piezas separadas**:

| Pieza | Producción | Prueba |
|---|---|---|
| Base | Supabase actual | **Proyecto Supabase nuevo** (`stampa-staging`) |
| Cobros | Aplicación MP productiva | Aplicación creada **dentro del vendedor de prueba** |
| App | Deploy de Production | Preview de la rama `feature/sprint1-subscriptions` |

Pasos (los hace el dueño; ninguno modifica producción):

1. **Supabase de prueba:** crear el proyecto. Copiar **solo el esquema** de producción (sin datos) con `supabase db dump` (por defecto es solo esquema) desde una terminal con la contraseña de la base, y aplicarlo en el proyecto nuevo. El esquema base no está versionado en el repo (P2-11), por eso hay que copiarlo de producción. Verificar después que existan `has_platform_access`, `is_admin`, el trigger de alta de usuarios sobre `auth.users`, la guarda `profiles_guard_privileged_columns`, `checkout_attempts` y una fila en `membership_settings` con un precio de prueba.
2. **Auth del Supabase de prueba:** Site URL y Redirect URLs = la URL del Preview de la rama.
3. **Mercado Pago:** en Developers → Cuentas de prueba, crear un **vendedor** y un **comprador** (Argentina). Entrar al panel de desarrolladores **con el vendedor de prueba**, crear una aplicación de Suscripciones, copiar su access token y configurar su webhook hacia `https://<preview>/api/mercadopago/webhook` con los eventos de «Planes y suscripciones»; copiar la clave secreta.
4. **Vercel → Environment Variables → Preview, limitadas a la rama** `feature/sprint1-subscriptions`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` del proyecto de prueba; `MERCADO_PAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET` de la aplicación del vendedor de prueba; `NEXT_PUBLIC_APP_URL` = URL estable del Preview de la rama; un `CRON_SECRET` propio; `MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS=1` para observar una renovación al día siguiente. Confirmar que **ninguna** variable de Preview apunta a producción (incluidas las de OpenAI y Bunny, que no son de este sprint).
5. **Protección de deploy:** Mercado Pago tiene que poder llegar al webhook del Preview. Desactivar Vercel Deployment Protection para ese Preview durante la prueba, o verificar que la URL de bypass funcione con los parámetros que agrega Mercado Pago.
6. **Cron en Preview:** Vercel no ejecuta crons fuera de Production. Para probar la conciliación, llamarla a mano desde tu terminal (sin pegar el secreto en el chat): `curl -H "Authorization: Bearer <CRON_SECRET de Preview>" https://<preview>/api/mercadopago/reconcile`.

## 6. Prueba de punta a punta (sin dinero real)

Tarjetas de prueba oficiales: el nombre del titular define el resultado (`APRO` aprobado, `OTHE` rechazado, `CONT` pendiente; verificar la tabla vigente en la doc de MP).

1. **Registro:** cuenta nueva con el email del comprador de prueba (el `payer_email` de la preapproval es el email de la cuenta). Ese email no recibe correos: si «Confirm email» está activo, confirmar el usuario a mano en Authentication → Users. Queda Free (`/sin-acceso`).
2. **Checkout:** «Suscribirme» → Mercado Pago, con el precio de `membership_settings`. En MP la frecuencia debe verse diaria (override de prueba).
3. **Pago:** tarjeta `APRO`. `/pago/estado` muestra «Esperando la confirmación» y luego «¡Tu membresía está activa!».
4. **Webhook:** eventos `subscription_preapproval` y `subscription_authorized_payment` con `processed = true`.
5. **Activación:** `membership_status = active`, `membership_expires_at` ≈ cobro + 1 día + 2 días; `subscriptions.status = authorized`; una fila `payments` `approved`.
6. **Acceso:** Inicio, Academia y Stampy abren sin pasar por `/sin-acceso`.
7. **Renovación (día siguiente):** Mercado Pago cobra solo. Debe llegar un `subscription_authorized_payment` nuevo y `membership_expires_at` avanzar un día, sin abrir la app.
8. **Webhook perdido:** desactivar temporalmente el webhook de la aplicación de prueba, esperar la renovación siguiente y llamar a la conciliación (§5.6): debe responder `synced ≥ 1`, `extended = 1`, y el vencimiento avanzar. Volver a activar el webhook.
9. **Gestión de membresía:** Configuración → Membresía muestra estado, precio, próximo cobro y acceso hasta.
10. **Baja** (solo si el negocio aprueba la experiencia actual, §7): cancelar desde la app; en MP la suscripción figura cancelada; el perfil conserva `membership_expires_at`.
11. **Negativos** (otra cuenta cada uno): `OTHE` → sin acceso, «El pago fue rechazado»; `CONT` → «Esperando la confirmación», sin acceso; `POST` al webhook sin firma → 401; `GET` a la conciliación sin el secreto → 401.

Si algo falla: no habilitar el cobro y guardar el `error_message` del evento, la respuesta de la conciliación y la de `/pago/estado` (sin datos personales).

## 7. Baja de la suscripción: pendiente de definición comercial (D045)

La ausencia de un botón de baja era una decisión de negocio. El Sprint 1 agregó uno (Configuración → Membresía y Perfil), que **se conserva sin considerarse aprobado**. Análisis normativo preliminar (no es asesoramiento legal; validar con un abogado):

- **Ley 24.240, art. 10 ter:** un servicio contratado por medios electrónicos puede rescindirse, a elección del consumidor, por el mismo medio. La membresía se contrata en la web, así que debe poder darse de baja en la web.
- **Disposición SSDCyLC 954/2025** (reemplaza a las Res. 316/2018 y 424/2020): exige un enlace «Botón de baja de servicio» visible desde el primer acceso al sitio, sin pasos adicionales, y que el proveedor informe dentro de las 24 h un código de identificación de la baja por el mismo medio. Exige también un «Botón de arrepentimiento» (revocación de la compra) y publicar un teléfono o canal de contacto. La Disposición DNDCyAC 3/2026 permite validar la identidad del consumidor.
- **Art. 10 quáter:** no se puede cobrar cargo ni preaviso por la baja.

**Consecuencia:** eliminar u ocultar la baja online no es una opción segura. Lo que sí es decisión comercial:

| Tema | Opciones |
|---|---|
| Dónde vive el botón | Enlace visible en la landing/pie («Botón de baja») hacia una página de baja; dentro de la app en Configuración → Membresía |
| Cómo se confirma | Cancelación inmediata en MP (actual) o solicitud que el equipo procesa en ≤ 24 h con código de baja |
| Qué pasa con el acceso | Se conserva hasta fin del período pago (actual, coincide con la landing) o se corta al confirmar |
| Retención | Mensaje u oferta antes de confirmar, siempre que no obstaculice la baja |
| Código de baja | Mostrar y enviar por email un identificador de baja (hoy no se envía email propio) |
| Arrepentimiento | Revocar dentro del plazo legal implica **reembolso**: hoy no existe un circuito de reembolso |

**Propuesta para el lanzamiento:** mantener la cancelación actual (inmediata en MP, acceso hasta fin del período), agregar los enlaces «Botón de baja» y «Botón de arrepentimiento» en la landing hacia una página pública que explique el trámite y lleve al login → Mi membresía, mostrar un código de baja en la confirmación y definir el proceso manual de reembolso por arrepentimiento. Nada de esto se implementó: espera la decisión.

## 8. Monitoreo de los primeros días

- Diario: bloque D del diagnóstico (eventos con `processed = false`). `unlinked_preapproval` / `owner_mismatch` requieren revisión manual; `provider_*` / `storage_unavailable` se resuelven con los reintentos de MP o la conciliación.
- Logs de Vercel: `[MP membership webhook]`, `[membership]` y `[membership reconcile]` (el informe muestra `selected`, `synced`, `extended`, fallas y `stoppedReason`). `provider_credentials` indica un access token inválido.

## 9. Rollback

Revertir el commit y redeployar. No hay cambios de base de datos que deshacer. Para apagar solo la conciliación: quitar el cron de `vercel.json` o el `CRON_SECRET`.

## 10. Pendiente / fuera de alcance

- Definición comercial y legal de la baja y el arrepentimiento (§7).
- Reembolsos y contracargos no revocan acceso automáticamente.
- Emails propios de confirmación, rechazo, baja o vencimiento.
- `PUT /preapproval` con `status=cancelled`, `GET /authorized_payments/search?preapproval_id=` y la frecuencia diaria de prueba siguen la documentación de MP, pero **no se ejercitaron contra la API real**: los confirma §6.
- En modo de prueba diario, el panel sigue diciendo «por mes» (texto fijo del plan mensual).
- Los beneficios de «Mi membresía» salen de `landing-content.ts`; al alinear la landing (P1-3) se actualizan solos.

Fuentes: [Webhooks de MP](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks) · [Notificaciones de Suscripciones](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/notifications) · [Pagos autorizados y reintentos](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/authorized-payments) · [Disposición 954/2025 (resumen)](https://allende.com/administrativo/el-gobierno-refuerza-la-proteccion-al-consumidor-en-el-comercio-electronico-09-05-2025/) · [Disposición 3/2026 (resumen)](https://aldiaargentina.microjuris.com/2026/02/06/legislacion-los-botones-de-baja-y-arrepentimiento-ahora-podran-exigir-validacion-de-identidad/)

## 11. Checklist de integración y despliegue (Sprints 0, 1 y 1.1)

Estado de ramas (2026-11-05): `main` = `origin/main` = `66e10b2`. `feature/sprint1-subscriptions` = `main` + 4 commits (`219f5a9`, `0490525`, `0ff22f2` del Sprint 0 y `87461ba` de los Sprints 1/1.1); fast-forward sin conflictos. Ninguna de las dos ramas está en `origin`. No hay migraciones pendientes: la del Sprint 0 ya está aplicada en producción y los Sprints 1/1.1 no agregan.

**Antes del merge**
1. Vercel → Production: definir `CRON_SECRET` (aleatorio, 32+ caracteres) y confirmar que existe `MERCADO_PAGO_WEBHOOK_SECRET` (clave de Webhooks de la **misma** aplicación de MP que el access token productivo). Sin el secret el webhook nuevo responde 503 (el anterior aceptaba notificaciones sin firma). Confirmar `MERCADO_PAGO_ACCESS_TOKEN` productivo, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL` y que **no** exista `MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS`.
2. Mercado Pago → aplicación productiva → Webhooks: URL `https://<dominio>/api/mercadopago/webhook` y eventos de «Planes y suscripciones».
3. Supabase: correr `supabase/diagnostics/20261105_membership_billing_state.sql`, bloques A y B (todo `true`).
4. Local: `npm test`, `npx tsc --noEmit`, `npm run build` sobre la rama.

**Integración** (con autorización explícita): push de la rama, PR a `main`, merge. Si Vercel despliega `main` automáticamente, **el merge es el deploy**: hacerlo en un horario tranquilo.

**Después del deploy**
5. «Simular» en el panel de Webhooks de MP → 200 (`provider_not_found` en `mercado_pago_webhook_events`). 401 = secret equivocado.
6. `GET /api/mercadopago/membership` sin sesión → 401 (código nuevo desplegado).
7. Vercel → Settings → Cron Jobs: figura `/api/mercadopago/reconcile` diario. Ejecutarlo una vez desde el panel y revisar el log `[membership reconcile]` (`stoppedReason: completed`; `provider_credentials` = token inválido).
8. Abrir Perfil y Configuración → Membresía con una cuenta Paid y una Free.
9. Durante 3 días: bloque D del diagnóstico (eventos con `processed = false`) y logs del cron.

**Riesgos**
- Secret ausente o equivocado → nadie se activa por webhook (sí al volver a `/pago/estado` y con el cron).
- Cambio de regla: desde el deploy solo un cobro aprobado da o extiende acceso. Las membresías activas existentes no se acortan; las que no tienen vencimiento (manuales) no se tocan.
- El topic `payment` deja de activar por `external_reference` (flujo legacy sin creador en el código).
- La cancelación dentro de la app queda visible al desplegar (Configuración → Membresía y Perfil) aunque su experiencia está pendiente de decisión comercial (D045). Decidir antes del merge si se acepta así para el lanzamiento.
- El circuito real con Mercado Pago **no está validado**: no anunciar el cobro hasta hacer la prueba de §6.

**Rollback**
- Inmediato: Vercel → Deployments → «Instant Rollback» al deploy anterior (no hay cambios de base de datos que deshacer).
- En el repo: `git revert 87461ba` en `main` (deja el Sprint 0, que es independiente). Para apagar solo el cron: quitar `CRON_SECRET` o la entrada de `vercel.json`.

## 12. Guía breve de validación real (P0 pagos, D048)

Requisitos: `describe_open_checkout` y `close_pending_checkout` (migration `20261029120000_discount_code_checkout.sql`) deben existir en Supabase remoto; sin ellas «Empezar un pago nuevo» falla cerrado. Usar el token de Mercado Pago de **producción** en Vercel y una cuenta compradora distinta de la vendedora.

1. **Camino feliz:** cuenta nueva → Activar membresía → pagar con la cuenta de MP **cuyo email es el mismo** → volver → acceso Premium. Esperado: 1 `subscriptions` authorized, 1 `payments` approved.
2. **Otra cuenta de MP:** cuenta nueva → «¿No pudiste pagar…?» → escribir el email de la cuenta de MP → Empezar un pago nuevo → pagar. Esperado: acceso Premium en la cuenta de Universo (no en otra).
3. **Pago que MP rechaza:** tras el fallo, «Empezar un pago nuevo» (con otro medio/cuenta). Esperado: la preapproval anterior queda `cancelled`, hay una sola viva.
4. **Doble clic / recarga:** una sola preapproval nueva; nunca dos `authorized`.
5. **Ya pagado:** con la suscripción activa, «Empezar un pago nuevo» responde 409 y no cancela nada.
Antes de cada prueba y después: `supabase/diagnostics/20261105_membership_billing_state.sql` (solo lectura) y logs de Vercel de `/api/mercadopago/create-subscription` (`restart failed`, `definite provider rejection`).
