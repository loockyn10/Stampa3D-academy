import { EMAIL_BRAND, escapeHtml, noteBox, paragraph, renderEmailLayout, smallPrint, urlFallback, compareCard } from "./layout";

/**
 * Plantillas oficiales de correo de Universo Stampa.
 *
 * - Las de autenticación se pegan en el panel de Supabase (Authentication → Emails). Usan SOLO variables oficiales de
 *   Supabase, tal cual las documenta: el enlace de acción es `{{ .ConfirmationURL }}` (confirmación, cambio de correo,
 *   invitación; `emailRedirectTo` y PKCE dependen de ese enlace, ver docs/EMAIL_TEMPLATES_GUIDE.md §2). La EXCEPCIÓN es la
 *   recuperación de contraseña: usa `RECOVERY_ACTION_URL` (`/auth/confirm?token_hash=…`, ver docs/PASSWORD_RECOVERY.md).
 * - No se usa `{{ .Data }}` (metadata del usuario): es texto escrito por quien se registra y no sabemos si el motor de
 *   Supabase lo escapa, así que no se mezcla con HTML de un correo «oficial».
 * - El aviso de Pioneros lo envía el backend con Resend (src/lib/mercadopago/price-notice.ts); comparte este layout.
 *
 * Los archivos de `email-templates/` se generan con `node scripts/build-email-templates.mjs`; un test comprueba que no
 * se desincronicen de este código.
 */

/** Variables que Supabase documenta para sus plantillas (https://supabase.com/docs/guides/auth/auth-email-templates). */
export const SUPABASE_TEMPLATE_VARIABLES = [
  "{{ .ConfirmationURL }}",
  "{{ .Token }}",
  "{{ .TokenHash }}",
  "{{ .SiteURL }}",
  "{{ .Email }}",
  "{{ .NewEmail }}",
  "{{ .OldEmail }}",
  "{{ .RedirectTo }}",
] as const;

export type AuthEmailTemplateId = "confirm-signup" | "reset-password" | "change-email" | "password-changed" | "invite";

export interface AuthEmailTemplate {
  id: AuthEmailTemplateId;
  /** Nombre del archivo dentro de `email-templates/supabase/`. */
  file: string;
  /** Prioridad de puesta en producción (1 = primero). */
  priority: number;
  /** Dónde se pega en el panel de Supabase. */
  slot: string;
  subject: string;
  html: string;
  /** Variables de Supabase que la plantilla DEBE conservar. */
  requiredVariables: string[];
}

const ACTION_URL = "{{ .ConfirmationURL }}";

/**
 * Recovery link (token_hash flow, https://supabase.com/docs/guides/auth/server-side/email-based-auth-with-pkce-flow-for-ssr):
 * it points straight to OUR page, with the production domain fixed, so it depends neither on Supabase's Site URL nor on
 * its Redirect URLs list (a mismatch there sent recoveries to the landing), and it needs no PKCE verifier, so it opens
 * from any browser or device. The page only consumes the token when the person presses a button (scanner-safe).
 */
export const RECOVERY_ACTION_URL = `${EMAIL_BRAND.siteUrl}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`;

const ignoreIfNotYou = (what: string) =>
  smallPrint(`Si no fuiste vos, ignorá este correo: ${what}`);

function confirmSignup(): string {
  return renderEmailLayout({
    title: "Confirmá tu correo - Universo Stampa",
    preheader: "Un clic y tu cuenta de Universo Stampa queda activa.",
    eyebrow: "Confirmación de cuenta",
    heading: "Confirmá tu correo electrónico",
    bodyHtml:
      paragraph("Te damos la bienvenida a Universo Stampa. Para activar tu cuenta y seguir con lo que estabas haciendo, confirmá que esta dirección de correo es tuya.") +
      noteBox("¿Abriste este correo en otro dispositivo o navegador? No pasa nada: tu correo queda confirmado igual y solo tenés que iniciar sesión."),
    cta: { label: "Confirmar mi correo", href: ACTION_URL },
    afterCtaHtml:
      urlFallback(ACTION_URL) +
      smallPrint("Por seguridad, el enlace tiene un tiempo de validez limitado. Si venció, al abrirlo te vamos a ofrecer pedir uno nuevo.") +
      ignoreIfNotYou("no se activa ninguna cuenta sin tu confirmación."),
  });
}

function resetPassword(): string {
  return renderEmailLayout({
    title: "Restablecé tu contraseña - Universo Stampa",
    preheader: "Creá una contraseña nueva para tu cuenta de Universo Stampa.",
    eyebrow: "Seguridad de la cuenta",
    heading: "Restablecé tu contraseña",
    bodyHtml:
      paragraph("Recibimos una solicitud para restablecer la contraseña de la cuenta asociada a <strong style=\"color:#f4f4f5;\">{{ .Email }}</strong>.") +
      paragraph("Tocá el botón para elegir una contraseña nueva.") +
      noteBox("Podés abrir el enlace desde cualquier dispositivo o navegador. Al tocarlo vas a ver un botón para continuar y elegir tu contraseña nueva."),
    cta: { label: "Crear contraseña nueva", href: RECOVERY_ACTION_URL },
    afterCtaHtml:
      urlFallback(RECOVERY_ACTION_URL) +
      smallPrint("Por seguridad, el enlace tiene un tiempo de validez limitado y se puede usar una sola vez.") +
      ignoreIfNotYou("tu contraseña actual sigue siendo la misma y nadie puede cambiarla sin este enlace."),
  });
}

function changeEmail(): string {
  return renderEmailLayout({
    title: "Confirmá el cambio de correo - Universo Stampa",
    preheader: "Confirmá la nueva dirección de correo de tu cuenta.",
    eyebrow: "Seguridad de la cuenta",
    heading: "Confirmá el cambio de correo",
    bodyHtml:
      paragraph("Recibimos una solicitud para cambiar el correo de tu cuenta de Universo Stampa.") +
      compareCard({
        fromLabel: "Correo actual",
        fromValue: "<span style=\"font-size:16px;line-height:22px;word-break:break-all;\">{{ .Email }}</span>",
        toLabel: "Correo nuevo",
        toValue: "<span style=\"font-size:16px;line-height:22px;word-break:break-all;\">{{ .NewEmail }}</span>",
      }) +
      noteBox("Hasta que lo confirmes, seguís ingresando con tu correo actual. Según la configuración de seguridad, puede que recibas un correo de confirmación en cada dirección: el cambio se completa cuando se confirman."),
    cta: { label: "Confirmar el cambio", href: ACTION_URL },
    afterCtaHtml:
      urlFallback(ACTION_URL) +
      ignoreIfNotYou("tu correo no cambia sin esta confirmación. Si no pediste el cambio, te recomendamos restablecer tu contraseña."),
  });
}

function passwordChanged(): string {
  return renderEmailLayout({
    title: "Tu contraseña fue modificada - Universo Stampa",
    preheader: "Te avisamos que la contraseña de tu cuenta se modificó.",
    eyebrow: "Aviso de seguridad",
    heading: "Tu contraseña fue modificada",
    bodyHtml:
      paragraph("Te avisamos que la contraseña de la cuenta <strong style=\"color:#f4f4f5;\">{{ .Email }}</strong> se modificó recientemente.") +
      paragraph("Si fuiste vos, no tenés que hacer nada.") +
      noteBox("<strong style=\"color:#f4f4f5;\">¿No reconocés este cambio?</strong> Restablecé tu contraseña ahora mismo para volver a proteger tu cuenta."),
    cta: { label: "Restablecer mi contraseña", href: "{{ .SiteURL }}/recuperar-password" },
    afterCtaHtml: smallPrint("Este aviso es solo informativo: no necesitás confirmar nada."),
  });
}

function invite(): string {
  return renderEmailLayout({
    title: "Te invitaron a Universo Stampa",
    preheader: "Aceptá la invitación y creá tu cuenta en Universo Stampa.",
    eyebrow: "Invitación",
    heading: "Te invitaron a Universo Stampa",
    bodyHtml:
      paragraph("Alguien del equipo de Universo Stampa te invitó a crear tu cuenta. Tocá el botón para aceptar la invitación y empezar.") +
      noteBox("La invitación es personal y está asociada a <strong style=\"color:#f4f4f5;\">{{ .Email }}</strong>."),
    cta: { label: "Aceptar invitación", href: ACTION_URL },
    afterCtaHtml:
      urlFallback(ACTION_URL) +
      smallPrint("Por seguridad, el enlace tiene un tiempo de validez limitado.") +
      ignoreIfNotYou("no se crea ninguna cuenta si no aceptás la invitación."),
  });
}

export const AUTH_EMAIL_TEMPLATES: AuthEmailTemplate[] = [
  {
    id: "confirm-signup",
    file: "01-confirmacion-de-cuenta.html",
    priority: 1,
    slot: "Authentication → Emails → Templates → Confirm sign up",
    subject: "Confirmá tu correo para activar tu cuenta de Universo Stampa",
    html: confirmSignup(),
    requiredVariables: ["{{ .ConfirmationURL }}"],
  },
  {
    id: "reset-password",
    file: "02-recuperacion-de-contrasena.html",
    priority: 1,
    slot: "Authentication → Emails → Templates → Reset password",
    subject: "Restablecé tu contraseña de Universo Stampa",
    html: resetPassword(),
    requiredVariables: ["{{ .TokenHash }}", "{{ .Email }}"],
  },
  {
    id: "change-email",
    file: "03-cambio-de-correo.html",
    priority: 2,
    slot: "Authentication → Emails → Templates → Change email address",
    subject: "Confirmá el cambio de correo de tu cuenta de Universo Stampa",
    html: changeEmail(),
    requiredVariables: ["{{ .ConfirmationURL }}", "{{ .Email }}", "{{ .NewEmail }}"],
  },
  {
    id: "password-changed",
    file: "04-contrasena-modificada.html",
    priority: 2,
    slot: "Authentication → Emails → Templates → Security notifications → Password changed (hay que activar el aviso)",
    subject: "Tu contraseña de Universo Stampa fue modificada",
    html: passwordChanged(),
    requiredVariables: ["{{ .Email }}", "{{ .SiteURL }}"],
  },
  {
    id: "invite",
    file: "05-invitacion-de-usuario.html",
    priority: 3,
    slot: "Authentication → Emails → Templates → Invite user",
    subject: "Te invitaron a Universo Stampa",
    html: invite(),
    requiredVariables: ["{{ .ConfirmationURL }}", "{{ .Email }}"],
  },
];

export interface PriceChangeNoticeHtmlInput {
  promoPrice: string;
  postPrice: string;
  date: string;
  /** URL absoluta de la gestión de membresía; sin ella no se muestra el botón. */
  manageUrl: string | null;
}

/**
 * HTML del aviso de fin de promoción (Pioneros). El texto conserva las mismas afirmaciones que la versión de texto
 * plano de `buildPriceChangeNotice` (precio promocional, precio aceptado al contratar, fecha exacta, cancelación).
 * Todos los valores se escapan aquí.
 */
export function renderPriceChangeNoticeHtml(input: PriceChangeNoticeHtmlInput): string {
  const promo = escapeHtml(input.promoPrice);
  const post = escapeHtml(input.postPrice);
  const date = escapeHtml(input.date);
  const manage = input.manageUrl ? escapeHtml(input.manageUrl) : null;
  return renderEmailLayout({
    title: "Tu precio promocional cambia - Universo Stampa",
    preheader: `Desde tu cobro del ${date} pasás a pagar ${post} por mes. No tenés que hacer nada para seguir.`,
    eyebrow: "Edición Pioneros · Aviso de tu membresía",
    heading: "Tu precio promocional está por terminar",
    bodyHtml:
      paragraph(`Hola,`) +
      paragraph(`Tu membresía Premium de Universo Stampa tiene un precio promocional que se mantiene durante tus primeros meses de suscripción.`) +
      compareCard({ fromLabel: "Hoy pagás", fromValue: `${promo}<span style="font-size:14px;font-weight:400;color:#a1a1aa;"> / mes</span>`, toLabel: `Desde el ${date}`, toValue: `${post}<span style="font-size:14px;font-weight:400;color:#a1a1aa;"> / mes</span>` }) +
      paragraph(`A partir de tu cobro del <strong style="color:#f4f4f5;">${date}</strong> pasarás a pagar ${post} por mes, el precio que aceptaste al contratar. Mercado Pago aplicará el nuevo importe automáticamente: no tenés que hacer nada para seguir con tu membresía.`) +
      noteBox(`Si no querés continuar con el nuevo importe, podés cancelar tu suscripción antes de esa fecha. Conservás el acceso hasta el fin del período que ya pagaste.`),
    cta: manage ? { label: "Ver mi membresía", href: manage } : undefined,
    afterCtaHtml: manage ? urlFallback(manage) : "",
  });
}
