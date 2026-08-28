export interface FilamentMutationInput {
  name?: unknown;
  filament_type?: unknown;
  brand?: unknown;
  color?: unknown;
  color_hex?: unknown;
  total_grams?: unknown;
  remaining_grams?: unknown;
  purchase_price?: unknown;
  is_active?: unknown;
  source_template_id?: unknown;
  [key: string]: unknown;
}

export interface FilamentMutationPayload {
  name: string | null;
  filament_type: string;
  brand: string | null;
  color: string | null;
  color_hex: string | null;
  total_grams: number;
  remaining_grams: number;
  purchase_price: number;
  is_active: boolean;
  source_template_id: string | null;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function numberOrZero(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildFilamentMutationPayload(
  input: FilamentMutationInput,
): FilamentMutationPayload {
  return {
    name: optionalText(input.name),
    filament_type: optionalText(input.filament_type) || "PLA",
    brand: optionalText(input.brand),
    color: optionalText(input.color),
    color_hex: optionalText(input.color_hex),
    total_grams: numberOrZero(input.total_grams),
    remaining_grams: numberOrZero(input.remaining_grams),
    purchase_price: numberOrZero(input.purchase_price),
    is_active: typeof input.is_active === "boolean" ? input.is_active : true,
    source_template_id: optionalText(input.source_template_id),
  };
}

export function buildFilamentInsertPayload(
  input: FilamentMutationInput,
  userId: string,
): FilamentMutationPayload & { user_id: string } {
  return {
    ...buildFilamentMutationPayload(input),
    user_id: userId,
  };
}
