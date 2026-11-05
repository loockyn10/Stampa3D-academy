import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { resolveUserAccess } from '@/lib/auth/user-access'
import { adminRoute, anonymousRoute, authenticatedRoute } from '@/lib/auth/route-policy'
import { FEATURE_UNAVAILABLE_ROUTE, findFeatureForPath } from '@/lib/features/registry'
import { loadFeatureFlagSnapshot } from '@/lib/features/loader'
import { resolveFeatureAccess } from '@/lib/features/resolve'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session if expired
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  const publicApiRoutes = [
    "/api/mercadopago/create-subscription",
    "/api/mercadopago/sync-subscription",
    "/api/mercadopago/webhook",
    "/api/business/mercadopago/callback",
    "/api/business/mercadopago/webhook",
    "/api/business/storefront",
    "/api/business/orders/expire",
    "/api/calculator/catalog",
    "/api/calculator/preferences",
    "/api/calculator/selections",
    "/api/model-search",
    // Descarga temporal para laminadores de escritorio (sin sesión): la autoriza el ticket firmado de la ruta.
    "/api/print-files/open",
  ];

  const isPublicApiRoute = publicApiRoutes.some((route) =>
    pathname === route || pathname.startsWith(`${route}/`)
  );

  if (isPublicApiRoute) {
    return supabaseResponse;
  }

  // Routing rules live in src/lib/auth/route-policy.ts (pure, tested).

  // Helper to redirect while preserving refreshed cookies
  const redirectWithCookies = (toPath: string) => {
    const url = request.nextUrl.clone()
    const destination = new URL(toPath, request.url)
    url.pathname = destination.pathname
    url.search = destination.search
    const response = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value, {
        path: cookie.path,
        domain: cookie.domain,
        maxAge: cookie.maxAge,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        httpOnly: cookie.httpOnly,
        expires: cookie.expires,
      })
    })
    return response
  }

  // Feature flags: solo páginas (las API routes validan su flag dentro de cada handler). Las rutas esenciales
  // (auth, perfil, admin, pagos de membresía…) no pertenecen a ninguna funcionalidad.
  const gatedFeature = pathname.startsWith('/api/') ? null : findFeatureForPath(pathname)
  const redirectIfFeatureUnavailable = async (isAdmin: boolean) => {
    if (!gatedFeature) return null
    const snapshot = await loadFeatureFlagSnapshot(supabase)
    if (resolveFeatureAccess(snapshot, gatedFeature.id, { isAdmin }).allowed) return null
    return redirectWithCookies(`${FEATURE_UNAVAILABLE_ROUTE}?herramienta=${gatedFeature.id}`)
  }

  if (!user) {
    // Visitors see the landing at "/" and keep their destination when a page needs a session.
    const decision = anonymousRoute(pathname, request.nextUrl.search)
    if (decision) return redirectWithCookies(decision.redirect)
    // Rutas públicas controladas (Calculadora, Explorar Modelos, tiendas): un visitante nunca es administrador.
    const unavailable = await redirectIfFeatureUnavailable(false)
    if (unavailable) return unavailable
    return supabaseResponse
  }

  const { access, error: accessError } = await resolveUserAccess(supabase, user.id, {
    email: user.email ?? null,
  })

  // Admin routes protection
  const adminDecision = adminRoute(pathname, access.capabilities.accessAdmin)
  if (adminDecision) return redirectWithCookies(adminDecision.redirect)

  // Funcionalidad deshabilitada: se evalúa antes del gate de membresía para que un usuario Free no reciba una
  // invitación a pagar por algo que nadie puede usar todavía. Los administradores conservan el acceso.
  const unavailable = await redirectIfFeatureUnavailable(access.capabilities.accessAdmin)
  if (unavailable) return unavailable

  const decision = authenticatedRoute({
    pathname,
    search: request.nextUrl.search,
    returnToParam: request.nextUrl.searchParams.get('returnTo'),
    hasAccess: access.capabilities.accessPlatform,
    // If the profile could not be read, never force the onboarding (it would fail the same way).
    needsOnboarding: !accessError && access.needsOnboarding,
  })
  if (decision) return redirectWithCookies(decision.redirect)

  return supabaseResponse
}
