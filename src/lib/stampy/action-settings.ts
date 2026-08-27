import type { SupabaseClient } from "@supabase/supabase-js";
import type { StampyActionIntentType } from "./types";

export interface StampyActionSettings {
  autoExecuteLowRisk: boolean;
  autoExecuteFilamentMovements: boolean;
  autoExecuteCreateFilament: boolean;
  autoExecuteCreatePrinter: boolean;
}

export const DEFAULT_STAMPY_ACTION_SETTINGS: StampyActionSettings = {
  autoExecuteLowRisk: false,
  autoExecuteFilamentMovements: false,
  autoExecuteCreateFilament: false,
  autoExecuteCreatePrinter: false,
};

interface StampyActionSettingsRow {
  auto_execute_low_risk: boolean;
  auto_execute_filament_movements: boolean;
  auto_execute_create_filament: boolean;
  auto_execute_create_printer: boolean;
}

interface GetStampyActionSettingsParams {
  supabase: SupabaseClient;
  userId: string;
}

interface UpsertStampyActionSettingsParams
  extends GetStampyActionSettingsParams {
  settings: StampyActionSettings;
}

export interface StampyActionSettingsResult {
  settings: StampyActionSettings;
  error: string | null;
}

function fromRow(row: StampyActionSettingsRow): StampyActionSettings {
  return {
    autoExecuteLowRisk: row.auto_execute_low_risk === true,
    autoExecuteFilamentMovements:
      row.auto_execute_filament_movements === true,
    autoExecuteCreateFilament: row.auto_execute_create_filament === true,
    autoExecuteCreatePrinter: row.auto_execute_create_printer === true,
  };
}

export async function getStampyActionSettings({
  supabase,
  userId,
}: GetStampyActionSettingsParams): Promise<StampyActionSettingsResult> {
  const { data, error } = await supabase
    .from("stampy_user_action_settings")
    .select(
      "auto_execute_low_risk, auto_execute_filament_movements, auto_execute_create_filament, auto_execute_create_printer"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return {
      settings: { ...DEFAULT_STAMPY_ACTION_SETTINGS },
      error: error.message,
    };
  }

  return {
    settings: data
      ? fromRow(data as StampyActionSettingsRow)
      : { ...DEFAULT_STAMPY_ACTION_SETTINGS },
    error: null,
  };
}

export async function upsertStampyActionSettings({
  supabase,
  userId,
  settings,
}: UpsertStampyActionSettingsParams): Promise<StampyActionSettingsResult> {
  const { data, error } = await supabase
    .from("stampy_user_action_settings")
    .upsert(
      {
        user_id: userId,
        auto_execute_low_risk: settings.autoExecuteLowRisk === true,
        auto_execute_filament_movements:
          settings.autoExecuteFilamentMovements === true,
        auto_execute_create_filament:
          settings.autoExecuteCreateFilament === true,
        auto_execute_create_printer: settings.autoExecuteCreatePrinter === true,
      },
      { onConflict: "user_id" }
    )
    .select(
      "auto_execute_low_risk, auto_execute_filament_movements, auto_execute_create_filament, auto_execute_create_printer"
    )
    .single();

  if (error || !data) {
    return {
      settings: { ...DEFAULT_STAMPY_ACTION_SETTINGS },
      error: error?.message ?? "No se pudo guardar la configuración de Stampy.",
    };
  }

  return { settings: fromRow(data as StampyActionSettingsRow), error: null };
}

export function canAutoExecuteStampyAction({
  settings,
  actionType,
}: {
  settings: StampyActionSettings;
  actionType: StampyActionIntentType;
}): boolean {
  if (!settings.autoExecuteLowRisk) return false;

  if (
    actionType === "increase_filament_stock" ||
    actionType === "discount_filament"
  ) {
    return settings.autoExecuteFilamentMovements;
  }

  if (actionType === "add_filament") {
    return settings.autoExecuteCreateFilament;
  }

  if (actionType === "add_printer") {
    return settings.autoExecuteCreatePrinter;
  }

  return false;
}
