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

export interface DuplicateFilamentResult {
  status: "clear" | "duplicate" | "error";
  filament?: ResolvedFilament;
  error?: string;
}

export interface ResolvedPrinter {
  id: string;
  user_id: string;
  name: string;
  power_watts: number;
  maintenance_cost_per_hour: number;
  is_active: boolean;
  source_template_id: string | null;
}

export interface DuplicatePrinterResult {
  status:
    | "clear"
    | "active_duplicate"
    | "inactive_match"
    | "ambiguous"
    | "error";
  printer?: ResolvedPrinter;
  matches?: ResolvedPrinter[];
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

export interface CreateFilamentExecutionResult {
  success: boolean;
  actionRequestId: string | null;
  filamentId: string | null;
  label: string | null;
  totalGrams: number | null;
  remainingGrams: number | null;
  errorCode: string | null;
  message: string;
}

export interface CreatePrinterExecutionResult {
  success: boolean;
  actionRequestId: string | null;
  printerId: string | null;
  printerName: string | null;
  powerWatts: number | null;
  maintenanceCostPerHour: number | null;
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

interface RpcCreateFilamentResult {
  success: boolean;
  action_request_id: string | null;
  filament_id: string | null;
  label: string | null;
  total_grams: number | string | null;
  remaining_grams: number | string | null;
  error_code: string | null;
  message: string;
}

interface RpcCreatePrinterResult {
  success: boolean;
  action_request_id: string | null;
  printer_id: string | null;
  printer_name: string | null;
  power_watts: number | string | null;
  maintenance_cost_per_hour: number | string | null;
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

export async function findDuplicateActiveFilament({
  supabase,
  userId,
  extracted,
}: ResolveFilamentMatchParams): Promise<DuplicateFilamentResult> {
  const material = normalizeMatchText(extracted.material);
  const brand = normalizeMatchText(extracted.brand);
  const name = normalizeMatchText(extracted.name);
  const color = normalizeMatchText(extracted.color ?? "Sin color");

  if (!material) return { status: "error", error: "missing_material" };

  const { data, error } = await supabase
    .from("filaments")
    .select(
      "id, user_id, name, filament_type, brand, color, remaining_grams, total_grams, is_active, filament_templates(brand)"
    )
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) return { status: "error", error: error.message };

  const duplicate = ((data ?? []) as ResolvedFilament[]).find((filament) => {
    const filamentBrand = normalizeMatchText(
      filament.brand ?? readTemplateBrand(filament)
    );
    return (
      normalizeMatchText(filament.filament_type) === material &&
      filamentBrand === brand &&
      normalizeMatchText(filament.name) === name &&
      normalizeMatchText(filament.color ?? "Sin color") === color
    );
  });

  return duplicate
    ? { status: "duplicate", filament: duplicate }
    : { status: "clear" };
}

export async function findDuplicatePrinter({
  supabase,
  userId,
  printerName,
}: {
  supabase: SupabaseClient;
  userId: string;
  printerName: string;
}): Promise<DuplicatePrinterResult> {
  const normalizedRequestedName = normalizeMatchText(printerName);
  if (!normalizedRequestedName) {
    return { status: "error", matches: [], error: "missing_printer_name" };
  }

  const { data, error } = await supabase
    .from("printers")
    .select(
      "id, user_id, name, power_watts, maintenance_cost_per_hour, is_active, source_template_id"
    )
    .eq("user_id", userId);

  if (error) return { status: "error", matches: [], error: error.message };

  const printers = (data ?? []) as ResolvedPrinter[];
  const exactMatches = printers.filter(
    (printer) => normalizeMatchText(printer.name) === normalizedRequestedName
  );
  const candidates =
    exactMatches.length > 0
      ? exactMatches
      : printers.filter((printer) => {
          const normalizedName = normalizeMatchText(printer.name);
          return (
            normalizedName.includes(normalizedRequestedName) ||
            normalizedRequestedName.includes(normalizedName)
          );
        });

  if (candidates.length === 0) return { status: "clear", matches: [] };
  if (candidates.length > 1) return { status: "ambiguous", matches: candidates };

  const printer = candidates[0];
  return printer.is_active
    ? { status: "active_duplicate", printer, matches: candidates }
    : { status: "inactive_match", printer, matches: candidates };
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

export async function executeCreateFilament({
  supabase,
  actionRequestId,
}: ExecuteFilamentStockMovementParams): Promise<CreateFilamentExecutionResult> {
  const { data, error } = await supabase.rpc("confirm_stampy_create_filament", {
    p_action_request_id: actionRequestId,
  });

  if (error) {
    return {
      success: false,
      actionRequestId,
      filamentId: null,
      label: null,
      totalGrams: null,
      remainingGrams: null,
      errorCode: "rpc_error",
      message: error.message || "No pude crear el filamento.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | RpcCreateFilamentResult
    | null;
  if (!row) {
    return {
      success: false,
      actionRequestId,
      filamentId: null,
      label: null,
      totalGrams: null,
      remainingGrams: null,
      errorCode: "empty_rpc_result",
      message: "La creación no devolvió un resultado válido.",
    };
  }

  return {
    success: row.success === true,
    actionRequestId: row.action_request_id,
    filamentId: row.filament_id,
    label: row.label,
    totalGrams: toNullableNumber(row.total_grams),
    remainingGrams: toNullableNumber(row.remaining_grams),
    errorCode: row.error_code,
    message: row.message,
  };
}

export async function executeCreatePrinter({
  supabase,
  actionRequestId,
}: ExecuteFilamentStockMovementParams): Promise<CreatePrinterExecutionResult> {
  const { data, error } = await supabase.rpc("confirm_stampy_create_printer", {
    p_action_request_id: actionRequestId,
  });

  if (error) {
    return {
      success: false,
      actionRequestId,
      printerId: null,
      printerName: null,
      powerWatts: null,
      maintenanceCostPerHour: null,
      errorCode: "rpc_error",
      message: error.message || "No pude crear la impresora.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | RpcCreatePrinterResult
    | null;
  if (!row) {
    return {
      success: false,
      actionRequestId,
      printerId: null,
      printerName: null,
      powerWatts: null,
      maintenanceCostPerHour: null,
      errorCode: "empty_rpc_result",
      message: "La creación no devolvió un resultado válido.",
    };
  }

  return {
    success: row.success === true,
    actionRequestId: row.action_request_id,
    printerId: row.printer_id,
    printerName: row.printer_name,
    powerWatts: toNullableNumber(row.power_watts),
    maintenanceCostPerHour: toNullableNumber(
      row.maintenance_cost_per_hour
    ),
    errorCode: row.error_code,
    message: row.message,
  };
}
