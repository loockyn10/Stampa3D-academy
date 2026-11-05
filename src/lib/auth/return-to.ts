const DEFAULT_RETURN_TO = "/";

/** Auth screens are never a destination: returning to them after signing in would loop. */
const NON_DESTINATION_PREFIXES = ["/login", "/registro", "/auth/", "/salir", "/verificar-email", "/recuperar-password"];

function isNonDestination(pathname: string): boolean {
  return NON_DESTINATION_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Internal destination for `returnTo` / `next`. Only same-origin absolute paths are accepted: protocol-relative URLs,
 * backslashes, other origins and auth screens fall back to "/". Never use the raw parameter for a redirect.
 */
export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_RETURN_TO;
  }

  try {
    const parsed = new URL(value, "https://stampa.local");
    if (parsed.origin !== "https://stampa.local") return DEFAULT_RETURN_TO;
    if (isNonDestination(parsed.pathname)) return DEFAULT_RETURN_TO;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}

/** `/login` keeping where the person wanted to go (omitted when it is the home). */
export function loginPathFor(pathname: string, search = ""): string {
  const destination = sanitizeReturnTo(`${pathname}${search}`);
  return destination === DEFAULT_RETURN_TO ? "/login" : `/login?returnTo=${encodeURIComponent(destination)}`;
}
