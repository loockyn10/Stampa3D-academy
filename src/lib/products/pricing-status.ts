export interface ProductPricingStatus {
  needsRecalculation: boolean;
  reasons: string[];
}

export function getProductPricingStatus(
  product: any,
  allFilaments: any[],
  allPrinters: any[],
  allProductTypes: any[],
): ProductPricingStatus {
  const snap = product.calculation_snapshot;
  if (!snap || !snap.source) {
    return { needsRecalculation: true, reasons: ["Producto sin snapshot de costos actualizado"] };
  }

  const reasons: string[] = [];
  if (snap.materials && Array.isArray(snap.materials) && snap.materials.length > 0) {
    for (const material of snap.materials) {
      const currentFilament = allFilaments.find((filament) => filament.id === material.filament_id);
      if (!currentFilament) {
        if (!reasons.includes("Configuración de material no encontrada")) {
          reasons.push("Configuración de material no encontrada");
        }
      } else {
        if (material.filament_purchase_price && material.filament_purchase_price !== currentFilament.purchase_price) {
          reasons.push(`Cambió el precio de ${currentFilament.name}`);
        }
        if (material.filament_total_grams && material.filament_total_grams !== currentFilament.total_grams) {
          reasons.push(`Cambió la cantidad base de ${currentFilament.name}`);
        }
      }
    }
  } else if (snap.filament_id || product.filament_id) {
    const filamentId = snap.filament_id || product.filament_id;
    const currentFilament = allFilaments.find((filament) => filament.id === filamentId);
    if (!currentFilament) {
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

  return { needsRecalculation: reasons.length > 0, reasons };
}
