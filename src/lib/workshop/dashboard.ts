import { getProductPricingStatus } from "@/lib/products/pricing-status";

/**
 * Resumen de Mi Taller (solo lectura). Todas las cifras salen de filas reales del usuario:
 * no hay umbrales de "stock bajo" inventados ni contadores paralelos de stock.
 *
 * - Unidades terminadas = suma de `products.stock_quantity` de productos activos (misma fuente que Inventario).
 * - Piezas para armar = unidades que se podrían armar con el stock de piezas (misma fórmula que el botón "Armar"
 *   de Inventario); NO se suman a las terminadas.
 * - Costos desactualizados = `getProductPricingStatus` (misma regla que Mi Taller → Productos).
 */

export interface WorkshopProductRow {
  id: string;
  name?: string | null;
  image_url?: string | null;
  stock_quantity?: number | null;
  sale_price?: number | null;
  is_active?: boolean | null;
  [key: string]: unknown;
}

export interface WorkshopComponentRow {
  id: string;
  product_id: string;
  name?: string | null;
  stock_quantity?: number | null;
  quantity_per_product?: number | null;
  is_active?: boolean | null;
}

export interface WorkshopFilamentRow {
  id: string;
  name?: string | null;
  filament_type?: string | null;
  color?: string | null;
  color_hex?: string | null;
  remaining_grams?: number | null;
  total_grams?: number | null;
  is_active?: boolean | null;
  [key: string]: unknown;
}

export interface WorkshopAttentionProduct {
  id: string;
  name: string;
  imageUrl: string | null;
  stockQuantity: number;
  /** Unidades que se podrían armar con piezas en stock (solo productos por partes). */
  assemblableUnits: number | null;
  reasons: string[];
  outOfStock: boolean;
  needsRecalculation: boolean;
}

export interface WorkshopMaterialSummary {
  material: string;
  grams: number;
  spools: number;
}

export interface WorkshopSummary {
  activeProducts: number;
  finishedUnits: number;
  outOfStockProducts: number;
  needsRecalculationProducts: number;
  /** Productos por partes con piezas suficientes para armar al menos una unidad. */
  assemblableProducts: number;
  assemblableUnits: number;
  activeSpools: number;
  emptySpools: number;
  availableGrams: number;
  materials: WorkshopMaterialSummary[];
  emptySpoolList: Array<{ id: string; name: string; material: string | null; colorHex: string | null }>;
  attentionProducts: WorkshopAttentionProduct[];
  printers: number;
}

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Igual que Inventario: un producto es "por partes" si tiene más de un componente o uno que no es "Producto completo". */
export function isAssembledFromParts(components: WorkshopComponentRow[]): boolean {
  return components.length > 1 || (components.length === 1 && components[0].name !== "Producto completo");
}

/** Igual que el botón "Armar" de Inventario: mínimo de floor(stock pieza / cantidad por producto). */
export function maxAssemblableUnits(components: WorkshopComponentRow[]): number {
  if (components.length === 0) return 0;
  const units = Math.min(
    ...components.map((component) => Math.floor(toNumber(component.stock_quantity) / (toNumber(component.quantity_per_product) || 1))),
  );
  return Number.isFinite(units) && units > 0 ? units : 0;
}

export function buildWorkshopSummary({
  products,
  components,
  filaments,
  printers,
  productTypes,
  attentionLimit = 6,
}: {
  products: WorkshopProductRow[];
  components: WorkshopComponentRow[];
  /** Todas las bobinas del usuario (también inactivas): el estado de precio las necesita para detectar materiales dados de baja. */
  filaments: WorkshopFilamentRow[];
  printers: Array<Record<string, unknown>>;
  productTypes: Array<Record<string, unknown>>;
  attentionLimit?: number;
}): WorkshopSummary {
  const activeProducts = products.filter((product) => product.is_active !== false);
  const componentsByProduct = new Map<string, WorkshopComponentRow[]>();
  for (const component of components) {
    if (component.is_active === false) continue;
    const list = componentsByProduct.get(component.product_id) ?? [];
    list.push(component);
    componentsByProduct.set(component.product_id, list);
  }

  let finishedUnits = 0;
  let outOfStockProducts = 0;
  let needsRecalculationProducts = 0;
  let assemblableProducts = 0;
  let assemblableUnits = 0;
  const attention: WorkshopAttentionProduct[] = [];

  for (const product of activeProducts) {
    const stock = Math.max(0, toNumber(product.stock_quantity));
    finishedUnits += stock;
    const productComponents = componentsByProduct.get(product.id) ?? [];
    const parts = isAssembledFromParts(productComponents);
    const buildable = parts ? maxAssemblableUnits(productComponents) : null;
    if (buildable && buildable > 0) {
      assemblableProducts += 1;
      assemblableUnits += buildable;
    }

    const pricing = getProductPricingStatus(product, filaments, printers, productTypes);
    const outOfStock = stock <= 0;
    if (outOfStock) outOfStockProducts += 1;
    if (pricing.needsRecalculation) needsRecalculationProducts += 1;

    if (outOfStock || pricing.needsRecalculation) {
      attention.push({
        id: product.id,
        name: String(product.name || "Producto sin nombre"),
        imageUrl: typeof product.image_url === "string" && product.image_url ? product.image_url : null,
        stockQuantity: stock,
        assemblableUnits: buildable,
        reasons: pricing.reasons,
        outOfStock,
        needsRecalculation: pricing.needsRecalculation,
      });
    }
  }

  // Primero los agotados que NO se pueden armar con piezas (requieren producir), luego el resto.
  attention.sort((a, b) => {
    const score = (item: WorkshopAttentionProduct) =>
      (item.outOfStock ? 2 : 0) + (item.outOfStock && !(item.assemblableUnits && item.assemblableUnits > 0) ? 1 : 0) + (item.needsRecalculation ? 0.5 : 0);
    return score(b) - score(a) || a.name.localeCompare(b.name, "es");
  });

  const activeSpools = filaments.filter((filament) => filament.is_active !== false);
  const empty = activeSpools.filter((filament) => toNumber(filament.remaining_grams) <= 0);
  const materialMap = new Map<string, WorkshopMaterialSummary>();
  let availableGrams = 0;
  for (const spool of activeSpools) {
    const grams = Math.max(0, toNumber(spool.remaining_grams));
    availableGrams += grams;
    const material = String(spool.filament_type || "Sin material").trim().toUpperCase() || "SIN MATERIAL";
    const entry = materialMap.get(material) ?? { material, grams: 0, spools: 0 };
    entry.grams += grams;
    entry.spools += 1;
    materialMap.set(material, entry);
  }

  return {
    activeProducts: activeProducts.length,
    finishedUnits,
    outOfStockProducts,
    needsRecalculationProducts,
    assemblableProducts,
    assemblableUnits,
    activeSpools: activeSpools.length,
    emptySpools: empty.length,
    availableGrams,
    materials: Array.from(materialMap.values()).sort((a, b) => b.grams - a.grams),
    emptySpoolList: empty.slice(0, attentionLimit).map((spool) => ({
      id: spool.id,
      name: String(spool.name || "Bobina"),
      material: spool.filament_type ? String(spool.filament_type) : null,
      colorHex: typeof spool.color_hex === "string" && /^#[0-9a-f]{6}$/i.test(spool.color_hex) ? spool.color_hex : null,
    })),
    attentionProducts: attention.slice(0, attentionLimit),
    printers: printers.length,
  };
}

export function formatGrams(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} kg`;
  return `${Math.round(grams).toLocaleString("es-AR")} g`;
}
