/**
 * Registro central de funcionalidades de Universo Stampa (fuente única para el control de lanzamiento progresivo).
 *
 * El código define QUÉ funcionalidades existen y qué rutas controla cada una; la tabla
 * `platform_feature_flags` (Supabase) solo guarda el estado público que decide el Admin. Ninguna otra capa
 * (proxy, layouts, navegación, buscador, Server Actions, API routes, Stampy) debe hardcodear rutas ni ids:
 * todas consultan este módulo.
 */

export const FEATURE_IDS = [
  "academia",
  "stampy",
  "calculadora",
  "stampa_maker",
  "sorteos",
  "libreria_stl",
  "explorar_modelos",
  "mi_taller",
  "mi_negocio",
  "tienda_online",
  "redes",
  "canales",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export type FeatureGroup = "plataforma" | "areas" | "comunidad";

export interface FeatureDefinition {
  /** Identificador estable: es la clave persistida en `platform_feature_flags.feature_id`. No renombrar. */
  id: FeatureId;
  name: string;
  description: string;
  group: FeatureGroup;
  /** Prefijos de páginas controladas (la ruta exacta y todas sus subrutas). */
  routes: readonly string[];
  /** Prefijos de API routes controladas (se validan dentro de cada handler, no en el proxy). */
  apiRoutes?: readonly string[];
  /**
   * Estado cuando NO hay fila en la base ("todavía no configurada"). `true` en todas: desplegar el sistema no
   * restringe nada hasta que un Admin deshabilite una herramienta explícitamente.
   */
  defaultEnabled: boolean;
  /** Texto de apoyo en el panel de administración (qué incluye / qué efecto tiene). */
  adminNote?: string;
}

export const FEATURE_REGISTRY: readonly FeatureDefinition[] = [
  {
    id: "academia",
    name: "Academia",
    description: "Cursos, talleres y rutas de aprendizaje con su progreso.",
    group: "areas",
    routes: ["/academia", "/cursos", "/talleres"],
    defaultEnabled: true,
    adminNote: "Incluye cursos y talleres. El progreso y el XP de los usuarios no se modifican.",
  },
  {
    id: "stampy",
    name: "Stampy IA",
    description: "Asistente de IA: página, botón flotante y chat de las clases.",
    group: "plataforma",
    routes: ["/stampy"],
    defaultEnabled: true,
    adminNote: "Oculta el asistente y bloquea sus acciones para usuarios comunes.",
  },
  {
    id: "calculadora",
    name: "Calculadora",
    description: "Calculadora de costos y precios de impresión 3D.",
    group: "plataforma",
    routes: ["/calculadora"],
    apiRoutes: ["/api/calculator"],
    defaultEnabled: true,
    adminNote: "Es también la puerta de entrada gratuita: si se deshabilita, ni los visitantes ni los usuarios Free la ven.",
  },
  {
    id: "stampa_maker",
    name: "Stampa Maker",
    description: "Creador de carteles, neón y jarros 3D.",
    group: "plataforma",
    routes: ["/stampa-maker"],
    defaultEnabled: true,
    adminNote: "Jarros 3D sigue siendo solo para administradores aunque Stampa Maker esté habilitado.",
  },
  {
    id: "sorteos",
    name: "Sorteos",
    description: "Sorteos, chances y ganadores.",
    group: "plataforma",
    routes: ["/sorteos"],
    defaultEnabled: true,
  },
  {
    id: "libreria_stl",
    name: "Librería STL",
    description: "Biblioteca de modelos 3D con visor y descargas.",
    group: "plataforma",
    routes: ["/libreria-stl"],
    apiRoutes: ["/api/stl"],
    defaultEnabled: true,
    adminNote: "Incluye la vista previa y la descarga de archivos.",
  },
  {
    id: "explorar_modelos",
    name: "Explorar Modelos",
    description: "Búsqueda de modelos 3D en otras plataformas.",
    group: "plataforma",
    routes: ["/explorar-modelos"],
    apiRoutes: ["/api/model-search"],
    defaultEnabled: true,
  },
  {
    id: "mi_taller",
    name: "Mi Taller",
    description: "Impresoras, filamentos, productos e inventario de producción.",
    group: "areas",
    routes: ["/mi-taller", "/productos", "/stock"],
    defaultEnabled: true,
    adminNote: "Incluye las rutas heredadas /productos y /stock. Los datos del taller se conservan.",
  },
  {
    id: "mi_negocio",
    name: "Mi Negocio",
    description: "Catálogo comercial, ventas, clientes, pedidos, métricas y presupuestos.",
    group: "areas",
    routes: ["/mi-negocio", "/presupuestos"],
    apiRoutes: ["/api/business/mercadopago/connect", "/api/business/mercadopago/disconnect"],
    defaultEnabled: true,
    adminNote:
      "Incluye Presupuestos. Los webhooks y callbacks de Mercado Pago y la tienda pública no se bloquean para no cortar pagos en curso.",
  },
  {
    id: "tienda_online",
    name: "Tienda online pública",
    description: "Tiendas públicas de los vendedores (/tienda/…) y su checkout.",
    group: "areas",
    routes: ["/tienda"],
    apiRoutes: ["/api/business/storefront"],
    defaultEnabled: true,
    adminNote: "Deshabilitarla corta las compras de los clientes finales en todas las tiendas. Los pedidos existentes no se tocan.",
  },
  {
    id: "redes",
    name: "Redes",
    description: "Redes sociales de Stampa.",
    group: "comunidad",
    routes: ["/redes", "/instagram", "/youtube"],
    defaultEnabled: true,
  },
  {
    id: "canales",
    name: "Canales",
    description: "Comunidad en Telegram y WhatsApp.",
    group: "comunidad",
    routes: ["/canales", "/telegram", "/whatsapp"],
    defaultEnabled: true,
  },
];

/**
 * Rutas esenciales que NUNCA pueden quedar detrás de un toggle: autenticación, registro, recuperación,
 * perfil, cuenta, administración, pagos de membresía, onboarding y la propia pantalla de "no disponible".
 */
export const FEATURE_PROTECTED_ROUTES: readonly string[] = [
  "/",
  "/login",
  "/registro",
  "/recuperar-password",
  "/actualizar-password",
  "/verificar-email",
  "/auth",
  "/onboarding",
  "/perfil",
  "/configuracion",
  "/salir",
  "/sin-acceso",
  "/no-disponible",
  "/beta-access",
  "/pago",
  "/landing",
  "/admin",
  "/api/admin",
  "/api/mercadopago",
  "/api/business/mercadopago/callback",
  "/api/business/mercadopago/webhook",
  "/api/business/orders",
];

/** Ruta a la que se redirige cuando el acceso a una funcionalidad está deshabilitado. */
export const FEATURE_UNAVAILABLE_ROUTE = "/no-disponible";

const REGISTRY_BY_ID: ReadonlyMap<FeatureId, FeatureDefinition> = new Map(
  FEATURE_REGISTRY.map((feature) => [feature.id, feature]),
);

export function isFeatureId(value: unknown): value is FeatureId {
  return typeof value === "string" && (FEATURE_IDS as readonly string[]).includes(value);
}

export function getFeatureDefinition(id: FeatureId): FeatureDefinition {
  return REGISTRY_BY_ID.get(id)!;
}

function stripToPathname(path: string): string {
  const withoutHash = path.split("#")[0] ?? "";
  const withoutQuery = withoutHash.split("?")[0] ?? "";
  if (!withoutQuery.startsWith("/")) return "";
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedRoute(path: string): boolean {
  const pathname = stripToPathname(path);
  if (!pathname) return false;
  return FEATURE_PROTECTED_ROUTES.some((prefix) => matchesPrefix(pathname, prefix));
}

/**
 * Funcionalidad que controla una ruta (página o API). Acepta query/hash. Devuelve `null` para rutas protegidas,
 * rutas sin dueño y valores que no son rutas internas (p. ej. URLs absolutas). Gana el prefijo más largo.
 */
export function findFeatureForPath(path: string): FeatureDefinition | null {
  const pathname = stripToPathname(path);
  if (!pathname || isProtectedRoute(pathname)) return null;

  let best: { feature: FeatureDefinition; length: number } | null = null;
  for (const feature of FEATURE_REGISTRY) {
    for (const prefix of [...feature.routes, ...(feature.apiRoutes ?? [])]) {
      if (matchesPrefix(pathname, prefix) && (!best || prefix.length > best.length)) {
        best = { feature, length: prefix.length };
      }
    }
  }
  return best?.feature ?? null;
}
