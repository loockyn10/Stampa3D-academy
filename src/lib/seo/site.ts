/** Public origin used by robots.txt, sitemap.xml and metadata. */
export function siteOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env.NEXT_PUBLIC_APP_URL?.trim();
  if (raw) {
    try {
      const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      return url.origin;
    } catch {
      // fall through
    }
  }
  return "http://localhost:3000";
}

/** Public, indexable pages of V1.0 (feature-flagged tools are not listed; legal pages only when published). */
export const PUBLIC_INDEXABLE_PATHS = ["/landing", "/registro", "/login", "/calculadora"] as const;

/** Never indexed: private app, APIs, auth callbacks, payment status. */
export const ROBOTS_DISALLOW = [
  "/api/",
  "/admin",
  "/auth/",
  "/pago/",
  "/perfil",
  "/configuracion",
  "/onboarding",
  "/sin-acceso",
  "/verificar-email",
  "/actualizar-password",
] as const;
