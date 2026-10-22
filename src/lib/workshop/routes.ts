/**
 * Rutas de Mi Taller. Las subsecciones (y sus deep links de Stampy) no cambian; el Dashboard vive en /mi-taller.
 * Los parámetros nuevos (`estado`, `action=registrar-produccion`) solo filtran o abren flujos existentes.
 */
export const WORKSHOP_INVENTORY_OUT_OF_STOCK = "sin-stock";
export const WORKSHOP_PRODUCTS_NEEDS_RECALCULATION = "recalcular";
export const WORKSHOP_REGISTER_PRODUCTION_ACTION = "registrar-produccion";

export const WORKSHOP_ROUTES = {
  dashboard: "/mi-taller",
  inventory: "/mi-taller/inventario",
  inventoryOutOfStock: `/mi-taller/inventario?estado=${WORKSHOP_INVENTORY_OUT_OF_STOCK}`,
  registerProduction: `/mi-taller/inventario?action=${WORKSHOP_REGISTER_PRODUCTION_ACTION}`,
  products: "/mi-taller/productos",
  productsNeedingRecalculation: `/mi-taller/productos?estado=${WORKSHOP_PRODUCTS_NEEDS_RECALCULATION}`,
  newProduct: "/mi-taller/productos?action=new",
  editProduct: (productId: string) => `/mi-taller/productos?edit=${encodeURIComponent(productId)}`,
  filaments: "/mi-taller/filamentos",
  printers: "/mi-taller/impresoras",
} as const;

export interface WorkshopSection {
  href: string;
  label: string;
  /** El Dashboard solo se activa con la ruta exacta; las subsecciones también con sus subrutas. */
  exact?: boolean;
}

/** Orden definitivo de las pestañas de Mi Taller. */
export const WORKSHOP_SECTIONS: readonly WorkshopSection[] = [
  { href: WORKSHOP_ROUTES.dashboard, label: "Dashboard", exact: true },
  { href: WORKSHOP_ROUTES.inventory, label: "Inventario" },
  { href: WORKSHOP_ROUTES.products, label: "Productos" },
  { href: WORKSHOP_ROUTES.filaments, label: "Filamentos" },
  { href: WORKSHOP_ROUTES.printers, label: "Impresoras" },
];

export function isWorkshopSectionActive(section: WorkshopSection, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (section.exact) return path === section.href;
  return path === section.href || path.startsWith(`${section.href}/`);
}
