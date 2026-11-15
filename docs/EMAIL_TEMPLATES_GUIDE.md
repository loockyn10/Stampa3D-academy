# Correos de Universo Stampa: plantillas y guía de instalación

Estado 2026-11-15: plantillas diseñadas, probadas en local (Edge, escritorio 700 px y móvil 375 px) y cubiertas por `tests/email-templates.test.mjs`. **Nada está pegado en Supabase todavía** y no se probó el envío real: eso lo hace el dueño con esta guía (§4). Remitente de autenticación informado por el dueño: `no-reply@universo-stampa.com` (Resend como SMTP de Supabase). Configuración de Resend/SMTP: [`RESEND_EMAIL_SETUP.md`](RESEND_EMAIL_SETUP.md).

## 1. Qué hay

| # | Correo | Lo envía | Archivo (pegar el contenido) | Asunto (archivo `.subject.txt` hermano) | Prioridad |
|---|---|---|---|---|---|
| 1 | Confirmación de cuenta | Supabase Auth | `email-templates/supabase/01-confirmacion-de-cuenta.html` | Confirmá tu correo para activar tu cuenta de Universo Stampa | **1** |
| 2 | Recuperación de contraseña | Supabase Auth | `email-templates/supabase/02-recuperacion-de-contrasena.html` | Restablecé tu contraseña de Universo Stampa | **1** |
| 3 | Cambio de correo | Supabase Auth | `email-templates/supabase/03-cambio-de-correo.html` | Confirmá el cambio de correo de tu cuenta de Universo Stampa | 2 |
| 4 | Contraseña modificada | Supabase Auth (aviso de seguridad) | `email-templates/supabase/04-contrasena-modificada.html` | Tu contraseña de Universo Stampa fue modificada | 2 |
| 5 | Invitación de usuario | Supabase Auth | `email-templates/supabase/05-invitacion-de-usuario.html` | Te invitaron a Universo Stampa | 3 (ver §5) |
| 6 | Fin de promoción Pioneros | **Backend → Resend** | `email-templates/backend/06-aviso-fin-promocion-pioneros.html` (solo referencia) | Tu precio promocional de Universo Stampa cambia el *{fecha}* | no se pega en ningún panel |

Vista previa visual (desktop y móvil, con datos de ejemplo): abrir `email-templates/preview/index.html` en el navegador.

Fuente única del diseño: `src/lib/email/layout.ts` (estructura, colores, logo) y `src/lib/email/templates.ts` (textos). Los HTML se regeneran con:

```bash
node scripts/build-email-templates.mjs
```

Un test falla si los archivos de `email-templates/` no coinciden con el código. **No editar los HTML a mano.**

## 2. Recorrido de confirmación Free/Premium: por qué el botón es `{{ .ConfirmationURL }}`

Revisado en el código real (no en la documentación):

1. `/registro` llama `supabase.auth.signUp` con `emailRedirectTo = <origen>/auth/callback?next=<returnTo>` (`emailConfirmationRedirect`, `src/lib/auth/pending-verification.ts`). El `returnTo` es lo que el visitante quería hacer: vacío (`/`) para el alta Free, o el destino «Quiero Premium» (`isPremiumIntent`).
2. Supabase arma `{{ .ConfirmationURL }}` = `…/auth/v1/verify?token=…&type=signup&redirect_to=<ese emailRedirectTo>`. Por eso **la misma plantilla sirve para Free y Premium**: la diferencia viaja en `redirect_to`, no en el correo.
3. `/auth/callback` (PKCE) intercambia el `code`, canjea códigos de registro/referidos y redirige a `next`; el proxy decide el resto según la política de acceso real (Free, onboarding, `/sin-acceso`/checkout Premium).
4. Si el enlace se abre en otro navegador/dispositivo, el correo igual queda confirmado y la app manda a `/login?estado=email-confirmado`; si el enlace venció, a `/verificar-email?estado=enlace-vencido` (permite pedir otro). Los textos de las plantillas dicen exactamente eso, sin prometer más.

Alternativa descartada: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…`. La app **no tiene** ruta `/auth/confirm`; usarla exigiría crear una ruta nueva, cambiar el flujo PKCE y volver a probar Free/Premium. No se justifica para un cambio de diseño, así que **no se modificó ninguna autenticación ni redirección**.

Consecuencias de diseño:
- Las plantillas no mencionan Free ni Premium (el correo no lo sabe). Dicen «seguir con lo que estabas haciendo».
- No se usa `{{ .Data }}` (nombre del usuario): lo escribe quien se registra y no está garantizado que el motor de Supabase lo escape; no se mezcla con HTML de un correo oficial.
- Sin comentarios HTML/condicionales (Supabase puede eliminarlos) ni VML: el botón es una celda con `bgcolor`, funciona también en Outlook de escritorio.

## 3. Logo e imágenes

El único recurso externo es `https://universo-stampa.com/brand/universo-logotipo.png` (PNG oficial con transparencia, 1200×403, mostrado a 200 px). Es el mismo archivo que ya usa la app (`public/brand/`), generado desde `design/brand/*.svg`; **no se redibujó ni modificó ningún logo**. Gmail y Outlook no soportan SVG, por eso se usa el PNG.

- Verificado 2026-11-15: la URL responde `200 image/png` sin autenticación (la proxy de la app excluye `.png`).
- Pesa ~180 KB. Aceptable; si se quisiera aligerar habría que derivar un PNG más chico (nuevo asset, decisión de marca).
- El logo tiene letras blancas: va siempre sobre una celda oscura con `bgcolor` para que los modos oscuros automáticos no lo dejen ilegible.
- La imagen se descarga en el momento de abrir el correo: si se renombra/mueve `public/brand/universo-logotipo.png`, los correos ya enviados pierden el logo.

## 4. Dónde pegar cada plantilla en Supabase (nada de esto lo hizo Claude)

Proyecto de Supabase → **Authentication → Emails**.

**Previo (una vez):**
1. Pestaña **SMTP Settings**: debe estar activo el SMTP propio con `smtp.resend.com`, usuario `resend`, remitente `no-reply@universo-stampa.com`, nombre `Universo Stampa` (ver `RESEND_EMAIL_SETUP.md` §3). Los avisos de seguridad (plantilla 4) y volúmenes de producción lo necesitan.
2. **Authentication → URL Configuration**: *Site URL* = `https://universo-stampa.com` (la plantilla 4 arma su botón con `{{ .SiteURL }}`); *Redirect URLs* con `https://universo-stampa.com/auth/callback` (sin cambios).
3. En Resend → Domains → `universo-stampa.com`: **Click tracking y Open tracking desactivados** (es lo predeterminado). Con tracking, Resend reescribe los enlaces y puede romper o gastar el enlace de un solo uso.

**Pestaña Templates** (para cada fila: abrir la plantilla, pegar el asunto en *Subject* y el HTML completo en *Message body* → pestaña *Source*, reemplazando todo lo anterior, y **Save**):

| Plantilla en Supabase | Subject | Message body |
|---|---|---|
| **Confirm sign up** | contenido de `01-confirmacion-de-cuenta.subject.txt` | contenido de `01-confirmacion-de-cuenta.html` |
| **Reset password** | `02-recuperacion-de-contrasena.subject.txt` | `02-recuperacion-de-contrasena.html` |
| **Change email address** | `03-cambio-de-correo.subject.txt` | `03-cambio-de-correo.html` |
| **Security notifications → Password changed** (activar el interruptor del aviso) | `04-contrasena-modificada.subject.txt` | `04-contrasena-modificada.html` |
| **Invite user** (ver §5 antes de usarla) | `05-invitacion-de-usuario.subject.txt` | `05-invitacion-de-usuario.html` |

No tocar *Magic link* ni *Reauthentication* (la app no los usa). Si el panel de Supabase de ese proyecto tiene otra disposición de menús, el nombre de la plantilla es lo que cuenta.

**Variables que deben quedar intactas** (si el editor las rompe, el correo sale sin enlace): `{{ .ConfirmationURL }}` (plantillas 1, 2, 3, 5), `{{ .Email }}` (2, 3, 4, 5), `{{ .NewEmail }}` (3), `{{ .SiteURL }}` (4). Ningún otro `{{ … }}` aparece en los archivos.

### Pruebas manuales (con credenciales reales, a cargo del dueño)
1. **Free:** registrarse con un correo propio nuevo desde `/registro` → llega «Confirmá tu correo…» desde `no-reply@universo-stampa.com` → botón → entra a la app Free.
2. **Premium:** repetir desde un CTA «Quiero Premium» → el botón lleva a la activación Premium, no al inicio.
3. Abrir el enlace de confirmación en **otro navegador** → `/login?estado=email-confirmado` (no «error»).
4. `/recuperar-password` → llega «Restablecé tu contraseña» → botón en el mismo navegador → `/actualizar-password` → tras guardar llega «Tu contraseña fue modificada» (si activaste el aviso).
5. Reenviar desde `/verificar-email` y comprobar que el correo nuevo trae el mismo diseño.
6. Mirar cada correo en **Gmail web y app, Outlook (escritorio y web) y un teléfono**; revisar spam y que el logo cargue (en Gmail puede pedir «Mostrar imágenes»: con el texto alternativo «Universo Stampa» sigue legible).
7. Resend → **Logs**: *Delivered*.

## 5. Lo que NO está listo para usar (decisiones pendientes)

- **Invitación de usuario (5):** la app **no usa** `inviteUserByEmail`; solo existiría si el dueño invita desde el panel de Supabase. Ese enlace entra con tokens en el fragmento de la URL (flujo implícito) y `/auth/callback` solo entiende `code` (PKCE); además el invitado no tiene contraseña. No se verificó que el invitado llegue a una sesión útil. **No pegar esta plantilla hasta definir y probar el flujo de invitación** (decisión de producto/auth, fuera de este trabajo).
- **Cambio de correo (3):** la app no ofrece cambiar el correo (no hay `updateUser({ email })`); la plantilla queda lista por si se agrega. Con *Secure email change* activo, Supabase manda el mismo correo a las dos direcciones; el texto lo contempla.
- **Contraseña modificada (4):** es un aviso opt-in de Supabase; solo sale si se activa en el panel. Se dispara también tras recuperar la contraseña (el usuario recibe el enlace y luego el aviso: es lo esperado).
- **Aviso de Pioneros (6):** el backend ya usa este layout (`buildPriceChangeNotice` → Resend, el mismo `api.resend.com/emails` de siempre; texto plano y asunto sin cambios). Sigue **inactivo** hasta `PRICE_STEP_UP_ENABLED=true` y requiere `RESEND_API_KEY` + `PRICE_NOTICE_FROM` (ver `RESEND_EMAIL_SETUP.md` §4); `PRICE_NOTICE_FROM` debería ser una dirección de `universo-stampa.com`. El diseño nuevo llega a producción con el próximo deploy (no se hizo deploy ni push).
- Supabase solo envía HTML (sin versión de texto plano): puede restar un poco de reputación frente a Gmail. No se puede cambiar desde las plantillas.
- Algunos antivirus/«safe links» (p. ej. Outlook) abren el enlace antes que la persona y lo gastan: la app lo resuelve mostrando «El enlace venció o ya se usó» con la opción de pedir otro; es una limitación del enlace de un solo uso, no de las plantillas.
- Frase de pie «Aprendé, fabricá y vendé con impresión 3D.»: derivada de los tres dominios del producto (Academia / Mi Taller / Mi Negocio), no de un eslogan oficial. Cambiarla en `src/lib/email/layout.ts` si hay uno aprobado.
- No se incluyó un correo de soporte en el pie porque no hay uno definido en el repo.

## 6. Verificación hecha

- `node --test tests/email-templates.test.mjs tests/price-schedule-wiring.test.mjs tests/brand-identity.test.mjs`, `tsc --noEmit` y `eslint` sobre lo nuevo.
- Capturas en Edge (Chromium) a 700 px y 375 px: sin desbordamiento horizontal, botón a ancho completo en móvil, tarjetas «antes/después» apiladas.
- **No verificado:** render real en Gmail/Outlook/Apple Mail (esos clientes no se pueden emular aquí; se usaron tablas, estilos en línea y `bgcolor` por compatibilidad), envío real por Resend/Supabase y comportamiento del editor de Supabase con el HTML pegado.
