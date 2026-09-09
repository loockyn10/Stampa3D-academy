"use server";

import { revalidatePath } from "next/cache";
import {
  getBusinessProductDisplayName,
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
import {
  normalizePublicUrl,
  normalizePublicWhatsapp,
  normalizeStorefrontSlug,
  validateStorefrontSlug,
  type BusinessStorefront,
} from "@/lib/business/storefront";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import type { BusinessOrderItemSummary, BusinessOrderSummary, BusinessPaymentConnection } from "@/lib/business/orders";
import {
  normalizeBusinessReplenishmentWorkspace,
  type BusinessInventoryPeriod,
  type BusinessReplenishmentWorkspace,
} from "@/lib/business/replenishment";
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

export interface BusinessCatalogEditInput {
  catalogItemId: string;
  name: string;
  category: string;
  brand?: string;
  description?: string;
  purchaseCost?: number | null;
  salePrice: number;
  sku?: string;
  barcode?: string;
  supplier?: string;
  imageUrls: string[];
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

export interface BusinessStorefrontInput {
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string;
  bannerUrl?: string;
  whatsapp?: string;
  publicEmail?: string;
  isActive: boolean;
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
  revalidatePath("/mi-negocio/reposicion");
  revalidatePath("/productos");
  revalidatePath("/mi-taller/productos");
  revalidatePath("/mi-taller/inventario");
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
      .select("id, user_id, source_type, source_product_id, name, category, brand, description, purchase_cost, sale_price, resale_stock_quantity, sku, barcode, supplier, image_urls, is_active, is_published, public_slug, created_at, updated_at")
      .eq("user_id", authorized.userId)
      .eq("is_active", true)
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
  const brand = normalizeOptionalBusinessText(input.brand, 100);
  const description = normalizeOptionalBusinessText(input.description, 500);
  const sku = normalizeOptionalBusinessText(input.sku, 80);
  const barcode = normalizeOptionalBusinessText(input.barcode, 120);
  const supplier = normalizeOptionalBusinessText(input.supplier, 160);
  if (!name || !category) {
    return { success: false as const, error: "Completá el nombre y la categoría." };
  }
  if (purchaseCost === null || salePrice === null || initialStock === null) {
    return { success: false as const, error: "Costo, precio y stock deben ser valores válidos y no negativos." };
  }

  const { data: existingRows, error: existingError } = await authorized.supabase
    .from("business_catalog_items")
    .select("id, name, brand, sku, barcode, is_active")
    .eq("user_id", authorized.userId)
    .eq("source_type", "resale");
  if (existingError) return { success: false as const, error: existingError.message };

  const comparable = (value: unknown) => normalizeOptionalBusinessText(value, 160)?.toLocaleLowerCase("es-AR") ?? "";
  const equivalentRows = (existingRows || []).filter((candidate) => {
    if (barcode && comparable(candidate.barcode) === comparable(barcode)) return true;
    if (sku && comparable(candidate.sku) === comparable(sku)) return true;
    return !barcode && !sku
      && comparable(candidate.name) === comparable(name)
      && comparable(candidate.brand) === comparable(brand);
  });
  if (equivalentRows.some((candidate) => candidate.is_active)) {
    return { success: false as const, error: "Este producto ya está en Mi Negocio." };
  }
  const archivedMatches = equivalentRows.filter((candidate) => !candidate.is_active);
  if (archivedMatches.length > 1) {
    return { success: false as const, error: "Encontramos más de un producto archivado equivalente. Revisá su SKU o código de barras." };
  }
  if (archivedMatches.length === 1) {
    if (input.isActive !== true) {
      return { success: false as const, error: "Ese producto ya está archivado. Marcá Activo para restaurarlo." };
    }
    const { data: restored, error: restoreError } = await authorized.supabase
      .from("business_catalog_items")
      .update({ is_active: true })
      .eq("id", archivedMatches[0].id)
      .eq("user_id", authorized.userId)
      .eq("is_active", false)
      .select("id")
      .maybeSingle();
    if (restoreError || !restored) return { success: false as const, error: friendlyMutationError(restoreError) };
    revalidateBusinessPages();
    return { success: true as const, itemId: restored.id, restored: true as const };
  }

  const { data, error } = await authorized.supabase
    .from("business_catalog_items")
    .insert({
      user_id: authorized.userId,
      source_type: "resale",
      source_product_id: null,
      name,
      category,
      brand,
      description,
      purchase_cost: purchaseCost,
      sale_price: salePrice,
      resale_stock_quantity: initialStock,
      sku,
      barcode,
      supplier,
      image_urls: [],
      is_active: input.isActive === true,
      is_published: false,
    })
    .select("id")
    .single();

  if (error || !data) return { success: false as const, error: friendlyMutationError(error) };
  revalidateBusinessPages();
  return { success: true as const, itemId: data.id, restored: false as const };
}

export async function linkManufacturedProductAction(input: ManufacturedCatalogInput) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;
  if (!UUID_PATTERN.test(input.sourceProductId)) {
    return { success: false as const, error: "El producto del taller no es válido." };
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

  const { data: existingCatalogItem, error: existingError } = await authorized.supabase
    .from("business_catalog_items")
    .select("id, is_active")
    .eq("user_id", authorized.userId)
    .eq("source_product_id", product.id)
    .maybeSingle();
  if (existingError) return { success: false as const, error: existingError.message };
  if (existingCatalogItem?.is_active) {
    return { success: false as const, error: "Este producto ya está en Mi Negocio." };
  }
  if (existingCatalogItem) {
    if (input.isActive !== true) {
      return { success: false as const, error: "Ese producto ya está archivado. Marcá Activo para restaurarlo." };
    }
    const { data: restored, error: restoreError } = await authorized.supabase
      .from("business_catalog_items")
      .update({ is_active: true })
      .eq("id", existingCatalogItem.id)
      .eq("user_id", authorized.userId)
      .eq("is_active", false)
      .select("id")
      .maybeSingle();
    if (restoreError || !restored) return { success: false as const, error: friendlyMutationError(restoreError) };
    revalidateBusinessPages();
    return { success: true as const, itemId: restored.id, restored: true as const };
  }

  const category = requiredText(input.category, 100);
  const salePrice = normalizeBusinessMoney(input.salePrice);
  if (!category || salePrice === null) {
    return { success: false as const, error: "Completá una categoría y un precio de venta válidos." };
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
  return { success: true as const, itemId: data.id, restored: false as const };
}

export async function loadBusinessOperationsAction(): Promise<
  | {
      success: true;
      items: BusinessCatalogItem[];
      products: WorkshopProductSummary[];
      clients: BusinessClientSummary[];
      movements: BusinessInventoryMovement[];
      locationsEnabled: boolean;
      locationItems: BusinessReplenishmentWorkspace["items"];
    }
  | { success: false; error: string; items: []; products: []; clients: []; movements: []; locationsEnabled: false; locationItems: [] }
> {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return { ...authorized, items: [], products: [], clients: [], movements: [], locationsEnabled: false, locationItems: [] };

  const [itemsResult, productsResult, clientsResult, movementsResult, locationsResult] = await Promise.all([
    authorized.supabase
      .from("business_catalog_items")
      .select("id, user_id, source_type, source_product_id, name, category, brand, description, purchase_cost, sale_price, resale_stock_quantity, sku, barcode, supplier, image_urls, is_active, is_published, public_slug, created_at, updated_at")
      .eq("user_id", authorized.userId)
      .eq("is_active", true)
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
    authorized.supabase.rpc("get_business_replenishment_workspace", { p_period: "week" }),
  ]);

  const queryError = itemsResult.error || productsResult.error || clientsResult.error || movementsResult.error || locationsResult.error;
  if (queryError) {
    return { success: false, error: queryError.message, items: [], products: [], clients: [], movements: [], locationsEnabled: false, locationItems: [] };
  }
  const locationWorkspace = normalizeBusinessReplenishmentWorkspace(locationsResult.data);
  return {
    success: true,
    items: (itemsResult.data || []) as BusinessCatalogItem[],
    products: (productsResult.data || []) as WorkshopProductSummary[],
    clients: (clientsResult.data || []) as BusinessClientSummary[],
    movements: (movementsResult.data || []) as BusinessInventoryMovement[],
    locationsEnabled: locationWorkspace?.enabled === true,
    locationItems: locationWorkspace?.items ?? [],
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

  const { data: settings, error: settingsError } = await authorized.supabase
    .from("business_inventory_location_settings")
    .select("locations_enabled")
    .eq("user_id", authorized.userId)
    .maybeSingle();
  if (settingsError) return { success: false as const, error: "No se pudo verificar desde qué ubicación descontar la venta." };
  const saleRpc = settings?.locations_enabled === true ? "confirm_business_showroom_sale" : "confirm_business_sale";
  const { data, error } = await authorized.supabase.rpc(saleRpc, {
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

export async function loadBusinessReplenishmentAction(period: BusinessInventoryPeriod): Promise<
  | { success: true; workspace: BusinessReplenishmentWorkspace }
  | { success: false; error: string; workspace: null }
> {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return { success: false, error: authorized.error, workspace: null };
  const [workspaceResult, catalogResult] = await Promise.all([
    authorized.supabase.rpc("get_business_replenishment_workspace", { p_period: period }),
    authorized.supabase
      .from("business_catalog_items")
      .select("id, name, brand")
      .eq("user_id", authorized.userId)
      .eq("is_active", true),
  ]);
  const queryError = workspaceResult.error || catalogResult.error;
  if (queryError) return { success: false, error: queryError.message, workspace: null };
  const workspace = normalizeBusinessReplenishmentWorkspace(workspaceResult.data);
  if (!workspace) return { success: false, error: "No se pudo interpretar el estado de reposición.", workspace: null };
  const catalogNames = new Map((catalogResult.data || []).map((item) => [
    item.id,
    getBusinessProductDisplayName({ name: item.name, brand: item.brand }),
  ]));
  return {
    success: true,
    workspace: {
      ...workspace,
      items: workspace.items.map((item) => ({ ...item, name: catalogNames.get(item.catalogItemId) ?? item.name })),
    },
  };
}

export async function configureBusinessLocationsAction(input: { enabled: boolean; initialLocation?: "showroom" | "warehouse" | "keep" }) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;
  const { data, error } = await authorized.supabase.rpc("configure_business_inventory_locations", {
    p_enabled: input.enabled,
    p_initial_location: input.enabled ? input.initialLocation ?? null : null,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.success) return { success: false as const, error: row?.message || error?.message || "No se pudo guardar la configuración." };
  revalidateBusinessPages();
  return { success: true as const, enabled: row.enabled === true };
}

export async function saveBusinessInventoryPolicyAction(input: { catalogItemId: string; showroomTarget: number | null; stockMinimum: number | null; unitWeightGrams: number | null }) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;
  if (!UUID_PATTERN.test(input.catalogItemId)) return { success: false as const, error: "El producto no es válido." };
  const validOptional = (value: number | null, strictlyPositive = false) => value === null || (Number.isFinite(value) && Number.isInteger(value) && (strictlyPositive ? value > 0 : value >= 0));
  if (!validOptional(input.showroomTarget) || !validOptional(input.stockMinimum) || !validOptional(input.unitWeightGrams, true)) return { success: false as const, error: "Revisá objetivo, mínimo y peso unitario." };
  const { data, error } = await authorized.supabase.rpc("save_business_inventory_policy", {
    p_catalog_item_id: input.catalogItemId,
    p_showroom_target: input.showroomTarget,
    p_stock_minimum: input.stockMinimum,
    p_unit_weight_grams: input.unitWeightGrams,
  });
  if (error || data !== true) return { success: false as const, error: error?.message || "No se pudo guardar la configuración del producto." };
  revalidateBusinessPages();
  return { success: true as const };
}

export async function replenishBusinessShowroomAction(input: { catalogItemIds: string[]; idempotencyKey: string }) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;
  if (!UUID_PATTERN.test(input.idempotencyKey) || input.catalogItemIds.length < 1 || input.catalogItemIds.length > 200 || input.catalogItemIds.some((id) => !UUID_PATTERN.test(id))) return { success: false as const, error: "La reposición no es válida." };
  const { data, error } = await authorized.supabase.rpc("replenish_business_showroom", { p_catalog_item_ids: input.catalogItemIds, p_operation_key: input.idempotencyKey });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.success) return { success: false as const, error: row?.message || error?.message || "No se pudo completar la reposición." };
  revalidateBusinessPages();
  return { success: true as const, movedUnits: Number(row.moved_units), productCount: Number(row.product_count), replayed: row.replayed === true };
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

export async function loadBusinessStorefrontWorkspaceAction(): Promise<
  | { success: true; userId: string; storefront: BusinessStorefront | null }
  | { success: false; error: string; userId: null; storefront: null }
> {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return { success: false, error: authorized.error, userId: null, storefront: null };
  const { data, error } = await authorized.supabase
    .from("business_storefronts")
    .select("user_id, name, slug, description, logo_url, banner_url, whatsapp, public_email, is_active, created_at, updated_at")
    .eq("user_id", authorized.userId)
    .maybeSingle();
  if (error) return { success: false, error: error.message, userId: null, storefront: null };
  return { success: true, userId: authorized.userId, storefront: data as BusinessStorefront | null };
}

export async function loadBusinessPaymentConnectionAction(): Promise<
  | { success: true; connection: BusinessPaymentConnection | null }
  | { success: false; error: string; connection: null }
> {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return { success: false, error: authorized.error, connection: null };
  const { data, error } = await authorized.supabase.rpc("get_business_payment_connection");
  if (error) return { success: false, error: error.message, connection: null };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { success: true, connection: null };
  return { success: true, connection: {
    provider: "mercado_pago", status: row.status, providerUserId: row.provider_user_id,
    liveMode: row.live_mode === true, tokenExpiresAt: row.token_expires_at,
    connectedAt: row.connected_at, lastError: row.last_error,
  } as BusinessPaymentConnection };
}

export async function loadBusinessOrdersAction(): Promise<
  | { success: true; orders: BusinessOrderSummary[] }
  | { success: false; error: string; orders: [] }
> {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return { success: false, error: authorized.error, orders: [] };
  const { data: orders, error } = await authorized.supabase.from("business_orders")
    .select("id, order_number, status, payment_status, currency, total, buyer_name, buyer_email, buyer_phone, provider, provider_preference_id, expires_at, paid_at, created_at")
    .eq("user_id", authorized.userId).order("created_at", { ascending: false }).limit(100);
  if (error) return { success: false, error: error.message, orders: [] };
  const ids = (orders || []).map((order) => order.id);
  const { data: items, error: itemsError } = ids.length
    ? await authorized.supabase.from("business_order_items")
      .select("id, order_id, product_name_snapshot, sku_snapshot, image_url_snapshot, unit_price, quantity, subtotal")
      .eq("user_id", authorized.userId).in("order_id", ids)
    : { data: [], error: null };
  if (itemsError) return { success: false, error: itemsError.message, orders: [] };
  const orderItems = (items || []) as BusinessOrderItemSummary[];
  return { success: true, orders: (orders || []).map((order) => ({
    ...order, order_number: Number(order.order_number), total: Number(order.total),
    items: orderItems.filter((item) => item.order_id === order.id).map((item) => ({ ...item, unit_price: Number(item.unit_price), quantity: Number(item.quantity), subtotal: Number(item.subtotal) })),
  })) as BusinessOrderSummary[] };
}

export async function saveBusinessStorefrontAction(input: BusinessStorefrontInput) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;
  const name = normalizeOptionalBusinessText(input.name, 120);
  const slug = normalizeStorefrontSlug(input.slug);
  const slugError = validateStorefrontSlug(slug);
  const description = normalizeOptionalBusinessText(input.description, 600);
  const whatsapp = normalizePublicWhatsapp(input.whatsapp);
  const publicEmail = normalizeOptionalBusinessText(input.publicEmail, 254)?.toLowerCase() ?? null;
  const logoUrl = normalizePublicUrl(input.logoUrl);
  const bannerUrl = normalizePublicUrl(input.bannerUrl);
  if (!name) return { success: false as const, error: "Ingresá el nombre comercial." };
  if (slugError) return { success: false as const, error: slugError };
  if (input.whatsapp?.trim() && !whatsapp) return { success: false as const, error: "Ingresá un WhatsApp válido con código de país." };
  if (publicEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicEmail)) return { success: false as const, error: "Ingresá un email público válido." };
  if (input.logoUrl?.trim() && !logoUrl) return { success: false as const, error: "La URL del logo no es válida." };
  if (input.bannerUrl?.trim() && !bannerUrl) return { success: false as const, error: "La URL del banner no es válida." };

  const { error } = await authorized.supabase.from("business_storefronts").upsert({
    user_id: authorized.userId, name, slug, description, logo_url: logoUrl, banner_url: bannerUrl,
    whatsapp, public_email: publicEmail, is_active: input.isActive === true,
  }, { onConflict: "user_id" });
  if (error?.code === "23505") return { success: false as const, error: "Ese slug ya está siendo usado por otra tienda." };
  if (error) return { success: false as const, error: error.message };
  revalidatePath("/mi-negocio/tienda");
  revalidatePath(`/tienda/${slug}`);
  return { success: true as const, slug };
}

export async function setBusinessCatalogPublicationAction(input: { catalogItemId: string; published: boolean }) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;
  if (!UUID_PATTERN.test(input.catalogItemId)) return { success: false as const, error: "El producto no es válido." };
  const { data, error } = await authorized.supabase
    .from("business_catalog_items")
    .update({ is_published: input.published === true })
    .eq("id", input.catalogItemId)
    .eq("user_id", authorized.userId)
    .eq("is_active", true)
    .select("id, public_slug")
    .maybeSingle();
  if (error) return { success: false as const, error: error.message };
  if (!data) return { success: false as const, error: "El producto no existe, está inactivo o no te pertenece." };
  revalidatePath("/mi-negocio/catalogo");
  revalidatePath("/mi-negocio/tienda");
  return { success: true as const, publicSlug: data.public_slug as string | null };
}

export async function updateBusinessCatalogItemAction(input: BusinessCatalogEditInput) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;
  if (!UUID_PATTERN.test(input.catalogItemId)) {
    return { success: false as const, error: "El producto no es válido." };
  }

  const name = requiredText(input.name, 160);
  const category = requiredText(input.category, 100);
  const salePrice = normalizeBusinessMoney(input.salePrice);
  if (!name || !category || salePrice === null) {
    return { success: false as const, error: "Completá nombre, categoría y precio con valores válidos." };
  }
  if (!Array.isArray(input.imageUrls) || input.imageUrls.length > 5) {
    return { success: false as const, error: "Las imágenes del producto no son válidas." };
  }
  const imageUrls = input.imageUrls.flatMap((value) => {
    const normalized = normalizePublicUrl(value);
    return normalized ? [normalized] : [];
  });
  if (imageUrls.length !== input.imageUrls.filter((value) => typeof value === "string" && value.trim()).length) {
    return { success: false as const, error: "Revisá las URLs de las imágenes del producto." };
  }

  const { data: currentItem, error: currentError } = await authorized.supabase
    .from("business_catalog_items")
    .select("id, source_type")
    .eq("id", input.catalogItemId)
    .eq("user_id", authorized.userId)
    .eq("is_active", true)
    .maybeSingle();
  if (currentError) return { success: false as const, error: currentError.message };
  if (!currentItem) {
    return { success: false as const, error: "El producto no existe, fue eliminado o no te pertenece." };
  }

  const purchaseCost = currentItem.source_type === "resale"
    ? normalizeBusinessMoney(input.purchaseCost)
    : null;
  if (currentItem.source_type === "resale" && purchaseCost === null) {
    return { success: false as const, error: "Ingresá un costo de compra válido." };
  }

  const { data, error } = await authorized.supabase
    .from("business_catalog_items")
    .update({
      name,
      category,
      brand: normalizeOptionalBusinessText(input.brand, 100),
      description: normalizeOptionalBusinessText(input.description, 500),
      purchase_cost: purchaseCost,
      sale_price: salePrice,
      sku: normalizeOptionalBusinessText(input.sku, 80),
      barcode: normalizeOptionalBusinessText(input.barcode, 120),
      supplier: currentItem.source_type === "resale" ? normalizeOptionalBusinessText(input.supplier, 160) : null,
      image_urls: [...new Set(imageUrls)],
    })
    .eq("id", currentItem.id)
    .eq("user_id", authorized.userId)
    .eq("is_active", true)
    .select("id, user_id, source_type, source_product_id, name, category, brand, description, purchase_cost, sale_price, resale_stock_quantity, sku, barcode, supplier, image_urls, is_active, is_published, public_slug, created_at, updated_at")
    .maybeSingle();

  if (error) return { success: false as const, error: friendlyMutationError(error) };
  if (!data) return { success: false as const, error: "El producto cambió mientras lo editabas. Volvé a intentarlo." };
  revalidateBusinessPages();
  revalidatePath("/mi-negocio/venta-rapida");
  revalidatePath("/mi-negocio/tienda");
  return { success: true as const, item: data as BusinessCatalogItem };
}

export async function archiveBusinessCatalogItemAction(input: { catalogItemId: string }) {
  const authorized = await authorizeBusinessAccess();
  if (!authorized.success) return authorized;
  if (!UUID_PATTERN.test(input.catalogItemId)) {
    return { success: false as const, error: "El producto no es válido." };
  }

  const { data, error } = await authorized.supabase
    .from("business_catalog_items")
    .update({ is_active: false, is_published: false })
    .eq("id", input.catalogItemId)
    .eq("user_id", authorized.userId)
    .eq("is_active", true)
    .select("id, source_type")
    .maybeSingle();

  if (error) return { success: false as const, error: error.message };
  if (!data) {
    return { success: false as const, error: "El producto no existe, ya fue eliminado o no te pertenece." };
  }

  revalidateBusinessPages();
  revalidatePath("/mi-negocio/venta-rapida");
  revalidatePath("/mi-negocio/tienda");
  return { success: true as const, sourceType: data.source_type as "manufactured" | "resale" };
}
