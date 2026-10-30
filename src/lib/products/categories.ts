/**
 * Categorías personalizadas de Mi Taller → Productos.
 * Helpers puros (sin acceso a datos) compartidos por la pantalla y las Server Actions.
 * La unicidad real vive en la base (`product_categories.name_key`); acá se replica la misma regla para dar feedback inmediato.
 */

export const PRODUCT_CATEGORY_NAME_MAX_LENGTH = 40;

/** Valores especiales del filtro; cualquier otro valor es el id de una categoría. */
export const PRODUCT_CATEGORY_FILTER_ALL = "all";
export const PRODUCT_CATEGORY_FILTER_NONE = "none";

export interface ProductCategory {
  id: string;
  name: string;
}

/** Recorta y colapsa espacios repetidos (misma normalización que el trigger de la base). */
export function normalizeProductCategoryName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** Clave de comparación: ignora mayúsculas y espacios (igual que `name_key`). */
export function productCategoryKey(value: unknown): string {
  return normalizeProductCategoryName(value).toLowerCase();
}

export function validateProductCategoryName(value: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const name = normalizeProductCategoryName(value);
  if (!name) return { ok: false, error: "Escribí un nombre para la categoría." };
  if (name.length > PRODUCT_CATEGORY_NAME_MAX_LENGTH) {
    return { ok: false, error: `El nombre puede tener hasta ${PRODUCT_CATEGORY_NAME_MAX_LENGTH} caracteres.` };
  }
  return { ok: true, name };
}

/** Categoría existente con el mismo nombre (ignorando mayúsculas/espacios), salvo `exceptId`. */
export function findDuplicateProductCategory<T extends ProductCategory>(
  categories: readonly T[],
  name: string,
  exceptId?: string,
): T | undefined {
  const key = productCategoryKey(name);
  return categories.find((category) => category.id !== exceptId && productCategoryKey(category.name) === key);
}

export function sortProductCategories<T extends ProductCategory>(categories: readonly T[]): T[] {
  return [...categories].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

type CategorizedProduct = { category_id?: string | null };

export function filterProductsByCategory<T extends CategorizedProduct>(products: readonly T[], filter: string): T[] {
  if (filter === PRODUCT_CATEGORY_FILTER_ALL) return [...products];
  if (filter === PRODUCT_CATEGORY_FILTER_NONE) return products.filter((product) => !product.category_id);
  return products.filter((product) => product.category_id === filter);
}

export function countProductsByCategory(products: readonly CategorizedProduct[]): {
  total: number;
  uncategorized: number;
  byCategory: Map<string, number>;
} {
  const byCategory = new Map<string, number>();
  let uncategorized = 0;
  for (const product of products) {
    if (product.category_id) byCategory.set(product.category_id, (byCategory.get(product.category_id) ?? 0) + 1);
    else uncategorized += 1;
  }
  return { total: products.length, uncategorized, byCategory };
}

/** Un filtro apunta a una categoría que ya no existe (borrada) → volver a "Todas". */
export function resolveProductCategoryFilter(filter: string, categories: readonly ProductCategory[]): string {
  if (filter === PRODUCT_CATEGORY_FILTER_ALL || filter === PRODUCT_CATEGORY_FILTER_NONE) return filter;
  return categories.some((category) => category.id === filter) ? filter : PRODUCT_CATEGORY_FILTER_ALL;
}
