import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductPricingStatus } from "@/lib/products/pricing-status";
import type { StampyProductStockToolIntent, StampyProductStockToolName } from "./product-stock-tool-intents";
import { getStampyToolContract } from "./tool-registry";

export type StampyToolImpact = "read" | "write" | "destructive";

interface OperationalProductData {
  product: any;
  components: any[];
  recipeRows: any[];
  filaments: any[];
  productType: any | null;
  pricingStatus: { needsRecalculation: boolean; reasons: string[] };
  requirements: Array<{
    filamentId: string;
    label: string;
    gramsPerProduct: number;
    availableGrams: number;
  }>;
  recipeIssues: string[];
}

export interface StampyProductStockToolResult {
  success: boolean;
  toolName: StampyProductStockToolName;
  impact: StampyToolImpact;
  confirmationRequired: boolean;
  data?: Record<string, unknown>;
  errorCode?: string;
  message?: string;
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("es-AR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function filamentLabel(filament: any): string {
  return [filament.filament_type, filament.brand, filament.name, filament.color]
    .filter(Boolean)
    .filter((value, index, values) => values.findIndex((candidate) => normalize(candidate) === normalize(value)) === index)
    .join(" ") || "Filamento";
}

async function loadOperationalProduct(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
): Promise<{ data: OperationalProductData | null; errorCode?: string }> {
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, user_id, name, description, stock_quantity, base_cost, sale_price, filament_id, grams, printer_id, product_type_id, print_time_minutes, calculation_snapshot, cost_updated_at, is_active")
    .eq("id", productId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (productError) return { data: null, errorCode: "product_query_failed" };
  if (!product) return { data: null, errorCode: "product_not_found" };

  const [componentsResult, filamentsResult, printersResult, productTypesResult] = await Promise.all([
    supabase
      .from("product_components")
      .select("id, product_id, name, quantity_per_product, sort_order, stock_quantity, is_active")
      .eq("product_id", productId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("filaments")
      .select("id, name, filament_type, brand, color, remaining_grams, total_grams, purchase_price, is_active")
      .eq("user_id", userId)
      .eq("is_active", true),
    supabase
      .from("printers")
      .select("id, name, power_watts, maintenance_cost_per_hour, is_active")
      .eq("user_id", userId)
      .eq("is_active", true),
    supabase
      .from("calculator_product_types")
      .select("id, name, multiplier, fixed_cost, is_active")
      .eq("user_id", userId)
      .eq("is_active", true),
  ]);
  if (componentsResult.error || filamentsResult.error || printersResult.error || productTypesResult.error) {
    return { data: null, errorCode: "product_dependencies_query_failed" };
  }

  const components = componentsResult.data ?? [];
  const filaments = filamentsResult.data ?? [];
  const componentIds = components.map((component) => component.id);
  const recipeResult = componentIds.length > 0
    ? await supabase
        .from("product_component_filaments")
        .select("id, component_id, filament_id, grams, filament_type, brand, name, color, sort_order")
        .eq("user_id", userId)
        .in("component_id", componentIds)
        .order("sort_order", { ascending: true })
    : { data: [], error: null };
  if (recipeResult.error) return { data: null, errorCode: "recipe_query_failed" };

  const recipeRows = recipeResult.data ?? [];
  const filamentsById = new Map(filaments.map((filament) => [filament.id, filament]));
  const requirementTotals = new Map<string, number>();
  const recipeIssues: string[] = [];

  if (components.length > 0) {
    for (const component of components) {
      const rows = recipeRows.filter((row) => row.component_id === component.id);
      if (rows.length === 0) {
        recipeIssues.push(`${component.name} no tiene filamentos configurados.`);
        continue;
      }
      for (const row of rows) {
        const grams = Number(row.grams) * Number(component.quantity_per_product || 1);
        if (!row.filament_id || !Number.isFinite(grams) || grams <= 0) {
          recipeIssues.push(`${component.name} tiene una cantidad o un filamento inválido.`);
          continue;
        }
        requirementTotals.set(row.filament_id, (requirementTotals.get(row.filament_id) ?? 0) + grams);
      }
    }
  } else if (product.filament_id && Number(product.grams) > 0) {
    requirementTotals.set(product.filament_id, Number(product.grams));
  } else {
    recipeIssues.push("El producto no tiene una receta de filamentos válida.");
  }

  const requirements = [...requirementTotals.entries()].map(([filamentId, gramsPerProduct]) => {
    const filament = filamentsById.get(filamentId);
    if (!filament) recipeIssues.push("Un filamento de la receta no está activo o ya no está disponible.");
    return {
      filamentId,
      label: filament ? filamentLabel(filament) : "Filamento no disponible",
      gramsPerProduct,
      availableGrams: Number(filament?.remaining_grams ?? 0),
    };
  });
  const productType = (productTypesResult.data ?? []).find((item) => item.id === product.product_type_id) ?? null;
  const pricingStatus = getProductPricingStatus(
    product,
    filaments,
    printersResult.data ?? [],
    productTypesResult.data ?? [],
  );

  return {
    data: {
      product,
      components,
      recipeRows,
      filaments,
      productType,
      pricingStatus,
      requirements,
      recipeIssues: [...new Set(recipeIssues)],
    },
  };
}

function resultBase(toolName: StampyProductStockToolName) {
  const contract = getStampyToolContract(toolName);
  if (contract) {
    return {
      toolName,
      impact: contract.impact,
      confirmationRequired: contract.confirmationRequired,
    };
  }
  return {
    toolName,
    impact: toolName === "products.production_with_stock_blocked" ? "destructive" as const : "write" as const,
    confirmationRequired: true,
  };
}

export async function executeStampyProductStockTool({
  supabase,
  userId,
  intent,
  recalculateProduct,
}: {
  supabase: SupabaseClient;
  userId: string;
  intent: StampyProductStockToolIntent;
  recalculateProduct?: (productId: string) => Promise<any>;
}): Promise<StampyProductStockToolResult> {
  const base = resultBase(intent.toolName);
  if (intent.clarification || ((intent.toolName.startsWith("products.")) && !intent.productId && !intent.toolName.endsWith("blocked"))) {
    return {
      ...base,
      success: false,
      errorCode: "product_reference_required",
      message: intent.clarification ?? "Decime qué producto querés consultar.",
    };
  }

  if (intent.toolName === "products.batch_recalculate_blocked") {
    return {
      ...base,
      success: false,
      errorCode: "batch_not_available",
      message: "No voy a recalcular todos los productos desde el chat. Podés revisar el alcance y usar “Recalcular Todos” desde Productos.",
    };
  }
  if (intent.toolName === "products.production_with_stock_blocked") {
    return {
      ...base,
      success: false,
      errorCode: "finished_stock_not_available",
      message: "Stampy todavía no registra unidades terminadas en stock. Podés hacerlo desde el flujo de producción en Stock.",
    };
  }

  if (intent.toolName === "stock.filaments.list") {
    const { data, error } = await supabase
      .from("filaments")
      .select("id, name, filament_type, brand, color, remaining_grams, total_grams, is_active")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (error) {
      return { ...base, success: false, errorCode: "filaments_query_failed", message: "No pude consultar tu stock de filamentos ahora." };
    }
    const query = intent.filamentQuery ?? {};
    const matches = (data ?? [])
      .filter((filament) => !intent.filamentId || filament.id === intent.filamentId)
      .filter((filament) => !query.material || normalize(filament.filament_type).includes(normalize(query.material)))
      .filter((filament) => !query.color || normalize(filament.color).includes(normalize(query.color)))
      .filter((filament) => !query.brand || normalize(filament.brand).includes(normalize(query.brand)))
      .filter((filament) => !query.lowStockOnly || Number(filament.remaining_grams) < 200)
      .sort((a, b) => Number(a.remaining_grams) - Number(b.remaining_grams))
      .slice(0, 20)
      .map((filament) => ({
        label: filamentLabel(filament),
        remainingGrams: Number(filament.remaining_grams ?? 0),
        totalGrams: Number(filament.total_grams ?? 0),
      }));
    return {
      ...base,
      success: true,
      data: { filaments: matches, totalRemainingGrams: matches.reduce((total, filament) => total + filament.remainingGrams, 0) },
    };
  }

  const loaded = await loadOperationalProduct(supabase, userId, intent.productId!);
  if (!loaded.data) {
    return {
      ...base,
      success: false,
      errorCode: loaded.errorCode,
      message: loaded.errorCode === "product_not_found"
        ? "No encontré ese producto activo o no te pertenece."
        : "No pude consultar los datos actuales del producto.",
    };
  }
  const operational = loaded.data;
  const product = operational.product;

  if (intent.toolName === "products.inspect") {
    const snapshot = product.calculation_snapshot && typeof product.calculation_snapshot === "object"
      ? product.calculation_snapshot
      : {};
    return {
      ...base,
      success: true,
      data: {
        aspect: intent.aspect ?? "summary",
        product: {
          name: product.name,
          stock: Number(product.stock_quantity ?? 0),
          baseCost: Number(product.base_cost ?? 0),
          salePrice: Number(product.sale_price ?? 0),
          profit: Number(product.sale_price ?? 0) - Number(product.base_cost ?? 0),
          marginPercent: Number(product.sale_price) > 0
            ? ((Number(product.sale_price) - Number(product.base_cost)) / Number(product.sale_price)) * 100
            : 0,
          productType: operational.productType?.name ?? null,
        },
        pricingStatus: operational.pricingStatus,
        priceBreakdown: {
          materialCost: Number(snapshot.filament_cost_with_waste ?? snapshot.material_cost ?? 0),
          electricityCost: Number(snapshot.electricity_cost ?? 0),
          maintenanceCost: Number(snapshot.maintenance_cost ?? 0),
          fixedCost: Number(snapshot.fixed_cost_adjusted ?? snapshot.fixed_cost ?? 0),
          laborCost: Number(snapshot.labor_cost ?? 0),
          otherCosts: Number(snapshot.other_costs_adjusted ?? snapshot.other_costs ?? 0),
          multiplier: Number(snapshot.multiplier ?? snapshot.product_type_multiplier ?? 0),
        },
        recipe: operational.requirements.map((requirement) => ({
          label: requirement.label,
          gramsPerProduct: requirement.gramsPerProduct,
        })),
        recipeIssues: operational.recipeIssues,
        components: operational.components.map((component) => ({
          name: component.name,
          quantityPerProduct: Number(component.quantity_per_product ?? 1),
        })),
      },
    };
  }

  if (intent.toolName === "products.recalculate") {
    if (!recalculateProduct) {
      return { ...base, success: false, errorCode: "recalculation_unavailable", message: "No pude iniciar el recálculo ahora." };
    }
    const previousPrice = Number(product.sale_price ?? 0);
    const recalculation = await recalculateProduct(product.id);
    if (!recalculation?.success || !recalculation.product) {
      console.error("[Stampy] product recalculation failed", String(recalculation?.error ?? "unknown").substring(0, 200));
      return {
        ...base,
        success: false,
        errorCode: "recalculation_failed",
        message: "No pude recalcular el producto con sus datos actuales.",
      };
    }
    const newPrice = Number(recalculation.product.sale_price ?? 0);
    return {
      ...base,
      success: true,
      data: {
        productName: product.name,
        previousPrice,
        newPrice,
        difference: newPrice - previousPrice,
        baseCost: Number(recalculation.product.base_cost ?? 0),
        status: "updated",
      },
    };
  }

  const quantity = intent.quantity;
  const maxProducible = operational.requirements.length > 0 && operational.recipeIssues.length === 0
    ? Math.min(...operational.requirements.map((requirement) => Math.floor(requirement.availableGrams / requirement.gramsPerProduct)))
    : 0;
  const requirements = operational.requirements.map((requirement) => {
    const requiredGrams = quantity ? requirement.gramsPerProduct * quantity : requirement.gramsPerProduct;
    return {
      label: requirement.label,
      gramsPerProduct: requirement.gramsPerProduct,
      requiredGrams,
      availableGrams: requirement.availableGrams,
      missingGrams: Math.max(0, requiredGrams - requirement.availableGrams),
    };
  });
  return {
    ...base,
    success: operational.recipeIssues.length === 0 && operational.requirements.length > 0,
    errorCode: operational.recipeIssues.length > 0 ? "invalid_recipe" : undefined,
    message: operational.recipeIssues[0],
    data: {
      productName: product.name,
      quantity,
      sufficient: quantity ? requirements.every((requirement) => requirement.missingGrams === 0) : null,
      maxProducible,
      requirements,
      recipeIssues: operational.recipeIssues,
    },
  };
}

function formatMoney(value: unknown): string {
  const amount = Number(value);
  return `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0)}`;
}

export function formatStampyProductStockToolResult(result: StampyProductStockToolResult): string {
  if (!result.success && !result.data) return result.message ?? "No pude completar esa consulta.";
  const data = result.data ?? {};

  if (result.toolName === "stock.filaments.list") {
    const filaments = (data.filaments ?? []) as Array<{ label: string; remainingGrams: number }>;
    if (filaments.length === 0) return "No encontré filamentos activos que coincidan con esa descripción.";
    if (filaments.length === 1) return `**${filaments[0].label}**\n${filaments[0].remainingGrams} g disponibles.`;
    return `Tenés **${Number(data.totalRemainingGrams)} g en total** entre ${filaments.length} bobinas:\n\n${filaments.map((filament) => `- **${filament.label}:** ${filament.remainingGrams} g`).join("\n")}`;
  }

  if (result.toolName === "products.recalculate") {
    if (!result.success) return result.message ?? "No pude recalcular el producto.";
    return `**${String(data.productName)} quedó actualizado.**\n\n- Precio anterior: ${formatMoney(data.previousPrice)}\n- Precio nuevo: ${formatMoney(data.newPrice)}\n- Diferencia: ${formatMoney(data.difference)}`;
  }

  if (result.toolName === "products.production_capacity") {
    const requirements = (data.requirements ?? []) as Array<{ label: string; requiredGrams: number; availableGrams: number; missingGrams: number }>;
    if (!result.success) return result.message ?? "El producto no tiene una receta válida para calcular la capacidad.";
    if (!data.quantity) {
      return `Con el stock actual podés fabricar como máximo **${Number(data.maxProducible)} unidades de ${String(data.productName)}**.`;
    }
    const headline = data.sufficient
      ? `**Sí, te alcanza para fabricar ${Number(data.quantity)} de ${String(data.productName)}.**`
      : `**No te alcanza para fabricar ${Number(data.quantity)} de ${String(data.productName)}.** Con el stock actual podés hacer ${Number(data.maxProducible)}.`;
    const lines = requirements.map((requirement) => `- **${requirement.label}:** necesitás ${requirement.requiredGrams} g, tenés ${requirement.availableGrams} g${requirement.missingGrams > 0 ? `, faltan ${requirement.missingGrams} g` : ""}`);
    return `${headline}\n\n${lines.join("\n")}`;
  }

  const product = data.product as Record<string, unknown> | undefined;
  const aspect = data.aspect;
  if (!product) return result.message ?? "No pude consultar el producto.";
  if (aspect === "profit") {
    return `**${String(product.name)}** deja una ganancia estimada de **${formatMoney(product.profit)} por unidad**, con un margen de ${Number(product.marginPercent).toFixed(1)}%.`;
  }
  if (aspect === "recipe") {
    const recipe = (data.recipe ?? []) as Array<{ label: string; gramsPerProduct: number }>;
    if (recipe.length === 0) return result.message ?? `${String(product.name)} no tiene una receta de filamentos válida.`;
    return `**${String(product.name)} usa:**\n\n${recipe.map((item) => `- ${item.gramsPerProduct} g de **${item.label}** por unidad`).join("\n")}`;
  }
  const pricingStatus = data.pricingStatus as { needsRecalculation?: boolean; reasons?: string[] } | undefined;
  if (pricingStatus?.needsRecalculation) {
    return `⚠️ **${String(product.name)} necesita recálculo.**\n\n${(pricingStatus.reasons ?? []).map((reason) => `- ${reason}`).join("\n")}`;
  }
  const breakdown = data.priceBreakdown as Record<string, unknown> | undefined;
  const costLines = breakdown
    ? [
        ["Material", breakdown.materialCost],
        ["Electricidad", breakdown.electricityCost],
        ["Mantenimiento", breakdown.maintenanceCost],
        ["Costo fijo", breakdown.fixedCost],
        ["Mano de obra", breakdown.laborCost],
        ["Otros costos", breakdown.otherCosts],
      ]
        .filter(([, value]) => Number(value) > 0)
        .map(([label, value]) => `- ${label}: ${formatMoney(value)}`)
    : [];
  const detail = costLines.length > 0
    ? `\n\nEl cálculo guardado incluye:\n${costLines.join("\n")}${Number(breakdown?.multiplier) > 0 ? `\n- Multiplicador: ×${Number(breakdown?.multiplier)}` : ""}`
    : "";
  return `**${String(product.name)} tiene el precio actualizado:** ${formatMoney(product.salePrice)}. Su costo base es ${formatMoney(product.baseCost)}.${detail}`;
}
