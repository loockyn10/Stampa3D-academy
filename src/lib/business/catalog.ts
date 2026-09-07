export type BusinessCatalogSourceType = "manufactured" | "resale";

export interface BusinessCatalogItem {
  id: string;
  user_id: string;
  source_type: BusinessCatalogSourceType;
  source_product_id: string | null;
  name: string;
  category: string;
  brand: string | null;
  description: string | null;
  purchase_cost: number | null;
  sale_price: number;
  resale_stock_quantity: number;
  sku: string | null;
  barcode: string | null;
  supplier: string | null;
  image_urls: string[];
  is_active: boolean;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkshopProductSummary {
  id: string;
  name: string;
  description: string | null;
  base_cost: number;
  sale_price: number;
  stock_quantity: number;
  image_url: string | null;
  is_active: boolean;
}

export function resolveBusinessCatalogStock(
  item: Pick<BusinessCatalogItem, "source_type" | "source_product_id" | "resale_stock_quantity">,
  products: readonly WorkshopProductSummary[],
): number | null {
  if (item.source_type === "resale") {
    return Math.max(0, Number(item.resale_stock_quantity) || 0);
  }

  const source = products.find((product) => product.id === item.source_product_id);
  return source ? Math.max(0, Number(source.stock_quantity) || 0) : null;
}

export function normalizeOptionalBusinessText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return normalized || null;
}

export function normalizeBusinessMoney(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(2));
}

export function normalizeBusinessStock(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return null;
  return parsed;
}
