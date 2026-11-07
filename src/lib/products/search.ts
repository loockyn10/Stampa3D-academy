/**
 * Búsqueda de Mi Taller → Productos. Pura y sin acceso a datos: filtra los productos ya cargados por nombre y/o
 * categoría, sin distinguir mayúsculas ni acentos, y se combina con el filtro de categoría de la pantalla.
 */

type SearchableProduct = { name?: string | null; category_id?: string | null };

export function normalizeProductSearchText(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
    : "";
}

/** Cada palabra de la búsqueda debe aparecer en el nombre o en la categoría del producto. */
export function filterProductsBySearch<T extends SearchableProduct>(
  products: readonly T[],
  query: string,
  categoryNameById: ReadonlyMap<string, string>,
): T[] {
  const tokens = normalizeProductSearchText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [...products];

  return products.filter((product) => {
    const categoryName = product.category_id ? categoryNameById.get(product.category_id) : "";
    const haystack = `${normalizeProductSearchText(product.name)} ${normalizeProductSearchText(categoryName)}`;
    return tokens.every((token) => haystack.includes(token));
  });
}
