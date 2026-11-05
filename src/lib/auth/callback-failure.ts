/** Where an email link that could not be exchanged for a session sends the person (no Supabase text in the URL). */
export function callbackFailurePath(next: string): string {
  if (next === "/actualizar-password") return "/recuperar-password?estado=enlace-invalido";
  return next === "/"
    ? "/login?error=enlace-invalido"
    : `/login?error=enlace-invalido&returnTo=${encodeURIComponent(next)}`;
}
