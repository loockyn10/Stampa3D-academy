import { getFilamentDisplayName } from "@/lib/filaments/utils";
import { changedSnapshotSupplies, type CalculatorSupplyRecord } from "@/lib/calculator/supplies";

export interface ProductPricingStatus {
  needsRecalculation: boolean;
  reasons: string[];
}

export const LEGACY_SURCHARGE_REASON = "Precio calculado con el recargo anterior del 30 % sobre insumos";

const LEGACY_SURCHARGE_AMOUNT_KEYS = [
  "other_costs_overhead_amount",
  "otherCostsOverheadAmount",
  "fixed_cost_overhead_amount",
  "fixedCostOverheadAmount",
] as const;

/**
 * D058: el recargo automático del 30 % sobre insumos se eliminó. Un snapshot anterior (sin
 * `supplies_contingency_percent`) que sí aplicó ese recargo queda marcado para recalcular: el precio
 * guardado NO se modifica solo; el usuario decide cuándo recalcular.
 */
export function usesLegacySuppliesSurcharge(snap: Record<string, unknown> | null | undefined): boolean {
  if (!snap || typeof snap !== "object" || "supplies_contingency_percent" in snap) return false;
  return LEGACY_SURCHARGE_AMOUNT_KEYS.some((key) => {
    const value = Number(snap[key]);
    return Number.isFinite(value) && value > 0;
  });
}

export function getProductPricingStatus(
  product: any,
  allFilaments: any[],
  allPrinters: any[],
  allProductTypes: any[],
  /** Catálogo de insumos actual (opcional): detecta cambios de costo de componentes/embalaje guardados. */
  allSupplies?: CalculatorSupplyRecord[] | null,
): ProductPricingStatus {
  const snap = product.calculation_snapshot;
  if (!snap || !snap.source) {
    return { needsRecalculation: true, reasons: ["Producto sin snapshot de costos actualizado"] };
  }

  const reasons: string[] = [];
  if (snap.materials && Array.isArray(snap.materials) && snap.materials.length > 0) {
    for (const material of snap.materials) {
      const currentFilament = allFilaments.find((filament) => filament.id === material.filament_id);
      if (!currentFilament || currentFilament.is_active === false) {
        if (!reasons.includes("Configuración de material no encontrada")) {
          reasons.push("Configuración de material no encontrada");
        }
      } else {
        if (material.filament_purchase_price && material.filament_purchase_price !== currentFilament.purchase_price) {
          reasons.push(`Cambió el precio de ${getFilamentDisplayName(currentFilament)}`);
        }
        if (material.filament_total_grams && material.filament_total_grams !== currentFilament.total_grams) {
          reasons.push(`Cambió la cantidad base de ${getFilamentDisplayName(currentFilament)}`);
        }
      }
    }
  } else if (snap.filament_id || product.filament_id) {
    const filamentId = snap.filament_id || product.filament_id;
    const currentFilament = allFilaments.find((filament) => filament.id === filamentId);
    if (!currentFilament || currentFilament.is_active === false) {
      if (!reasons.includes("Configuración de material no encontrada")) {
        reasons.push("Configuración de material no encontrada");
      }
    } else {
      if (snap.filament_purchase_price && snap.filament_purchase_price !== currentFilament.purchase_price) {
        reasons.push("Cambió el precio del filamento");
      }
      if (snap.filament_total_grams && snap.filament_total_grams !== currentFilament.total_grams) {
        reasons.push("Cambió la cantidad base del filamento");
      }
    }
  }

  if (snap.printer_id || product.printer_id) {
    const printerId = snap.printer_id || product.printer_id;
    const currentPrinter = allPrinters.find((printer) => printer.id === printerId);
    if (!currentPrinter) {
      if (!reasons.includes("Configuración vinculada no encontrada")) {
        reasons.push("Configuración vinculada no encontrada");
      }
    } else {
      if (snap.printer_power_watts && snap.printer_power_watts !== currentPrinter.power_watts) {
        reasons.push("Cambió el consumo de la impresora");
      }
      if (
        snap.printer_maintenance_cost_per_hour !== undefined &&
        snap.printer_maintenance_cost_per_hour !== null &&
        snap.printer_maintenance_cost_per_hour !== currentPrinter.maintenance_cost_per_hour
      ) {
        reasons.push("Cambió el costo de mantenimiento de la impresora");
      }
    }
  }

  if (snap.product_type_id || product.product_type_id) {
    const productTypeId = snap.product_type_id || product.product_type_id;
    const currentProductType = allProductTypes.find((productType) => productType.id === productTypeId);
    if (!currentProductType) {
      if (!reasons.includes("Configuración vinculada no encontrada")) {
        reasons.push("Configuración vinculada no encontrada");
      }
    } else {
      if (snap.product_type_multiplier && snap.product_type_multiplier !== currentProductType.multiplier) {
        reasons.push("Cambió el markup del tipo de producto");
      }
      if (
        snap.product_type_fixed_cost !== undefined &&
        snap.product_type_fixed_cost !== null &&
        snap.product_type_fixed_cost !== currentProductType.fixed_cost
      ) {
        reasons.push("Cambió el costo fijo del tipo de producto");
      }
    }
  }

  for (const name of changedSnapshotSupplies(snap.supplies, allSupplies)) {
    reasons.push(`Cambió el costo de ${name}`);
  }

  if (usesLegacySuppliesSurcharge(snap)) {
    reasons.push(LEGACY_SURCHARGE_REASON);
  }

  return { needsRecalculation: reasons.length > 0, reasons };
}
