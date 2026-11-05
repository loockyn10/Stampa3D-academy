import { loginPathFor, sanitizeReturnTo } from "@/lib/auth/return-to";

/**
 * Pure routing rules of the proxy (src/utils/supabase/middleware.ts). Access itself is decided by the canonical
 * policy (`resolveUserAccess`); this file only says where each kind of visitor may go. Feature flags are checked by
 * the proxy between the admin rule and the rest (they need an async read).
 */

export const LANDING_PATH = "/landing";
export const NO_ACCESS_PATH = "/sin-acceso";
export const ONBOARDING_PATH = "/onboarding";

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Reachable without a session. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith("/landing") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    matches(pathname, "/legal") ||
    pathname === "/calculadora" ||
    pathname === "/explorar-modelos" ||
    matches(pathname, "/tienda") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/registro") ||
    pathname.startsWith("/recuperar-password") ||
    pathname.startsWith("/actualizar-password") ||
    pathname.startsWith("/verificar-email") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/sin-acceso") ||
    pathname === "/no-disponible" ||
    pathname.startsWith("/pago/estado") ||
    pathname.startsWith("/api/mercadopago/webhook")
  );
}

/** Usable by an authenticated account WITHOUT Premium (Free): the free tools and the account itself. */
export function isFreeAccountPath(pathname: string): boolean {
  return (
    pathname === "/calculadora" ||
    pathname === "/perfil" ||
    pathname === ONBOARDING_PATH ||
    pathname.startsWith("/api/calculator/")
  );
}

/** Never redirected to the onboarding (APIs answer data, not pages; access screens must stay reachable). */
export function isOnboardingExempt(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  if (pathname === ONBOARDING_PATH || pathname.startsWith("/salir") || pathname.startsWith("/pago/estado")) return true;
  if (pathname.startsWith(NO_ACCESS_PATH)) return true;
  return isPublicPath(pathname) && pathname !== "/calculadora";
}

export type RouteDecision = { redirect: string } | null;

/** Visitor without a session. */
export function anonymousRoute(pathname: string, search: string): RouteDecision {
  if (pathname === "/") return { redirect: LANDING_PATH };
  if (isPublicPath(pathname) || pathname.startsWith("/api/mercadopago")) return null;
  return { redirect: loginPathFor(pathname, search) };
}

export function adminRoute(pathname: string, isAdmin: boolean): RouteDecision {
  return pathname.startsWith("/admin") && !isAdmin ? { redirect: "/" } : null;
}

/** Authenticated person, after the admin rule and the feature flags. */
export function authenticatedRoute(input: {
  pathname: string;
  search: string;
  returnToParam: string | null;
  hasAccess: boolean;
  needsOnboarding: boolean;
}): RouteDecision {
  const { pathname, hasAccess } = input;

  // Already signed in: go where they were heading (the next request applies permissions), else their home.
  if (pathname === "/login" || pathname === "/registro") {
    const requested = sanitizeReturnTo(input.returnToParam);
    return { redirect: requested !== "/" ? requested : hasAccess ? "/" : NO_ACCESS_PATH };
  }

  if (input.needsOnboarding && !isOnboardingExempt(pathname)) {
    const destination = sanitizeReturnTo(`${pathname}${input.search}`);
    return {
      redirect: destination === "/" ? ONBOARDING_PATH : `${ONBOARDING_PATH}?returnTo=${encodeURIComponent(destination)}`,
    };
  }

  if (
    !hasAccess &&
    !isPublicPath(pathname) &&
    !isFreeAccountPath(pathname) &&
    !pathname.startsWith("/api/mercadopago") &&
    !pathname.startsWith("/salir")
  ) {
    return { redirect: NO_ACCESS_PATH };
  }

  return null;
}
