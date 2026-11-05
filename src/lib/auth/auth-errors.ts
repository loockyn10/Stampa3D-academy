/**
 * Spanish, user-facing messages for Supabase Auth errors. Supabase messages are never shown as they are.
 * Messages never confirm whether an email is registered (except where Supabase's own response already does and
 * the wording stays neutral).
 */

export type AuthErrorContext = "login" | "signup" | "recovery" | "resend" | "update_password";

export interface AuthErrorLike {
  code?: string | null;
  status?: number | null;
  message?: string | null;
}

export interface FriendlyAuthError {
  message: string;
  /** The account exists but the email is not confirmed: offer /verificar-email. */
  needsEmailConfirmation?: boolean;
  /** Retry later (rate limit). */
  rateLimited?: boolean;
}

const GENERIC: Record<AuthErrorContext, string> = {
  login: "No pudimos iniciar sesión. Probá de nuevo en unos minutos.",
  signup: "No pudimos crear tu cuenta. Probá de nuevo en unos minutos.",
  recovery: "No pudimos enviar el correo de recuperación. Probá de nuevo en unos minutos.",
  resend: "No pudimos reenviar el correo. Probá de nuevo en unos minutos.",
  update_password: "No pudimos actualizar tu contraseña. Probá de nuevo.",
};

const RATE_LIMIT = "Hiciste varios intentos seguidos. Esperá un minuto y volvé a intentar.";

function classify(error: AuthErrorLike): string {
  const code = (error.code ?? "").toLowerCase();
  if (code) return code;
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("invalid login credentials")) return "invalid_credentials";
  if (message.includes("email not confirmed")) return "email_not_confirmed";
  if (message.includes("already registered") || message.includes("already been registered")) return "user_already_exists";
  if (message.includes("password should be") || message.includes("weak password") || message.includes("password is known")) return "weak_password";
  if (message.includes("for security purposes") || message.includes("rate limit") || error.status === 429) return "over_request_rate_limit";
  if (message.includes("unable to validate email") || message.includes("invalid format")) return "email_address_invalid";
  if (message.includes("signups not allowed") || message.includes("signup is disabled")) return "signup_disabled";
  if (message.includes("same as the old") || message.includes("different from the old")) return "same_password";
  if (message.includes("expired") || (message.includes("invalid") && message.includes("token"))) return "otp_expired";
  if (message.includes("failed to fetch") || message.includes("network")) return "network";
  return "unknown";
}

export function friendlyAuthError(error: AuthErrorLike | null | undefined, context: AuthErrorContext): FriendlyAuthError {
  if (!error) return { message: GENERIC[context] };
  switch (classify(error)) {
    case "invalid_credentials":
      return { message: "El email o la contraseña no son correctos." };
    case "email_not_confirmed":
      return { message: "Todavía no confirmaste tu email. Revisá tu correo o pedí un nuevo enlace.", needsEmailConfirmation: true };
    case "user_already_exists":
    case "email_exists":
      return { message: "No pudimos crear la cuenta con ese email. Si ya tenés una, iniciá sesión o recuperá tu contraseña." };
    case "weak_password":
      return { message: "La contraseña es muy débil. Usá al menos 6 caracteres y evitá contraseñas comunes." };
    case "same_password":
      return { message: "La nueva contraseña tiene que ser distinta de la anterior." };
    case "email_address_invalid":
      return { message: "Revisá el email: no parece válido." };
    case "signup_disabled":
      return { message: "El registro no está disponible en este momento." };
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
    case "over_sms_send_rate_limit":
      return { message: RATE_LIMIT, rateLimited: true };
    case "otp_expired":
    case "flow_state_expired":
    case "flow_state_not_found":
      return { message: "El enlace venció o ya se usó. Pedí uno nuevo." };
    case "network":
      return { message: "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo." };
    default:
      return { message: GENERIC[context] };
  }
}

/** Messages for the `?error=` / `?estado=` codes this app puts in URLs (never Supabase text). */
export const AUTH_NOTICE_MESSAGES: Record<string, string> = {
  "enlace-invalido":
    "No pudimos validar el enlace del correo. Si ya confirmaste tu email, iniciá sesión. Si el enlace venció, pedí uno nuevo.",
  "auth-callback-failed":
    "No pudimos validar el enlace del correo. Si ya confirmaste tu email, iniciá sesión. Si el enlace venció, pedí uno nuevo.",
  "sesion-requerida": "Iniciá sesión para continuar.",
};
