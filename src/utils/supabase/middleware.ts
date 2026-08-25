import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { resolveUserAccess } from '@/lib/auth/user-access'

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
  ];

  const isPublicApiRoute = publicApiRoutes.some((route) =>
    pathname === route || pathname.startsWith(`${route}/`)
  );

  if (isPublicApiRoute) {
    return supabaseResponse;
  }

  // Define public routes
  const isPublicRoute = 
    pathname.startsWith('/landing') ||
    pathname.startsWith('/login') || 
    pathname.startsWith('/registro') || 
    pathname.startsWith('/recuperar-password') || 
    pathname.startsWith('/actualizar-password') || 
    pathname.startsWith('/verificar-email') || 
    pathname.startsWith('/auth') || 
    pathname.startsWith('/sin-acceso') || 
    pathname.startsWith('/pago/estado') || 
    pathname.startsWith('/api/mercadopago/webhook')

  // Helper to redirect while preserving refreshed cookies
  const redirectWithCookies = (toPath: string) => {
    const url = request.nextUrl.clone()
    url.pathname = toPath
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

  if (!user && !isPublicRoute && !pathname.startsWith('/api/mercadopago')) {
    return redirectWithCookies('/login')
  }

  if (user) {
    const { access } = await resolveUserAccess(supabase, user.id, {
      email: user.email ?? null,
    })
    const hasAccess = access.capabilities.accessPlatform

    // Admin routes protection
    if (pathname.startsWith('/admin') && !access.capabilities.accessAdmin) {
      return redirectWithCookies('/')
    }

    const isMpApiRoute = pathname.startsWith('/api/mercadopago')

    if (!hasAccess && !isPublicRoute && !isMpApiRoute && !pathname.startsWith('/salir')) {
      return redirectWithCookies('/sin-acceso')
    }

    // Redirect logged-in users away from login/registro
    if ((pathname === '/login' || pathname === '/registro') && user) {
        const dest = hasAccess ? '/' : '/sin-acceso'
        return redirectWithCookies(dest)
    }

    // Onboarding redirection rule
    const isExceptionRoute = pathname === '/onboarding' || pathname === '/salir' || pathname === '/pago/estado' || pathname === '/sin-acceso' || isPublicRoute;
    if (access.needsOnboarding && !isExceptionRoute) {
      return redirectWithCookies('/onboarding')
    }
  }

  return supabaseResponse
}
