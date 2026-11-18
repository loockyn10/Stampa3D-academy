# Recuperación de contraseña (flujo `token_hash`)

Estado 2026-11-18. Reemplaza el flujo PKCE (`{{ .ConfirmationURL }}` → `/auth/callback`) **solo para la recuperación**; confirmación de cuenta, cambio de correo e invitación siguen con `{{ .ConfirmationURL }}`.

## Qué pasaba (incidente: el botón del correo llevaba a la landing)

Evidencia contra el proyecto real (endpoint `/auth/v1/verify` con un token inválido, que redirige según la configuración y no envía correos):

- El **Site URL** de Supabase seguía siendo `https://academia-stampa.com` (dominio anterior).
- Ninguna URL de `universo-stampa.com` figuraba en **Redirect URLs** (ni `/auth/callback` ni con `?next=…`).

Con eso Supabase descartaba el `redirectTo` de la app y mandaba el enlace a `academia-stampa.com/?code=…` → Vercel lo reenvía a `universo-stampa.com/?code=…` → la app no procesa `?code=` en `/` → el proxy manda a todo visitante de `/` a `/landing`. El token se perdía. No era un fallo de código: el flujo `/auth/callback` nunca llegó a ejecutarse.

## Flujo actual

1. `/recuperar-password` → `resetPasswordForEmail` (sin cambios; respuesta neutral, espera de 60 s).
2. Correo (plantilla *Reset password*): el botón es `https://universo-stampa.com/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`. Dominio fijo en la plantilla: no depende del Site URL ni de Redirect URLs.
3. `/auth/confirm` (`src/app/auth/confirm/`): muestra un botón. **No consume el token al cargar** (los escáneres de correo solo hacen GET). Al pulsar: `verifyOtp({ type: "recovery", token_hash })` → sesión de recuperación → navegación completa a `/actualizar-password`.
4. `/actualizar-password`: avisa al abrir si no hay sesión; `updateUser({ password })`; revoca las otras sesiones; confirma y entra a la app.

Seguridad: `token_hash` no necesita el verificador PKCE, así que funciona desde cualquier navegador/dispositivo (Gmail/Outlook, celular). El enlace sigue siendo de un solo uso y con vencimiento (Supabase → Auth → Email → *Email OTP Expiration*, 1 h por defecto). La página usa `Referrer-Policy: no-referrer`, `noindex` y nunca registra ni muestra el token. Solo se acepta `type=recovery` y un `token_hash` con forma válida (`src/lib/auth/recovery-link.ts`). El proxy ya trata `/auth/*` y `/actualizar-password` como públicos y exentos de onboarding.

## Qué debe cambiar el dueño en Supabase (el orden importa)

1. **Desplegar primero** esta versión (la ruta `/auth/confirm` tiene que existir).
2. Authentication → Emails → Templates → **Reset password**: pegar el contenido de `email-templates/supabase/02-recuperacion-de-contrasena.html` (asunto: `02-recuperacion-de-contrasena.subject.txt`). Verificar que el botón diga `https://universo-stampa.com/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
3. Authentication → URL Configuration:
   - **Site URL**: `https://universo-stampa.com` (hoy es `https://academia-stampa.com`).
   - **Redirect URLs**: `https://universo-stampa.com/**` (cubre `/auth/callback?next=…`; con solo `/auth/callback` exacto no alcanza si lleva `?next=`). Opcional para desarrollo: `http://localhost:3000/**`.
   Con esto también quedan bien la confirmación de cuenta y el cambio de correo (siguen usando `{{ .ConfirmationURL }}`).
4. Resend → Domains: Click tracking y Open tracking apagados.

## Verificación en producción (cuenta propia, no de un cliente)

1. `/recuperar-password` → pedir el correo.
2. Abrir el correo (idealmente en otro dispositivo/navegador, y desde la app de Gmail/Outlook) → botón → página «Cambiar contraseña» → **Continuar** → formulario.
3. Guardar la contraseña → «Contraseña actualizada» → entra a la app.
4. Cerrar sesión e iniciar con la contraseña nueva; la anterior debe fallar.
5. Reabrir el mismo correo: debe decir «venció o ya se usó» (un solo uso) con enlace para pedir otro.
6. Comprobar que nunca aparece la landing durante el proceso.

Verificado en local (2026-11-18) contra un Supabase Auth simulado con el mismo contrato HTTP: GET de escáner sin consumir → botón → formulario → cambio → clave vieja rechazada / nueva acepta → reuso del enlace rechazado → sin sesión avisa. **No verificado:** el correo real y los paneles (los hace el dueño con la lista de arriba).
