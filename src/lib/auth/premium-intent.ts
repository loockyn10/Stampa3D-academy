/**
 * Intención de contratar Premium. No hay un checkout directo: Premium se activa desde la cuenta, en /sin-acceso.
 * Los CTA «Quiero Premium» entran por /registro (o /login) con `returnTo=/sin-acceso`, el mecanismo de regreso que ya usan
 * el alta, la confirmación de email, el login y el proxy. Este módulo solo nombra ese destino y lo reconoce; no agrega estado,
 * cookies ni parámetros nuevos, y no inicia ningún cobro.
 */
export const PREMIUM_RETURN_TO = "/sin-acceso";

/** `true` cuando el destino al que se vuelve tras autenticarse es la pantalla de activación de Premium. */
export function isPremiumIntent(returnTo: string | null | undefined): boolean {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) return false;
  try {
    return new URL(returnTo, "https://stampa.local").pathname === PREMIUM_RETURN_TO;
  } catch {
    return false;
  }
}

/** `/registro` o `/login` conservando la intención de contratar. */
export function premiumAuthHref(screen: "registro" | "login", returnTo: string = PREMIUM_RETURN_TO): string {
  return `/${screen}?returnTo=${encodeURIComponent(returnTo)}`;
}
