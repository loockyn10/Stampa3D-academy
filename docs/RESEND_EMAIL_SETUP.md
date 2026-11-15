# Correo transaccional: Supabase Auth + Resend

Estado 2026-11-15: el dueño informa que Resend ya está configurado (dominio `universo-stampa.com`, remitente `no-reply@universo-stampa.com`, en Supabase Auth y en Vercel), pero **no está verificado desde el repo ni probado el envío real**. Las plantillas de marca están en [`EMAIL_TEMPLATES_GUIDE.md`](EMAIL_TEMPLATES_GUIDE.md) (falta pegarlas en Supabase). Texto original del estado: el código está listo; falta la cuenta de Resend, el dominio verificado y la configuración en los paneles. No afirmar que el correo funciona hasta completar la §5.

## 1. Quién envía cada correo (auditoría del código)

| Correo | Lo envía | Disparado desde | Plantilla |
|---|---|---|---|
| Confirmación de registro | **Supabase Auth** | `supabase.auth.signUp` en `/registro` | Panel Supabase → Auth → Email Templates → *Confirm signup* |
| Reenvío de confirmación | **Supabase Auth** | `auth.resend({ type: "signup" })` en `/verificar-email` | *Confirm signup* |
| Recuperación de contraseña | **Supabase Auth** | `resetPasswordForEmail` en `/recuperar-password` | *Reset password* |
| Cambio de correo | — | La app no ofrece cambio de correo (no hay `updateUser({ email })`) | Plantilla lista (*Change email address*), sin flujo que la use |
| Aviso de cambio de precio (Pioneros) | **App → Resend** | Cron `/api/mercadopago/reconcile` → runner de agendas, solo con `PRICE_STEP_UP_ENABLED=true` | `src/lib/mercadopago/price-notice.ts` |
| Alertas internas de promociones | **App → Resend** | Mismo cron, a `PRICE_ALERT_EMAIL` | `price-schedule-alerts.ts` |

No hay duplicación: la app nunca envía correos de autenticación y Supabase nunca envía avisos comerciales. Resend se usa por **dos caminos independientes**: SMTP (lo configura Supabase con la API key) y la API HTTP (la usa la app con `RESEND_API_KEY`). Pueden compartir la misma cuenta y dominio.

Todos los enlaces de Supabase vuelven a `/<origen>/auth/callback?next=…` (PKCE): la confirmación y la recuperación deben abrirse **en el mismo navegador** donde se pidieron. Si no, `/auth/callback` muestra «enlace vencido o inválido» y ofrece pedir otro (no hay texto de Supabase en la pantalla).

## 2. Resend (cuenta y dominio)

1. Crear la cuenta en resend.com y, en **Domains → Add domain**, cargar el dominio desde el que se enviará (recomendado un subdominio, p. ej. `mail.<tu-dominio>`).
2. Copiar en el DNS del dominio los registros que muestra Resend (SPF/MX del subdominio de envío y el TXT de DKIM `resend._domainkey`). Opcional y recomendado: un registro DMARC (`_dmarc`, `v=DMARC1; p=none;` para empezar).
3. Esperar el estado **Verified** en Resend. Sin dominio verificado, Resend rechaza el remitente y no sale ningún correo.
4. **API Keys → Create**: una clave con permiso *Sending access* (idealmente limitada a ese dominio). No pegarla en el chat ni en el repo.
5. Revisar el límite diario/mensual del plan de Resend elegido (el plan gratuito tiene un tope diario bajo) y compararlo con el volumen esperado de registros + recuperaciones.

## 3. SMTP de Supabase Auth (panel de Supabase, no código)

Supabase → **Authentication → Emails → SMTP Settings → Enable custom SMTP**:

| Campo | Valor |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) o `587` (STARTTLS) |
| Username | `resend` |
| Password | la API key de Resend |
| Sender email | una dirección del dominio verificado, p. ej. `no-reply@mail.<tu-dominio>` |
| Sender name | `Universo Stampa` |

Después:
- **Authentication → Rate Limits → Rate limit for sending emails**: con SMTP propio Supabase permite subirlo (el SMTP incorporado solo admite unos pocos correos por hora, que es el origen de los bloqueos actuales). Elegir un valor acorde al plan de Resend. El intervalo por dirección (60 s) puede quedar como está: la app ya espera ese tiempo antes de dejar reenviar.
- **Authentication → URL Configuration**: *Site URL* = el dominio de producción; *Redirect URLs* debe incluir `https://<dominio>/auth/callback` (y `https://www.<dominio>/auth/callback` si se usa www).
- **Email Templates**: plantillas con la marca Universo Stampa listas en `email-templates/` (instalación paso a paso en [`EMAIL_TEMPLATES_GUIDE.md`](EMAIL_TEMPLATES_GUIDE.md)); conservan `{{ .ConfirmationURL }}` como enlace (no reemplazarlo por una URL armada a mano: rompe el flujo PKCE).
- **Confirm email**: dejar activo. La app funciona con y sin confirmación (Sprint 2), pero con SMTP propio no hay motivo para apagarlo.

## 4. Variables de la app (Vercel → Production; solo servidor)

| Variable | Para qué | Obligatoria |
|---|---|---|
| `RESEND_API_KEY` | API HTTP de Resend (avisos Pioneros y alertas) | Sí, antes del primer aviso |
| `PRICE_NOTICE_FROM` | Remitente verificado, p. ej. `Universo Stampa <avisos@mail.<tu-dominio>>` | Sí |
| `PRICE_ALERT_EMAIL` | Destinatario de las alertas internas | Recomendada |

Sin `RESEND_API_KEY` + `PRICE_NOTICE_FROM` la app no envía nada, registra `notice_mailer_missing` en la agenda y **nunca sube el precio** (el runner exige un aviso enviado). Un rechazo de Resend queda como `notice_email_failed` con el código HTTP (sin direcciones de correo en logs) y tampoco se marca como enviado. `/admin/promociones` muestra si el correo está configurado.

Ninguna variable lleva prefijo `NEXT_PUBLIC_`; Resend no se usa desde componentes cliente.

## 5. Pruebas pendientes (con credenciales reales, a cargo del dueño)

1. Registro con un correo propio nuevo → llega *Confirm signup* desde el remitente de Resend, en español → el enlace entra a la app (Free o `/sin-acceso` si venía de «Quiero Premium»).
2. `/verificar-email` → «Reenviar el email» → llega uno nuevo; el botón queda en espera 60 s (también tras recargar).
3. `/recuperar-password` → llega *Reset password* → `/actualizar-password` → «Contraseña actualizada» → entra.
4. Abrir un enlace viejo o en otro navegador → pantalla «El enlace venció o ya se usó» con la opción de pedir otro.
5. En Resend → **Logs**: los envíos figuran como *Delivered*; revisar que no caigan en spam (Gmail y Outlook).
6. Avisos Pioneros: no se pueden probar sin `PRICE_STEP_UP_ENABLED` (que sigue apagado). Con `PRICE_ALERT_EMAIL` configurado, la primera alerta llega cuando falten 120 días para el fin de la primera promoción.
