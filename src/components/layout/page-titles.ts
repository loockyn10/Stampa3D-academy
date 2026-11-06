/**
 * Títulos de página y ruta "padre" del shell (header de escritorio y header móvil). Una sola fuente para que la
 * pantalla diga lo mismo en ambos tamaños y para que el celular pueda mostrar dónde está el usuario y volver.
 */

const EXACT_TITLES: Record<string, string> = {
  "/": "Inicio",
  "/academia": "Academia",
  "/cursos": "Cursos",
  "/talleres": "Talleres",
  "/sorteos": "Sorteos",
  "/calculadora": "Calculadora de costos",
  "/libreria-stl": "Librería STL",
  "/explorar-modelos": "Explorar Modelos",
  "/presupuestos": "Presupuestos",
  "/productos": "Productos",
  "/stock": "Stock",
  "/stampy": "Stampy IA",
  "/stampa-maker": "Stampa Maker",
  "/stampa-maker/carteles": "Carteles",
  "/stampa-maker/jarros": "Jarros",
  "/stampa-maker/lamparas": "Lámparas",
  "/stampa-maker/neon": "Neón",
  "/mi-taller": "Mi Taller",
  "/mi-taller/impresoras": "Impresoras",
  "/mi-taller/filamentos": "Filamentos",
  "/mi-taller/productos": "Productos",
  "/mi-taller/inventario": "Inventario",
  "/mi-negocio": "Mi Negocio",
  "/mi-negocio/catalogo": "Catálogo comercial",
  "/mi-negocio/inventario": "Inventario comercial",
  "/mi-negocio/venta-rapida": "Venta rápida",
  "/mi-negocio/ventas": "Ventas",
  "/mi-negocio/reposicion": "Reposición",
  "/mi-negocio/metricas": "Métricas",
  "/mi-negocio/pedidos": "Pedidos online",
  "/mi-negocio/clientes": "Clientes",
  "/mi-negocio/tienda": "Mi Tienda",
  "/perfil": "Mi perfil",
  "/configuracion": "Configuración",
  "/salir": "Sesión cerrada",
  "/telegram": "Telegram",
  "/whatsapp": "WhatsApp",
  "/youtube": "YouTube",
  "/instagram": "Instagram",
  "/redes": "Redes",
  "/canales": "Canales",
  "/no-disponible": "No disponible",
  "/admin": "Administración",
};

/** Rutas con detalle dinámico: el título lo da la sección. */
const SECTION_TITLES: [prefix: string, title: string][] = [
  ["/cursos/", "Curso"],
  ["/libreria-stl/", "Librería STL"],
  ["/stampa-maker/", "Stampa Maker"],
  ["/mi-negocio/", "Mi Negocio"],
  ["/mi-taller/", "Mi Taller"],
  ["/admin/", "Administración"],
];

/** Versiones cortas para el header móvil (poco ancho): solo las que lo necesitan. */
const COMPACT_TITLES: Record<string, string> = {
  "/calculadora": "Calculadora",
  "/mi-negocio/catalogo": "Catálogo",
  "/mi-negocio/inventario": "Inventario",
};

function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function getPageTitle(pathname: string, options: { compact?: boolean } = {}): string {
  const path = normalize(pathname);
  if (options.compact && COMPACT_TITLES[path]) return COMPACT_TITLES[path];
  if (EXACT_TITLES[path]) return EXACT_TITLES[path];
  return SECTION_TITLES.find(([prefix]) => path.startsWith(prefix))?.[1] ?? "";
}

/** Áreas con subpantallas: desde ellas el celular ofrece "volver" un nivel (la barra inferior solo llega al inicio del área). */
// /cursos/[id] queda fuera: el detalle puede ser un curso o un taller y su pantalla trae su propio «Volver».
const BACK_ROOTS = ["/mi-taller", "/mi-negocio", "/stampa-maker", "/libreria-stl", "/admin"];

export function getParentRoute(pathname: string): string | null {
  const path = normalize(pathname);
  const root = BACK_ROOTS.find((candidate) => path.startsWith(`${candidate}/`));
  if (!root) return null;
  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent.length >= root.length ? parent : root;
}
