/**
 * Why an e-mail link could not be turned into a session in /auth/callback:
 * - `confirmed_elsewhere`: Supabase verified the link (it sent a `code`) but this browser cannot exchange it (PKCE
 *   verifier lives in the browser where the account was created, or the code was already used). The e-mail IS
 *   confirmed: the person only has to sign in.
 * - `link_expired`: Supabase rejected the link itself (expired / already used): ask for a new one.
 * - `invalid`: anything else (no code, unknown error).
 */
export type CallbackFailureReason = "confirmed_elsewhere" | "link_expired" | "invalid";

function withReturnTo(path: string, next: string): string {
  return next === "/" ? path : `${path}${path.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(next)}`;
}

/** Where an e-mail link that could not be exchanged for a session sends the person (no Supabase text in the URL). */
export function callbackFailurePath(next: string, reason: CallbackFailureReason = "invalid"): string {
  if (next === "/actualizar-password") return "/recuperar-password?estado=enlace-invalido";
  if (reason === "confirmed_elsewhere") return withReturnTo("/login?estado=email-confirmado", next);
  if (reason === "link_expired") return withReturnTo("/verificar-email?estado=enlace-vencido", next);
  return withReturnTo("/login?error=enlace-invalido", next);
}
