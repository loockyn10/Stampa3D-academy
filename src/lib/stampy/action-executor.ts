import type { SupabaseClient } from "@supabase/supabase-js";

export type ConfirmableFilamentAction =
  | "increase_filament_stock"
  | "discount_filament";

export interface ResolvedFilament {
  id: string;
  user_id: string;
  name: string | null;
  filament_type: string | null;
  brand: string | null;
  color: string | null;
  remaining_grams: number;
  total_grams: number | null;
  is_active: boolean;
  filament_templates?: { brand?: string | null } | null;
}

export interface FilamentMatchResult {
  status: "unique" | "none" | "multiple";
  filament?: ResolvedFilament;
  matches?: ResolvedFilament[];
  error?: string;
}

interface ResolveFilamentMatchParams {
  supabase: SupabaseClient;
  userId: string;
  extracted: Record<string, unknown>;
}

export interface FilamentMovementExecutionResult {
  success: boolean;
  actionRequestId: string | null;
  filamentId: string | null;
  previousRemainingGrams: number | null;
  newRemainingGrams: number | null;
  deltaGrams: number | null;
  errorCode: string | null;
  message: string;
}

interface ExecuteFilamentStockMovementParams {
  supabase: SupabaseClient;
  actionRequestId: string;
}

interface RpcMovementResult {
  success: boolean;
  action_request_id: string | null;
  filament_id: string | null;
  previous_remaining_grams: number | string | null;
  new_remaining_grams: number | string | null;
  delta_grams: number | string | null;
  error_code: string | null;
  message: string;
}

function normalizeMatchText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function matchesReference(candidate: unknown, reference: unknown): boolean {
  const normalizedCandidate = normalizeMatchText(candidate);
  const normalizedReference = normalizeMatchText(reference);
  if (!normalizedCandidate || !normalizedReference) return false;
  return (
    normalizedCandidate.includes(normalizedReference) ||
    normalizedReference.includes(normalizedCandidate)
  );
}

function readTemplateBrand(filament: ResolvedFilament): string | null {
  return filament.filament_templates?.brand ?? null;
}

export function getResolvedFilamentLabel(filament: ResolvedFilament): string {
  const parts = [
    filament.filament_type,
    filament.brand ?? readTemplateBrand(filament),
    filament.name,
    filament.color,
  ].filter((part): part is string => Boolean(part?.trim()));

  return Array.from(new Set(parts)).join(" · ") || "Filamento sin nombre";
}

export async function resolveFilamentMatch({
  supabase,
  userId,
  extracted,
}: ResolveFilamentMatchParams): Promise<FilamentMatchResult> {
  const material = normalizeMatchText(extracted.material);
  const brand = normalizeMatchText(extracted.brand);
  const color = normalizeMatchText(extracted.color);
  const name = normalizeMatchText(extracted.name);

  if (!material && !brand && !color && !name) {
    return { status: "none", matches: [] };
  }

  const { data, error } = await supabase
    .from("filaments")
    .select(
      "id, user_id, name, filament_type, brand, color, remaining_grams, total_grams, is_active, filament_templates(brand)"
    )
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    return { status: "none", matches: [], error: error.message };
  }

  const filaments = (data ?? []) as ResolvedFilament[];
  const matches = filaments.filter((filament) => {
    if (material && !matchesReference(filament.filament_type, material)) return false;
    if (
      brand &&
      !matchesReference(filament.brand, brand) &&
      !matchesReference(readTemplateBrand(filament), brand) &&
      !matchesReference(filament.name, brand)
    ) {
      return false;
    }
    if (
      color &&
      !matchesReference(filament.color, color) &&
      !matchesReference(filament.name, color)
    ) {
      return false;
    }
    if (name && !matchesReference(filament.name, name)) return false;
    return true;
  });

  if (matches.length === 1) {
    return { status: "unique", filament: matches[0], matches };
  }

  return {
    status: matches.length === 0 ? "none" : "multiple",
    matches,
  };
}

function toNullableNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export async function executeFilamentStockMovement({
  supabase,
  actionRequestId,
}: ExecuteFilamentStockMovementParams): Promise<FilamentMovementExecutionResult> {
  const { data, error } = await supabase.rpc("confirm_stampy_filament_movement", {
    p_action_request_id: actionRequestId,
  });

  if (error) {
    return {
      success: false,
      actionRequestId,
      filamentId: null,
      previousRemainingGrams: null,
      newRemainingGrams: null,
      deltaGrams: null,
      errorCode: "rpc_error",
      message: error.message || "No pude confirmar el movimiento de filamento.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as RpcMovementResult | null;
  if (!row) {
    return {
      success: false,
      actionRequestId,
      filamentId: null,
      previousRemainingGrams: null,
      newRemainingGrams: null,
      deltaGrams: null,
      errorCode: "empty_rpc_result",
      message: "La confirmación no devolvió un resultado válido.",
    };
  }

  return {
    success: row.success === true,
    actionRequestId: row.action_request_id,
    filamentId: row.filament_id,
    previousRemainingGrams: toNullableNumber(row.previous_remaining_grams),
    newRemainingGrams: toNullableNumber(row.new_remaining_grams),
    deltaGrams: toNullableNumber(row.delta_grams),
    errorCode: row.error_code,
    message: row.message,
  };
}
