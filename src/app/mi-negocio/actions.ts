"use server";

import { revalidatePath } from "next/cache";
import {
  normalizeBusinessMoney,
  normalizeBusinessStock,
  normalizeOptionalBusinessText,
  type BusinessCatalogItem,
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
