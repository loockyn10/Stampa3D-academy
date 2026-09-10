import { getBusinessProductDisplayName } from "./catalog";

export interface BusinessSearchableItem {
  name: string;
  brand?: string | null;
  category?: string | null;
  sku?: string | null;
  barcode?: string | null;
}

export function normalizeBusinessSearch(value: unknown): string {
  return typeof value === "string"
    ? value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es-AR")
      .replace(/\s+/g, " ")
      .trim()
    : "";
}

export function matchesBusinessSearch(item: BusinessSearchableItem, query: string): boolean {
  const tokens = normalizeBusinessSearch(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;

  const haystack = normalizeBusinessSearch([
    getBusinessProductDisplayName({ name: item.name, brand: item.brand ?? null }),
    item.name,
    item.brand,
    item.category,
    item.sku,
    item.barcode,
  ].filter(Boolean).join(" "));

  return tokens.every((token) => haystack.includes(token));
}
