"use server";

import { revalidatePath } from "next/cache";
import {
  normalizeBusinessMoney,
  normalizeBusinessStock,
  normalizeOptionalBusinessText,
  type BusinessCatalogItem,
  type BusinessClientSummary,
  type BusinessInventoryMovement,
  type BusinessSaleItem,
  type BusinessSaleSummary,
  type WorkshopProductSummary,
} from "@/lib/business/catalog";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ResaleCatalogInput {
  name: string;
  category: string;
  brand?: string;
  description?: string;
  purchaseCost: number;
  salePrice: number;
  initialStock: number;
  sku?: string;
  barcode?: string;
  supplier?: string;
  isActive: boolean;
}

export interface ManufacturedCatalogInput {
  sourceProductId: string;
  category: string;
  description?: string;
  salePrice: number;
  sku?: string;
  barcode?: string;
  isActive: boolean;
}

export interface BusinessSaleInput {
  idempotencyKey: string;
  clientId?: string | null;
  items: Array<{ catalogItemId: string; quantity: number }>;
}

export interface BusinessInventoryAdjustmentInput {
  idempotencyKey: string;
  catalogItemId: string;
  quantityDelta: number;
  reason?: string;
}

async function authorizeBusinessAccess() {
  const supabase = await createClient();
  const { access, error } = await getCurrentUserAccess(supabase);
  if (error || !access.userId || !access.capabilities.accessPlatform) {
    return { success: false as const, error: "No tenés permiso para administrar Mi Negocio." };
  }
  return { success: true as const, supabase, userId: access.userId };
}

function requiredText(value: unknown, maxLength: number): string | null {
  return normalizeOptionalBusinessText(value, maxLength);
}

function friendlyMutationError(error: { code?: string; message: string } | null): string {
  if (error?.code === "23505") {
    return "Ese producto, SKU o código de barras ya está registrado en tu catálogo.";
  }
  return error?.message || "No se pudo guardar el producto comercial.";
}

function revalidateBusinessPages() {
  revalidatePath("/mi-negocio");
  revalidatePath("/mi-negocio/catalogo");
  revalidatePath("/mi-negocio/inventario");
  revalidatePath("/productos");
}

export async function loadBusinessWorkspaceAction(): Promise<
  | { success: true; items: BusinessCatalogItem[]; products: WorkshopProductSummary[] }
  | { success: false; error: string; items: []; products: [] }
> {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return { ...authorized, items: [], products: [] };

  const [itemsResult, productsResult] = await Promise.all([
    authorized.supabase
      .from("business_catalog_items")
      .select("id, user_id, source_type, source_product_id, name, category, brand, description, purchase_cost, sale_price, resale_stock_quantity, sku, barcode, supplier, image_urls, is_active, is_published, created_at, updated_at")
      .eq("user_id", authorized.userId)
      .order("created_at", { ascending: false }),
    authorized.supabase
      .from("products")
      .select("id, name, description, base_cost, sale_price, stock_quantity, image_url, is_active")
      .eq("user_id", authorized.userId)
      .order("name", { ascending: true }),
  ]);

  const queryError = itemsResult.error || productsResult.error;
  if (queryError) {
    return { success: false, error: queryError.message, items: [], products: [] };
  }

  return {
    success: true,
    items: (itemsResult.data || []) as BusinessCatalogItem[],
    products: (productsResult.data || []) as WorkshopProductSummary[],
  };
}

export async function createResaleCatalogItemAction(input: ResaleCatalogInput) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;

  const name = requiredText(input.name, 160);
  const category = requiredText(input.category, 100);
  const purchaseCost = normalizeBusinessMoney(input.purchaseCost);
  const salePrice = normalizeBusinessMoney(input.salePrice);
  const initialStock = normalizeBusinessStock(input.initialStock);
  if (!name || !category) {
    return { success: false as const, error: "Completá el nombre y la categoría." };
  }
  if (purchaseCost === null || salePrice === null || initialStock === null) {
    return { success: false as const, error: "Costo, precio y stock deben ser valores válidos y no negativos." };
  }

  const { data, error } = await authorized.supabase
    .from("business_catalog_items")
    .insert({
      user_id: authorized.userId,
      source_type: "resale",
      source_product_id: null,
      name,
      category,
      brand: normalizeOptionalBusinessText(input.brand, 100),
      description: normalizeOptionalBusinessText(input.description, 500),
      purchase_cost: purchaseCost,
      sale_price: salePrice,
      resale_stock_quantity: initialStock,
      sku: normalizeOptionalBusinessText(input.sku, 80),
      barcode: normalizeOptionalBusinessText(input.barcode, 120),
      supplier: normalizeOptionalBusinessText(input.supplier, 160),
      image_urls: [],
      is_active: input.isActive === true,
      is_published: false,
    })
    .select("id")
    .single();

  if (error || !data) return { success: false as const, error: friendlyMutationError(error) };
  revalidateBusinessPages();
  return { success: true as const, itemId: data.id };
}

export async function linkManufacturedProductAction(input: ManufacturedCatalogInput) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;
  if (!UUID_PATTERN.test(input.sourceProductId)) {
    return { success: false as const, error: "El producto del taller no es válido." };
  }

  const category = requiredText(input.category, 100);
  const salePrice = normalizeBusinessMoney(input.salePrice);
  if (!category || salePrice === null) {
    return { success: false as const, error: "Completá una categoría y un precio de venta válidos." };
  }

  const { data: product, error: productError } = await authorized.supabase
    .from("products")
    .select("id, name, description, image_url, is_active")
    .eq("id", input.sourceProductId)
    .eq("user_id", authorized.userId)
    .eq("is_active", true)
    .maybeSingle();

  if (productError || !product) {
    return { success: false as const, error: "No se encontró el producto activo o no te pertenece." };
  }

  const { data, error } = await authorized.supabase
    .from("business_catalog_items")
    .insert({
      user_id: authorized.userId,
      source_type: "manufactured",
      source_product_id: product.id,
      name: product.name,
      category,
      brand: null,
      description: normalizeOptionalBusinessText(input.description, 500) || product.description,
      purchase_cost: null,
      sale_price: salePrice,
      resale_stock_quantity: 0,
      sku: normalizeOptionalBusinessText(input.sku, 80),
      barcode: normalizeOptionalBusinessText(input.barcode, 120),
      supplier: null,
      image_urls: product.image_url ? [product.image_url] : [],
      is_active: input.isActive === true,
      is_published: false,
    })
    .select("id")
    .single();

  if (error || !data) return { success: false as const, error: friendlyMutationError(error) };
  revalidateBusinessPages();
  return { success: true as const, itemId: data.id };
}

export async function loadBusinessOperationsAction(): Promise<
  | {
      success: true;
      items: BusinessCatalogItem[];
      products: WorkshopProductSummary[];
      clients: BusinessClientSummary[];
      movements: BusinessInventoryMovement[];
    }
  | { success: false; error: string; items: []; products: []; clients: []; movements: [] }
> {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return { ...authorized, items: [], products: [], clients: [], movements: [] };

  const [itemsResult, productsResult, clientsResult, movementsResult] = await Promise.all([
    authorized.supabase
      .from("business_catalog_items")
      .select("id, user_id, source_type, source_product_id, name, category, brand, description, purchase_cost, sale_price, resale_stock_quantity, sku, barcode, supplier, image_urls, is_active, is_published, created_at, updated_at")
      .eq("user_id", authorized.userId)
      .order("name", { ascending: true }),
    authorized.supabase
      .from("products")
      .select("id, name, description, base_cost, sale_price, stock_quantity, image_url, is_active")
      .eq("user_id", authorized.userId),
    authorized.supabase
      .from("clients")
      .select("id, name")
      .eq("user_id", authorized.userId)
      .order("name", { ascending: true }),
    authorized.supabase
      .from("business_inventory_movements")
      .select("id, catalog_item_id, sale_id, movement_type, quantity_delta, previous_quantity, new_quantity, reason, reference, created_at")
      .eq("user_id", authorized.userId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const queryError = itemsResult.error || productsResult.error || clientsResult.error || movementsResult.error;
  if (queryError) {
    return { success: false, error: queryError.message, items: [], products: [], clients: [], movements: [] };
  }
  return {
    success: true,
    items: (itemsResult.data || []) as BusinessCatalogItem[],
    products: (productsResult.data || []) as WorkshopProductSummary[],
    clients: (clientsResult.data || []) as BusinessClientSummary[],
    movements: (movementsResult.data || []) as BusinessInventoryMovement[],
  };
}

export async function adjustBusinessInventoryAction(input: BusinessInventoryAdjustmentInput) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;
  if (!UUID_PATTERN.test(input.idempotencyKey) || !UUID_PATTERN.test(input.catalogItemId)) {
    return { success: false as const, error: "El ajuste no tiene identificadores válidos." };
  }
  if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0 || Math.abs(input.quantityDelta) > 100_000) {
    return { success: false as const, error: "Ingresá una cantidad válida distinta de cero." };
  }
  const reason = normalizeOptionalBusinessText(input.reason, 300);
  if (!reason) return { success: false as const, error: "Indicá el motivo del ajuste." };

  const { data, error } = await authorized.supabase.rpc("adjust_business_inventory", {
    p_catalog_item_id: input.catalogItemId,
    p_quantity_delta: input.quantityDelta,
    p_reason: reason,
    p_idempotency_key: input.idempotencyKey,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.success) {
    return { success: false as const, error: row?.message || error?.message || "No se pudo ajustar el inventario." };
  }

  revalidateBusinessPages();
  return {
    success: true as const,
    previousQuantity: Number(row.previous_quantity),
    newQuantity: Number(row.new_quantity),
    replayed: row.replayed === true,
  };
}

export async function confirmBusinessSaleAction(input: BusinessSaleInput) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;
  if (!UUID_PATTERN.test(input.idempotencyKey)) {
    return { success: false as const, error: "La venta no tiene una clave válida." };
  }
  if (input.clientId && !UUID_PATTERN.test(input.clientId)) {
    return { success: false as const, error: "El cliente seleccionado no es válido." };
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) {
    return { success: false as const, error: "El carrito debe contener entre 1 y 50 productos." };
  }
  const validItems = input.items.every((item) => (
    UUID_PATTERN.test(item.catalogItemId)
    && Number.isInteger(item.quantity)
    && item.quantity > 0
    && item.quantity <= 100_000
  ));
  if (!validItems) return { success: false as const, error: "El carrito contiene cantidades inválidas." };

  const { data, error } = await authorized.supabase.rpc("confirm_business_sale", {
    p_idempotency_key: input.idempotencyKey,
    p_items: input.items,
    p_client_id: input.clientId || null,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.success) {
    return { success: false as const, error: row?.message || error?.message || "No se pudo confirmar la venta." };
  }

  revalidateBusinessPages();
  revalidatePath("/mi-negocio/venta-rapida");
  revalidatePath("/mi-negocio/ventas");
  return {
    success: true as const,
    saleId: String(row.sale_id),
    saleNumber: Number(row.sale_number),
    total: Number(row.total_amount),
    replayed: row.replayed === true,
  };
}

export async function loadBusinessSalesAction(): Promise<
  | { success: true; sales: BusinessSaleSummary[] }
  | { success: false; error: string; sales: [] }
> {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return { ...authorized, sales: [] };

  const { data: salesData, error: salesError } = await authorized.supabase
    .from("business_sales")
    .select("id, sale_number, client_id, status, currency, subtotal, total, created_at")
    .eq("user_id", authorized.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (salesError) return { success: false, error: salesError.message, sales: [] };

  const saleIds = (salesData || []).map((sale) => sale.id);
  const clientIds = Array.from(new Set((salesData || []).flatMap((sale) => sale.client_id ? [sale.client_id] : [])));
  const [itemsResult, clientsResult] = await Promise.all([
    saleIds.length
      ? authorized.supabase
        .from("business_sale_items")
        .select("id, sale_id, catalog_item_id, source_type, product_name_snapshot, sku_snapshot, barcode_snapshot, unit_price, quantity, subtotal")
        .eq("user_id", authorized.userId)
        .in("sale_id", saleIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? authorized.supabase
        .from("clients")
        .select("id, name")
        .eq("user_id", authorized.userId)
        .in("id", clientIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const queryError = itemsResult.error || clientsResult.error;
  if (queryError) return { success: false, error: queryError.message, sales: [] };

  const saleItems = (itemsResult.data || []) as BusinessSaleItem[];
  const clients = (clientsResult.data || []) as BusinessClientSummary[];
  return {
    success: true,
    sales: (salesData || []).map((sale) => ({
      ...sale,
      sale_number: Number(sale.sale_number),
      subtotal: Number(sale.subtotal),
      total: Number(sale.total),
      client_name: clients.find((client) => client.id === sale.client_id)?.name ?? null,
      items: saleItems.filter((item) => item.sale_id === sale.id).map((item) => ({
        ...item,
        unit_price: Number(item.unit_price),
        quantity: Number(item.quantity),
        subtotal: Number(item.subtotal),
      })),
    })) as BusinessSaleSummary[],
  };
}
