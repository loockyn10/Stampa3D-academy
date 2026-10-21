import type { ActorRole } from "./env";

/**
 * Matriz de acceso por ruta, derivada de src/utils/supabase/middleware.ts (default-deny):
 *  - public: cualquiera (incluye anonymous).
 *  - account: requiere sesión pero NO acceso a plataforma (Free puede entrar): /calculadora(public), /perfil.
 *  - member: requiere acceso a plataforma (admin OR membresía vigente OR grant activo beta/manual/internal).
 *  - admin: requiere role=admin.
 * authenticated != paid: un Free autenticado NUNCA debe llegar a una ruta "member".
 */
export type RouteTier = "public" | "account" | "member" | "admin";

export interface RouteSpec {
  path: string;
  tier: RouteTier;
  /** Texto/heading que identifica la página cuando se puede ver (para no dar por bueno un redirect a otra pantalla). */
  marker?: RegExp;
  note?: string;
  /** Si la ruta redirige por next.config.ts aun con acceso (rutas legacy), el destino final esperado. */
  finalPath?: string;
}

export const ROUTES: RouteSpec[] = [
  // Públicas
  { path: "/landing", tier: "public" },
  { path: "/calculadora", tier: "public" },
  { path: "/explorar-modelos", tier: "public" },
  { path: "/login", tier: "public", marker: /Iniciar sesión/ },
  { path: "/registro", tier: "public", marker: /Crear cuenta/ },
  { path: "/recuperar-password", tier: "public" },
  { path: "/sin-acceso", tier: "public", note: "con sesión con acceso redirige a / (resolvePostAccessDestination)" },
  { path: "/pago/estado", tier: "public" },

  // Cuenta (Free permitido)
  { path: "/perfil", tier: "account" },

  // Plataforma (requiere acceso)
  { path: "/", tier: "member" },
  { path: "/stampy", tier: "member" },
  { path: "/academia", tier: "member" },
  { path: "/cursos", tier: "member" },
  { path: "/talleres", tier: "member" },
  { path: "/sorteos", tier: "member" },
  { path: "/libreria-stl", tier: "member" },
  { path: "/stampa-maker", tier: "member" },
  { path: "/stampa-maker/carteles", tier: "member" },
  { path: "/stampa-maker/neon", tier: "member" },
  { path: "/mi-taller", tier: "member" },
  { path: "/mi-taller/impresoras", tier: "member" },
  { path: "/mi-taller/filamentos", tier: "member" },
  { path: "/mi-taller/productos", tier: "member" },
  { path: "/mi-taller/inventario", tier: "member" },
  { path: "/mi-negocio", tier: "member" },
  { path: "/mi-negocio/catalogo", tier: "member" },
  { path: "/mi-negocio/venta-rapida", tier: "member" },
  { path: "/mi-negocio/ventas", tier: "member" },
  { path: "/mi-negocio/clientes", tier: "member" },
  { path: "/mi-negocio/reposicion", tier: "member" },
  { path: "/mi-negocio/metricas", tier: "member" },
  { path: "/mi-negocio/pedidos", tier: "member" },
  { path: "/mi-negocio/tienda", tier: "member" },
  { path: "/mi-negocio/inventario", tier: "member", finalPath: "/mi-negocio/catalogo", note: "redirect legacy (next.config)" },
  { path: "/productos", tier: "member", finalPath: "/mi-taller/productos", note: "redirect legacy (next.config)" },
  { path: "/stock", tier: "member", finalPath: "/mi-taller/inventario", note: "redirect legacy (next.config)" },
  { path: "/presupuestos", tier: "member" },
  { path: "/redes", tier: "member" },
  { path: "/canales", tier: "member" },
  { path: "/configuracion", tier: "member" },

  // Admin
  { path: "/admin", tier: "admin" },
  { path: "/admin/usuarios", tier: "admin" },
  { path: "/admin/cursos", tier: "admin" },
  { path: "/admin/roadmaps", tier: "admin" },
  { path: "/admin/sorteos", tier: "admin" },
  { path: "/admin/stl", tier: "admin" },
  { path: "/admin/stl/categorias", tier: "admin" },
  { path: "/admin/stl/modelos", tier: "admin" },
  { path: "/admin/stampy", tier: "admin" },
  { path: "/admin/stampy/documentos", tier: "admin" },
  { path: "/admin/stampy/contextos", tier: "admin" },
  { path: "/admin/transcripciones", tier: "admin" },
  { path: "/admin/membresia", tier: "admin" },
  { path: "/admin/codigos", tier: "admin" },
  { path: "/admin/insignias", tier: "admin" },
  { path: "/admin/impresoras", tier: "admin" },
  { path: "/admin/calculadora", tier: "admin" },
  { path: "/admin/calculadora/filamentos", tier: "admin" },
];

export type Outcome =
  | { kind: "renders" }
  | { kind: "redirect"; toPath: RegExp; label: string };

/** Qué debe ocurrir al visitar `route` como `actor`. Fuente: middleware.ts. */
export function expectedOutcome(actor: ActorRole, route: RouteSpec): Outcome {
  const hasPlatform = actor === "beta" || actor === "paid" || actor === "admin";
  const isAdmin = actor === "admin";
  // betaExpired / betaRevoked pierden acceso de plataforma: se comportan como Free.
  const isFreeLike = actor === "free" || actor === "betaExpired" || actor === "betaRevoked";

  if (route.tier === "public") {
    if (actor !== "anonymous" && (route.path === "/login" || route.path === "/registro")) {
      return hasPlatform
        ? { kind: "redirect", toPath: /^\/(onboarding)?$/, label: "/" }
        : { kind: "redirect", toPath: /^\/sin-acceso/, label: "/sin-acceso" };
    }
    if (hasPlatform && route.path === "/sin-acceso") {
      return { kind: "redirect", toPath: /^\/(onboarding)?$/, label: "/" };
    }
    return { kind: "renders" };
  }

  if (actor === "anonymous") return { kind: "redirect", toPath: /^\/login/, label: "/login" };

  if (route.tier === "account") return { kind: "renders" };

  if (route.tier === "member") {
    return hasPlatform ? { kind: "renders" } : { kind: "redirect", toPath: /^\/sin-acceso/, label: "/sin-acceso" };
  }

  // admin
  if (isAdmin) return { kind: "renders" };
  if (isFreeLike) return { kind: "redirect", toPath: /^\/sin-acceso/, label: "/sin-acceso (vía /)" };
  return { kind: "redirect", toPath: /^\/(onboarding)?$/, label: "/" };
}
