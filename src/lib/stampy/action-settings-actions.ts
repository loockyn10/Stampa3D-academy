"use server";

import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { createClient } from "@/utils/supabase/server";
import {
  DEFAULT_STAMPY_ACTION_SETTINGS,
  getStampyActionSettings,
  type StampyActionSettings,
  upsertStampyActionSettings,
} from "./action-settings";

type SettingsActionResult = {
  success: boolean;
  settings: StampyActionSettings;
  error: string | null;
};

async function getAuthorizedSettingsContext() {
  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);

  if (!access.authenticated || !access.userId) {
    return { supabase, userId: null, error: "Necesitás iniciar sesión." };
  }

  if (!access.capabilities.useStampy) {
    return {
      supabase,
      userId: null,
      error: "No tenés acceso habilitado para usar Stampy.",
    };
  }

  return { supabase, userId: access.userId, error: null };
}

export async function loadStampyActionSettingsAction(): Promise<SettingsActionResult> {
  try {
    const context = await getAuthorizedSettingsContext();
    if (!context.userId) {
      return {
        success: false,
        settings: { ...DEFAULT_STAMPY_ACTION_SETTINGS },
        error: context.error,
      };
    }

    const result = await getStampyActionSettings({
      supabase: context.supabase,
      userId: context.userId,
    });

    return {
      success: result.error === null,
      settings: result.settings,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      settings: { ...DEFAULT_STAMPY_ACTION_SETTINGS },
      error: error instanceof Error ? error.message : "No se pudo cargar la configuración.",
    };
  }
}

export async function saveStampyActionSettingsAction(
  settings: StampyActionSettings
): Promise<SettingsActionResult> {
  try {
    const context = await getAuthorizedSettingsContext();
    if (!context.userId) {
      return {
        success: false,
        settings: { ...DEFAULT_STAMPY_ACTION_SETTINGS },
        error: context.error,
      };
    }

    const safeSettings: StampyActionSettings = {
      autoExecuteLowRisk: settings.autoExecuteLowRisk === true,
      autoExecuteFilamentMovements:
        settings.autoExecuteFilamentMovements === true,
      autoExecuteCreateFilament: settings.autoExecuteCreateFilament === true,
      autoExecuteCreatePrinter: settings.autoExecuteCreatePrinter === true,
    };
    const result = await upsertStampyActionSettings({
      supabase: context.supabase,
      userId: context.userId,
      settings: safeSettings,
    });

    return {
      success: result.error === null,
      settings: result.settings,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      settings: { ...DEFAULT_STAMPY_ACTION_SETTINGS },
      error: error instanceof Error ? error.message : "No se pudo guardar la configuración.",
    };
  }
}
