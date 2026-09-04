type NumberValue = number | string | null | undefined;

export interface BudgetCatalogProduct {
  id: string;
  name: string;
  base_cost: NumberValue;
  sale_price: NumberValue;
}

export interface BudgetItemEconomicsInput {
  id: string;
  product_id: string;
  item_name: string;
  quantity: NumberValue;
  unit_price: NumberValue;
  unit_base_cost: NumberValue;
  commercial_description?: string | null;
  material?: string | null;
  color?: string | null;
  finish?: string | null;
  technology?: string | null;
  commercial_notes?: string | null;
}

export interface CompleteBudgetItem {
  id: string;
  product_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  unit_base_cost: number;
  unit_profit: number;
  total_profit: number;
  commercial_description: string;
  material: string;
  color: string;
  finish: string;
  technology: string;
  commercial_notes: string;
}

type BudgetItemResult =
  | { success: true; item: CompleteBudgetItem }
  | { success: false; error: string };

function requiredNumber(value: NumberValue): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeBudgetItemEconomics(input: BudgetItemEconomicsInput): BudgetItemResult {
  const quantity = requiredNumber(input.quantity);
  const unitPrice = requiredNumber(input.unit_price);
  const unitBaseCost = requiredNumber(input.unit_base_cost);

  if (!input.product_id || !input.item_name.trim()) {
    return { success: false, error: "El producto del presupuesto está incompleto." };
  }
  if (quantity === null || quantity <= 0) {
    return { success: false, error: "La cantidad del producto no es válida." };
  }
  if (unitPrice === null || unitPrice < 0) {
    return { success: false, error: "No se pudo obtener el precio de venta del producto." };
  }
  if (unitBaseCost === null || unitBaseCost < 0) {
    return {
      success: false,
      error: "No se pudo obtener el costo del producto. Recalculá el producto e intentá nuevamente.",
    };
  }

  const unitProfit = unitPrice - unitBaseCost;
  return {
    success: true,
    item: {
      id: input.id,
      product_id: input.product_id,
      item_name: input.item_name,
      quantity,
      unit_price: unitPrice,
      subtotal: unitPrice * quantity,
      unit_base_cost: unitBaseCost,
      unit_profit: unitProfit,
      total_profit: unitProfit * quantity,
      commercial_description: input.commercial_description?.trim() || "",
      material: input.material?.trim() || "",
      color: input.color?.trim() || "",
      finish: input.finish?.trim() || "",
      technology: input.technology?.trim() || "",
      commercial_notes: input.commercial_notes?.trim() || "",
    },
  };
}

export function buildBudgetItemFromProduct(
  product: BudgetCatalogProduct,
  quantity: NumberValue = 1,
  itemId = `temp-${Date.now()}`,
): BudgetItemResult {
  return normalizeBudgetItemEconomics({
    id: itemId,
    product_id: product.id,
    item_name: product.name,
    quantity,
    unit_price: product.sale_price,
    unit_base_cost: product.base_cost,
  });
}
