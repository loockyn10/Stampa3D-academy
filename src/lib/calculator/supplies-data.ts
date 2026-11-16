import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalculatorSupplyRecord, ProductTypeSupplyRecord } from "./supplies";

/**
 * Lecturas del catálogo de insumos con la sesión del usuario (RLS: solo sus filas, solo con acceso a la plataforma).
 * Columnas explícitas (sin `select("*")`). Si la migration 20261117120000 todavía no está aplicada, `available`
 * es false y la Calculadora funciona exactamente como antes (sin insumos).
 */
export const SUPPLY_COLUMNS = "id, name, category, unit, custom_unit_label, unit_cost, archived_at";
export const PRODUCT_TYPE_SUPPLY_COLUMNS = "id, product_type_id, supply_id, quantity, quantity_unit, sort_order";

export interface CalculatorSuppliesData {
  available: boolean;
  supplies: CalculatorSupplyRecord[];
  associations: ProductTypeSupplyRecord[];
}

export async function loadCalculatorSupplies(
  supabase: SupabaseClient,
  userId: string,
  { includeAssociations = true }: { includeAssociations?: boolean } = {},
): Promise<CalculatorSuppliesData> {
  const [suppliesResult, associationsResult] = await Promise.all([
    supabase.from("calculator_supplies").select(SUPPLY_COLUMNS).eq("user_id", userId).order("name"),
    includeAssociations
      ? supabase
          .from("calculator_product_type_supplies")
          .select(PRODUCT_TYPE_SUPPLY_COLUMNS)
          .eq("user_id", userId)
          .order("sort_order")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (suppliesResult.error || associationsResult.error) {
    return { available: false, supplies: [], associations: [] };
  }
  return {
    available: true,
    supplies: (suppliesResult.data ?? []) as CalculatorSupplyRecord[],
    associations: (associationsResult.data ?? []) as ProductTypeSupplyRecord[],
  };
}

/** Mensaje en castellano para los errores de la base de insumos (constraints, triggers, RLS). */
export function supplyErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  const message = error?.message ?? "";
  if (message.includes("calculator_supply_unit_in_use")) {
    return "Este insumo está en tipos de producto: solo podés cambiar a una unidad equivalente (por ejemplo kg ↔ g). Quitalo de esos tipos para cambiar de medida.";
  }
  if (message.includes("calculator_supply_unit_mismatch")) return "La unidad no es compatible con la del insumo.";
  if (message.includes("calculator_supply_archived")) return "Ese insumo está archivado. Reactivalo para usarlo.";
  if (message.includes("calculator_product_type_not_owned") || message.includes("calculator_supply_not_owned")) {
    return "No encontramos ese tipo de producto o insumo en tu cuenta.";
  }
  if (error?.code === "23505") {
    return message.includes("calculator_product_type_supplies_unique")
      ? "Ese insumo ya está en este tipo de producto: editá su cantidad."
      : "Ya tenés un insumo activo con ese nombre.";
  }
  if (error?.code === "23503") {
    return "Este insumo se usa en uno o más tipos de producto. Quitalo de esos tipos o archivalo.";
  }
  if (error?.code === "42501") return "No tenés permiso para modificar este insumo.";
  if (error?.code === "23514") return "Revisá los valores: hay un dato fuera de rango.";
  return "No pudimos guardar el cambio. Probá de nuevo.";
}
