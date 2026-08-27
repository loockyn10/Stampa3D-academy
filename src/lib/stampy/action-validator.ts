import type { StampyActionIntent } from "./types";
import type { StampyToolContract } from "./tool-registry";

export interface StampyActionValidationResult {
  isValid: boolean;
  missingFields: string[];
  invalidFields: string[];
  warnings: string[];
  normalizedExtracted: Record<string, unknown>;
}

interface ValidateStampyActionIntentParams {
  actionIntent: StampyActionIntent;
  toolContract?: StampyToolContract | null;
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function normalizePositiveNumber(
  extracted: Record<string, unknown>,
  field: string,
  invalidFields: string[]
) {
  const value = extracted[field];
  if (!hasValue(value)) return;

  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    invalidFields.push(field);
    return;
  }

  extracted[field] = normalized;
}

function normalizeNonNegativeNumber(
  extracted: Record<string, unknown>,
  field: string,
  invalidFields: string[]
) {
  const value = extracted[field];
  if (!hasValue(value)) return;

  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    invalidFields.push(field);
    return;
  }

  extracted[field] = normalized;
}

function normalizeFilamentGrams(extracted: Record<string, unknown>) {
  const value = extracted.grams;
  if (typeof value !== "string") return;

  const normalized = value.trim().toLowerCase();
  if (normalized === "un rollo" || normalized === "1 rollo" || normalized === "un kilo") {
    extracted.grams = 1000;
  }
}

function addMissingFields(
  extracted: Record<string, unknown>,
  fields: string[],
  missingFields: string[]
) {
  for (const field of fields) {
    if (!hasValue(extracted[field])) missingFields.push(field);
  }
}

export function validateStampyActionIntent({
  actionIntent,
  toolContract,
}: ValidateStampyActionIntentParams): StampyActionValidationResult {
  const normalizedExtracted = { ...(actionIntent.extracted ?? {}) };
  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const warnings: string[] = [];

  if (toolContract && !toolContract.supportedIntents.includes(actionIntent.type)) {
    invalidFields.push("toolContract");
  }

  switch (actionIntent.type) {
    case "create_quote":
      addMissingFields(
        normalizedExtracted,
        toolContract?.requiredFields ?? ["clientName", "productName", "quantity"],
        missingFields
      );
      normalizePositiveNumber(normalizedExtracted, "quantity", invalidFields);
      warnings.push("El precio debe definirse y revisarse dentro de Presupuestos.");
      break;

    case "calculate_price":
      for (const field of toolContract?.requiredFields ?? ["grams", "hours"]) {
        if (!hasValue(normalizedExtracted[field])) missingFields.push(field);
        normalizePositiveNumber(normalizedExtracted, field, invalidFields);
      }
      warnings.push("Revisá manualmente impresora, filamento y tipo de producto en la calculadora.");
      warnings.push("El precio debe calcularse dentro de la herramienta.");
      break;

    case "increase_filament_stock": {
      normalizeFilamentGrams(normalizedExtracted);
      addMissingFields(
        normalizedExtracted,
        toolContract?.requiredFields ?? ["grams"],
        missingFields
      );
      normalizePositiveNumber(normalizedExtracted, "grams", invalidFields);

      const hasReference = ["material", "color", "brand"].some((field) =>
        hasValue(normalizedExtracted[field])
      );
      if (!hasReference) missingFields.push("filamentReference");
      break;
    }

    case "discount_filament": {
      addMissingFields(
        normalizedExtracted,
        toolContract?.requiredFields ?? ["grams"],
        missingFields
      );
      normalizePositiveNumber(normalizedExtracted, "grams", invalidFields);

      const hasReference = ["material", "color", "brand"].some((field) =>
        hasValue(normalizedExtracted[field])
      );
      if (!hasReference) missingFields.push("filamentReference");
      break;
    }

    case "discount_product_filaments": {
      const items = Array.isArray(normalizedExtracted.items)
        ? normalizedExtracted.items
        : [];
      if (items.length === 0) missingFields.push("items");
      if (items.length > 10) invalidFields.push("items");

      normalizedExtracted.items = items.map((item, index) => {
        if (!item || typeof item !== "object") {
          invalidFields.push(`items.${index}`);
          return item;
        }
        const normalizedItem = { ...(item as Record<string, unknown>) };
        const productName = normalizedItem.productName;
        if (
          typeof productName !== "string" ||
          productName.trim().length < 2 ||
          productName.trim().length > 160 ||
          !/[\p{L}\p{N}]/u.test(productName)
        ) {
          invalidFields.push(`items.${index}.productName`);
        } else {
          normalizedItem.productName = productName.trim();
        }

        const quantity = Number(normalizedItem.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 50) {
          invalidFields.push(`items.${index}.quantity`);
        } else {
          normalizedItem.quantity = quantity;
        }
        return normalizedItem;
      });
      warnings.push("Esta acción no se autoejecuta y requiere confirmación explícita.");
      warnings.push(
        "Solo se descontarán filamentos; no baja el stock de productos terminados todavía."
      );
      break;
    }

    case "add_filament":
      addMissingFields(
        normalizedExtracted,
        toolContract?.requiredFields ?? ["material"],
        missingFields
      );
      if (!hasValue(normalizedExtracted.totalGrams)) {
        normalizedExtracted.totalGrams = 1000;
        normalizedExtracted.totalGramsAssumed = true;
      }
      normalizePositiveNumber(normalizedExtracted, "totalGrams", invalidFields);
      if (normalizedExtracted.totalGramsAssumed === true) {
        warnings.push("Como no indicaste el peso, se asumirá un rollo de 1000g.");
      }
      break;

    case "add_printer":
      addMissingFields(
        normalizedExtracted,
        toolContract?.requiredFields ?? ["printerName"],
        missingFields
      );
      if (!hasValue(normalizedExtracted.powerWatts)) {
        normalizedExtracted.powerWatts = 0;
        normalizedExtracted.powerWattsAssumed = true;
      }
      if (!hasValue(normalizedExtracted.maintenanceCostPerHour)) {
        normalizedExtracted.maintenanceCostPerHour = 0;
        normalizedExtracted.maintenanceCostPerHourAssumed = true;
      }
      normalizeNonNegativeNumber(normalizedExtracted, "powerWatts", invalidFields);
      normalizeNonNegativeNumber(
        normalizedExtracted,
        "maintenanceCostPerHour",
        invalidFields
      );
      if (normalizedExtracted.powerWattsAssumed === true) {
        warnings.push(
          "Potencia no especificada; queda en 0W para completar después."
        );
      }
      if (normalizedExtracted.maintenanceCostPerHourAssumed === true) {
        warnings.push(
          "Mantenimiento por hora no especificado; queda en $0 para completar después."
        );
      }
      break;

    case "create_product": {
      addMissingFields(
        normalizedExtracted,
        toolContract?.requiredFields ?? ["productName"],
        missingFields
      );
      normalizeNonNegativeNumber(
        normalizedExtracted,
        "initialStock",
        invalidFields
      );
      normalizeNonNegativeNumber(
        normalizedExtracted,
        "printTimeMinutes",
        invalidFields
      );
      normalizeNonNegativeNumber(normalizedExtracted, "baseCost", invalidFields);
      normalizeNonNegativeNumber(normalizedExtracted, "salePrice", invalidFields);

      if (
        hasValue(normalizedExtracted.printTimeMinutes) &&
        !invalidFields.includes("printTimeMinutes") &&
        (!Number.isInteger(normalizedExtracted.printTimeMinutes) ||
          Number(normalizedExtracted.printTimeMinutes) > 100000000)
      ) {
        invalidFields.push("printTimeMinutes");
      }
      for (const field of ["baseCost", "salePrice"]) {
        if (
          hasValue(normalizedExtracted[field]) &&
          !invalidFields.includes(field) &&
          Number(normalizedExtracted[field]) > 1000000000000
        ) {
          invalidFields.push(field);
        }
      }

      const productName = normalizedExtracted.productName;
      if (
        hasValue(productName) &&
        (typeof productName !== "string" ||
          productName.trim().length < 2 ||
          productName.trim().length > 160 ||
          !/[\p{L}\p{N}]/u.test(productName))
      ) {
        invalidFields.push("productName");
      }
      if (
        hasValue(normalizedExtracted.initialStock) &&
        !invalidFields.includes("initialStock") &&
        (!Number.isInteger(normalizedExtracted.initialStock) ||
          Number(normalizedExtracted.initialStock) > 100000000)
      ) {
        invalidFields.push("initialStock");
      }

      const components = Array.isArray(normalizedExtracted.components)
        ? normalizedExtracted.components
        : [];
      const normalizedComponents = components.map((component, index) => {
        if (!component || typeof component !== "object") {
          invalidFields.push(`components.${index}`);
          return component;
        }

        const normalizedComponent = {
          ...(component as Record<string, unknown>),
        };
        normalizePositiveNumber(
          normalizedComponent,
          "grams",
          invalidFields
        );
        if (!hasValue(normalizedComponent.material)) {
          invalidFields.push(`components.${index}.material`);
        }
        return normalizedComponent;
      });
      normalizedExtracted.components = normalizedComponents;

      if (normalizedComponents.length === 0) {
        warnings.push("No indicaste receta de filamentos.");
      }
      if (!hasValue(normalizedExtracted.initialStock)) {
        warnings.push("No se indicó stock inicial; se usará 0.");
      }
      if (!hasValue(normalizedExtracted.printTimeMinutes)) {
        warnings.push("No indicaste tiempo de impresión.");
      }
      if (!hasValue(normalizedExtracted.baseCost)) {
        warnings.push("No indicaste costo base.");
      }
      if (!hasValue(normalizedExtracted.salePrice)) {
        warnings.push("No indicaste precio de venta.");
      }
      break;
    }

    default:
      if (toolContract) {
        addMissingFields(normalizedExtracted, toolContract.requiredFields, missingFields);
      }
  }

  return {
    isValid: missingFields.length === 0 && invalidFields.length === 0,
    missingFields,
    invalidFields,
    warnings,
    normalizedExtracted,
  };
}
