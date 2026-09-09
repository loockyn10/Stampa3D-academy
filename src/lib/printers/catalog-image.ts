export const PRINTER_CATALOG_IMAGES_BUCKET = "printer-catalog-images";

export function normalizePrinterCatalogImagePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^\/+/, "");
  return normalized || null;
}
