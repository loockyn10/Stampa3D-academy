"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import {
  calculateProductPrice,
  type ProductCalculationSnapshot,
  type ProductPricingComponent,
} from "@/lib/products/pricing";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface RecalculationContext {
  products: any[];
  components: any[];
  recipeRows: any[];
  filaments: any[];
  printers: any[];
  productTypes: any[];
  calculatorSettings: any | null;
}

interface RecalculatedProduct {
  id: string;
  base_cost: number;
  sale_price: number;
  calculation_snapshot: ProductCalculationSnapshot;
  cost_updated_at?: string | null;
}

function asSnapshot(value: unknown): ProductCalculationSnapshot {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ProductCalculationSnapshot
    : {};
}

async function loadRecalculationContext(
  supabase: SupabaseServerClient,
  userId: string,
  productId?: string,
): Promise<RecalculationContext> {
  let productsQuery = supabase
    .from("products")
    .select("id, user_id, name, filament_id, printer_id, product_type_id, grams, print_time_minutes, base_cost, sale_price, calculation_snapshot")
    .eq("user_id", userId)
    .eq("is_active", true);
  if (productId) productsQuery = productsQuery.eq("id", productId);

  let componentsQuery = supabase
    .from("product_components")
    .select("id, product_id, name, quantity_per_product, sort_order")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (productId) componentsQuery = componentsQuery.eq("product_id", productId);

  const [productsResult, componentsResult, filamentsResult, printersResult, productTypesResult, settingsResult] = await Promise.all([
    productsQuery,
    componentsQuery,
    supabase
      .from("filaments")
      .select("id, name, purchase_price, total_grams")
      .eq("user_id", userId)
      .eq("is_active", true),
    supabase
      .from("printers")
      .select("id, name, power_watts, maintenance_cost_per_hour")
      .eq("user_id", userId)
      .eq("is_active", true),
    supabase
      .from("calculator_product_types")
      .select("id, name, multiplier, fixed_cost")
      .eq("user_id", userId)
      .eq("is_active", true),
    supabase
      .from("calculator_settings")
      .select("default_error_percent, electricity_price_kwh")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const requiredError = productsResult.error
    || componentsResult.error
    || filamentsResult.error
    || printersResult.error
    || productTypesResult.error
    || settingsResult.error;
  if (requiredError) throw new Error(requiredError.message);

  const componentIds = (componentsResult.data || []).map((component) => component.id);
  let recipeRows: any[] = [];
  if (componentIds.length > 0) {
    const { data, error } = await supabase
      .from("product_component_filaments")
      .select("component_id, filament_id, grams, sort_order")
      .eq("user_id", userId)
      .in("component_id", componentIds)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    recipeRows = data || [];
  }

  return {
    products: productsResult.data || [],
    components: componentsResult.data || [],
    recipeRows,
    filaments: filamentsResult.data || [],
    printers: printersResult.data || [],
    productTypes: productTypesResult.data || [],
    calculatorSettings: settingsResult.data || null,
  };
}

function calculateCurrentProductPrice(product: any, context: RecalculationContext) {
  const snapshot = asSnapshot(product.calculation_snapshot);
  const productComponents = context.components.filter((component) => component.product_id === product.id);

  let components: ProductPricingComponent[] = productComponents.map((component) => ({
    id: component.id,
    name: component.name,
    quantity_per_product: component.quantity_per_product,
    materials: context.recipeRows
      .filter((row) => row.component_id === component.id && row.filament_id && Number(row.grams) > 0)
      .map((row) => ({
        filament_id: row.filament_id,
        grams: Number(row.grams),
        filament: context.filaments.find((filament) => filament.id === row.filament_id) || null,
      })),
  }));

  if (components.flatMap((component) => component.materials || []).length === 0 && product.filament_id && Number(product.grams) > 0) {
    components = [{
      name: "Producto completo",
      quantity_per_product: 1,
      materials: [{
        filament_id: product.filament_id,
        grams: Number(product.grams),
        filament: context.filaments.find((filament) => filament.id === product.filament_id) || null,
      }],
    }];
  }

  const printerId = snapshot.printer_id || product.printer_id;
  const productTypeId = snapshot.product_type_id || product.product_type_id;
  const printer = context.printers.find((item) => item.id === printerId);
  const productType = context.productTypes.find((item) => item.id === productTypeId);
  const materials = components.flatMap((component) => component.materials || []);

  if (Number(product.print_time_minutes) <= 0 || materials.length === 0 || !printer || !productType) {
    return {
      success: false as const,
      error: "Faltan receta, tiempo, impresora o tipo de producto para recalcular.",
    };
  }
  if (materials.some((material) => !material.filament || Number(material.filament.total_grams) <= 0)) {
    return {
      success: false as const,
      error: "La receta contiene un filamento inexistente o sin gramos totales configurados.",
    };
  }

  const calculation = calculateProductPrice({
    components,
    printTimeMinutes: Number(product.print_time_minutes),
    printer,
    productType,
    calculatorSettings: context.calculatorSettings,
    oldSnapshot: snapshot,
  });
  if (!calculation.isValid || calculation.baseCost <= 0) {
    return {
      success: false as const,
      error: "No hay suficiente información válida para recalcular este producto.",
    };
  }

  return { success: true as const, calculation };
}

async function persistRecalculatedProduct({
  supabase,
  userId,
  product,
  context,
  source,
}: {
  supabase: SupabaseServerClient;
  userId: string;
  product: any;
  context: RecalculationContext;
  source: "manual_recalculate" | "bulk_recalculate";
}): Promise<{ success: true; product: RecalculatedProduct } | { success: false; error: string }> {
  const calculated = calculateCurrentProductPrice(product, context);
  if (!calculated.success) return calculated;

  const updatedAt = new Date().toISOString();
  const updatePayload = {
    base_cost: Number(calculated.calculation.baseCost.toFixed(2)),
    sale_price: Number(calculated.calculation.salePrice.toFixed(2)),
    calculation_snapshot: calculated.calculation.snapshot,
    cost_updated_at: updatedAt,
  };

  let updateResult = await supabase
    .from("products")
    .update(updatePayload)
    .eq("id", product.id)
    .eq("user_id", userId)
    .eq("is_active", true)
    .select("id, base_cost, sale_price, calculation_snapshot, cost_updated_at")
    .maybeSingle();

  if (updateResult.error) {
    const fallbackPayload = {
      base_cost: updatePayload.base_cost,
      sale_price: updatePayload.sale_price,
      calculation_snapshot: updatePayload.calculation_snapshot,
    };
    updateResult = await supabase
      .from("products")
      .update(fallbackPayload)
      .eq("id", product.id)
      .eq("user_id", userId)
      .eq("is_active", true)
      .select("id, base_cost, sale_price, calculation_snapshot")
      .maybeSingle();
  }

  if (updateResult.error || !updateResult.data) {
    return {
      success: false,
      error: updateResult.error?.message || "El producto no pudo actualizarse.",
    };
  }

  await supabase.from("product_price_history").insert([{
    product_id: product.id,
    user_id: userId,
    old_base_cost: product.base_cost,
    old_sale_price: product.sale_price,
    new_base_cost: updatePayload.base_cost,
    new_sale_price: updatePayload.sale_price,
    source,
    changed_at: updatedAt,
  }]);

  return {
    success: true,
    product: {
      ...updateResult.data,
      calculation_snapshot: calculated.calculation.snapshot,
      cost_updated_at: "cost_updated_at" in updateResult.data
        ? updateResult.data.cost_updated_at
        : null,
    },
  };
}

async function getAuthorizedRecalculationClient() {
  const supabase = await createClient();
  const { access, error } = await getCurrentUserAccess(supabase);
  if (error || !access.userId || !access.capabilities.accessPlatform) {
    return { success: false as const, error: "No tenés permiso para recalcular productos." };
  }
  return { success: true as const, supabase, userId: access.userId };
}

export async function recalculateProductPriceAction(productId: string) {
  if (!UUID_PATTERN.test(productId)) {
    return { success: false as const, error: "El producto seleccionado no es válido." };
  }

  const authorized = await getAuthorizedRecalculationClient();
  if (!authorized.success) return authorized;

  try {
    const context = await loadRecalculationContext(authorized.supabase, authorized.userId, productId);
    const product = context.products[0];
    if (!product) {
      return { success: false as const, error: "No se encontró el producto o no te pertenece." };
    }
    const result = await persistRecalculatedProduct({
      supabase: authorized.supabase,
      userId: authorized.userId,
      product,
      context,
      source: "manual_recalculate",
    });
    if (result.success) revalidatePath("/productos");
    return result;
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "No se pudo recalcular el producto.",
    };
  }
}

export async function recalculateAllProductPricesAction() {
  const authorized = await getAuthorizedRecalculationClient();
  if (!authorized.success) return authorized;

  try {
    const context = await loadRecalculationContext(authorized.supabase, authorized.userId);
    const updatedProducts: RecalculatedProduct[] = [];
    const failures: Array<{ productId: string; productName: string; error: string }> = [];

    for (const product of context.products) {
      const result = await persistRecalculatedProduct({
        supabase: authorized.supabase,
        userId: authorized.userId,
        product,
        context,
        source: "bulk_recalculate",
      });
      if (result.success) updatedProducts.push(result.product);
      else failures.push({ productId: product.id, productName: product.name, error: result.error });
    }

    revalidatePath("/productos");
    return {
      success: failures.length === 0,
      total: context.products.length,
      succeeded: updatedProducts.length,
      failed: failures.length,
      updatedProducts,
      failures,
    };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "No se pudieron recalcular los productos.",
    };
  }
}

export async function deleteProductAction(productId: string) {
  if (!UUID_PATTERN.test(productId)) {
    return { success: false as const, error: "El producto seleccionado no es válido." };
  }

  const supabase = await createClient();
  const { access, error: accessError } = await getCurrentUserAccess(supabase);
  if (accessError || !access.userId || !access.capabilities.accessPlatform) {
    return { success: false as const, error: "No tenés permiso para eliminar productos." };
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("user_id", access.userId)
    .maybeSingle();

  if (productError) return { success: false as const, error: productError.message };
  if (!product) {
    return { success: false as const, error: "No se encontró el producto o no te pertenece." };
  }

  const [componentsResult, requirementsResult] = await Promise.all([
    supabase
      .from("product_components")
      .select("id")
      .eq("product_id", productId)
      .eq("user_id", access.userId)
      .eq("is_active", true),
    supabase
      .from("product_part_requirements")
      .select("id")
      .eq("product_id", productId)
      .eq("user_id", access.userId)
      .eq("is_active", true),
  ]);

  if (componentsResult.error) {
    return { success: false as const, error: componentsResult.error.message };
  }
  if (requirementsResult.error) {
    return { success: false as const, error: requirementsResult.error.message };
  }

  const componentIds = (componentsResult.data || []).map((component) => component.id);
  const requirementIds = (requirementsResult.data || []).map((requirement) => requirement.id);

  if (componentIds.length > 0) {
    const { error } = await supabase
      .from("product_components")
      .update({ is_active: false })
      .in("id", componentIds)
      .eq("user_id", access.userId);
    if (error) return { success: false as const, error: error.message };
  }

  if (requirementIds.length > 0) {
    const { error } = await supabase
      .from("product_part_requirements")
      .update({ is_active: false })
      .in("id", requirementIds)
      .eq("user_id", access.userId);
    if (error) {
      if (componentIds.length > 0) {
        await supabase
          .from("product_components")
          .update({ is_active: true })
          .in("id", componentIds)
          .eq("user_id", access.userId);
      }
      return { success: false as const, error: error.message };
    }
  }

  const { data: archivedProduct, error: archiveError } = await supabase
    .from("products")
    .update({ is_active: false })
    .eq("id", productId)
    .eq("user_id", access.userId)
    .select("id")
    .maybeSingle();

  if (archiveError || !archivedProduct) {
    if (componentIds.length > 0) {
      await supabase
        .from("product_components")
        .update({ is_active: true })
        .in("id", componentIds)
        .eq("user_id", access.userId);
    }
    if (requirementIds.length > 0) {
      await supabase
        .from("product_part_requirements")
        .update({ is_active: true })
        .in("id", requirementIds)
        .eq("user_id", access.userId);
    }
    return {
      success: false as const,
      error: archiveError?.message || "El producto no pudo archivarse.",
    };
  }

  revalidatePath("/productos");
  return { success: true as const, productId: archivedProduct.id };
}
