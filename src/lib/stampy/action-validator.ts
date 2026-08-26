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

    case "add_filament":
      addMissingFields(
        normalizedExtracted,
        toolContract?.requiredFields ?? ["material"],
        missingFields
      );
      break;

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
