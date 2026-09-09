import {
  getBusinessProductDisplayName,
  resolveBusinessCatalogStock,
  type BusinessCatalogItem,
  type WorkshopProductSummary,
} from "./catalog";
import { normalizeBarcode } from "../barcode/hid-scanner";

export interface BusinessCartItem {
  catalogItemId: string;
  name: string;
  sourceType: "manufactured" | "resale";
  unitPrice: number;
  quantity: number;
  availableStock: number;
  sku: string | null;
  barcode: string | null;
  showroomStock?: number;
  warehouseStock?: number;
}

export type CartMutationResult =
  | { success: true; cart: BusinessCartItem[] }
  | { success: false; cart: BusinessCartItem[]; error: string };

export function toBusinessCartItem(
  item: BusinessCatalogItem,
  products: readonly WorkshopProductSummary[],
  locationStock?: { showroom: number; warehouse: number } | null,
): BusinessCartItem | null {
  const showroomStock = locationStock ? Math.max(0, locationStock.showroom) : 0;
  const warehouseStock = locationStock ? Math.max(0, locationStock.warehouse) : 0;
  const stock = locationStock ? showroomStock + warehouseStock : resolveBusinessCatalogStock(item, products);
  if (!item.is_active || stock === null) return null;
  return {
    catalogItemId: item.id,
    name: getBusinessProductDisplayName(item),
    sourceType: item.source_type,
    unitPrice: Math.max(0, Number(item.sale_price) || 0),
    quantity: 1,
    availableStock: stock,
    sku: item.sku,
    barcode: item.barcode,
    ...(locationStock ? { showroomStock, warehouseStock } : {}),
  };
}

export function addBusinessCartItem(
  cart: readonly BusinessCartItem[],
  item: BusinessCartItem,
): CartMutationResult {
  if (item.availableStock < 1) {
    return { success: false, cart: [...cart], error: "El producto no tiene stock disponible." };
  }
  const existing = cart.find((candidate) => candidate.catalogItemId === item.catalogItemId);
  if (!existing) return { success: true, cart: [...cart, item] };
  if (existing.quantity >= existing.availableStock) {
    return { success: false, cart: [...cart], error: "No podés agregar más unidades que el stock disponible." };
  }
  return {
    success: true,
    cart: cart.map((candidate) => candidate.catalogItemId === item.catalogItemId
      ? { ...candidate, quantity: candidate.quantity + 1 }
      : candidate),
  };
}

export function setBusinessCartQuantity(
  cart: readonly BusinessCartItem[],
  catalogItemId: string,
  quantity: number,
): CartMutationResult {
  const existing = cart.find((item) => item.catalogItemId === catalogItemId);
  if (!existing) return { success: false, cart: [...cart], error: "El producto no está en el carrito." };
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { success: false, cart: [...cart], error: "La cantidad debe ser al menos 1." };
  }
  if (quantity > existing.availableStock) {
    return { success: false, cart: [...cart], error: "La cantidad supera el stock disponible." };
  }
  return {
    success: true,
    cart: cart.map((item) => item.catalogItemId === catalogItemId ? { ...item, quantity } : item),
  };
}

export function calculateBusinessCartTotal(cart: readonly BusinessCartItem[]): number {
  return Number(cart.reduce((total, item) => total + item.unitPrice * item.quantity, 0).toFixed(2));
}

export function buildBusinessSaleFingerprint(
  cart: readonly Pick<BusinessCartItem, "catalogItemId" | "quantity">[],
  clientId: string | null,
): string {
  return JSON.stringify({
    clientId: clientId || null,
    items: [...cart]
      .map((item) => ({ catalogItemId: item.catalogItemId, quantity: item.quantity }))
      .sort((left, right) => left.catalogItemId.localeCompare(right.catalogItemId)),
  });
}

export function findCatalogItemByBarcode(
  items: readonly BusinessCatalogItem[],
  barcode: string,
): BusinessCatalogItem | null {
  const normalized = normalizeBarcode(barcode).toLowerCase();
  if (!normalized) return null;
  return items.find((item) => item.is_active && normalizeBarcode(item.barcode ?? "").toLowerCase() === normalized) ?? null;
}
