"use server";

import { createClient } from "@/utils/supabase/server";
import { getCurrentUserAccess, type UserAccessSnapshot } from "@/lib/auth/user-access";
import {
  FEATURE_UNAVAILABLE_ERROR_CODE,
  FEATURE_UNAVAILABLE_MESSAGE,
  isFeatureAvailable,
  isPathAvailable,
} from "@/lib/features/server";
import { StampyActionIntent, StampyActionRequest } from "./types";
import {
  executeCreateFilament,
  executeCreatePrinter,
  executeCreateProduct,
  executeFilamentStockMovement,
  executeProductFilamentDiscount,
} from "./action-executor";

/**
 * Las acciones confirmables de Stampy crean/modifican datos de Mi Taller: requieren que Stampy y Mi Taller estén
 * disponibles para el usuario (los administradores conservan el acceso). Se suma a la validación de membresía.
 */
async function ensureStampyActionFeatures(
  supabase: Awaited<ReturnType<typeof createClient>>,
  access: UserAccessSnapshot,
) {
  for (const featureId of ["stampy", "mi_taller"] as const) {
    if (!(await isFeatureAvailable(supabase, featureId, access))) {
      return {
        success: false as const,
        errorCode: FEATURE_UNAVAILABLE_ERROR_CODE,
        message: FEATURE_UNAVAILABLE_MESSAGE,
      };
    }
  }
  return null;
}

interface CreateStampyActionRequestParams {
  userId: string;
  conversationId: string;
  messageId: string;
  actionIntent: StampyActionIntent;
  source: string;
}

export async function createStampyActionRequest({
  userId,
  conversationId,
  messageId,
  actionIntent,
  source
}: CreateStampyActionRequestParams): Promise<{ actionRequestId: string | null; error: string | null }> {
  try {
    const supabase = await createClient();

    // No se registra una solicitud de acción si Stampy o la herramienta destino están deshabilitadas (admins exceptuados).
    const { access } = await getCurrentUserAccess(supabase);
    if (
      !(await isFeatureAvailable(supabase, "stampy", access)) ||
      !(await isPathAvailable(supabase, actionIntent.toolHref, access))
    ) {
      return { actionRequestId: null, error: FEATURE_UNAVAILABLE_MESSAGE };
    }

    const { getStampyToolContractsForIntent } = await import("./tool-registry");
    const contracts = getStampyToolContractsForIntent(actionIntent.type);
    const contract = contracts.length > 0 ? contracts[0] : null;

    const extractedData = { ...(actionIntent.extracted ?? {}) };
    if (contract) {
      extractedData.toolContractId = contract.id;
    }

    const payload = {
      user_id: userId,
      conversation_id: conversationId,
      message_id: messageId,
      action_type: actionIntent.type,
      status: "suggested",
      confidence: actionIntent.confidence,
      extracted: extractedData,
      tool_href: actionIntent.toolHref || null,
      tool_label: actionIntent.toolLabel || null,
      source: source,
      can_execute: false
    };

    const { data, error } = await supabase
      .from("stampy_action_requests")
      .insert([payload])
      .select("id")
      .single();

    if (error) {
      console.error("[createStampyActionRequest] DB Error:", error);
      return { actionRequestId: null, error: error.message };
    }

    return { actionRequestId: data.id, error: null };
  } catch (error: any) {
    console.error("[createStampyActionRequest] Catch Error:", error);
    return { actionRequestId: null, error: error.message || "Unknown error" };
  }
}

interface MarkOpenedParams {
  actionRequestId: string;
}

export async function markStampyActionRequestOpened({
  actionRequestId
}: MarkOpenedParams): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No user" };

    const { data, error } = await supabase
      .from("stampy_action_requests")
      .update({ status: "opened_tool", updated_at: new Date().toISOString() })
      .eq("id", actionRequestId)
      .eq("user_id", user.id)
      .eq("status", "suggested")
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[markStampyActionRequestOpened] Error:", error);
      return { success: false, error: error.message };
    }

    if (!data) {
      return {
        success: false,
        error: "No se encontró una solicitud pendiente para abrir."
      };
    }

    return { success: true };
  } catch (error: any) {
    console.error("[markStampyActionRequestOpened] Catch Error:", error);
    return { success: false, error: error.message };
  }
}

interface CancelParams {
  actionRequestId: string;
}

interface ConfirmParams {
  actionRequestId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function confirmStampyActionRequest({
  actionRequestId,
}: ConfirmParams) {
  if (!UUID_PATTERN.test(actionRequestId)) {
    return {
      success: false,
      errorCode: "invalid_action_request_id",
      message: "La solicitud de confirmación no es válida.",
    };
  }

  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  if (!access.authenticated || !access.userId) {
    return {
      success: false,
      errorCode: "unauthenticated",
      message: "Necesitás iniciar sesión para confirmar el movimiento.",
    };
  }

  if (!access.capabilities.useStampy) {
    return {
      success: false,
      errorCode: "stampy_access_required",
      message: "No tenés acceso habilitado para usar Stampy.",
    };
  }

  const featureUnavailable = await ensureStampyActionFeatures(supabase, access);
  if (featureUnavailable) return featureUnavailable;

  return executeFilamentStockMovement({ supabase, actionRequestId });
}

export async function confirmStampyCreateFilamentAction(actionRequestId: string) {
  if (!UUID_PATTERN.test(actionRequestId)) {
    return {
      success: false,
      errorCode: "invalid_action_request_id",
      message: "La solicitud de creación no es válida.",
    };
  }

  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  if (!access.authenticated || !access.userId) {
    return {
      success: false,
      errorCode: "unauthenticated",
      message: "Necesitás iniciar sesión para crear el filamento.",
    };
  }

  if (!access.capabilities.useStampy) {
    return {
      success: false,
      errorCode: "stampy_access_required",
      message: "No tenés acceso habilitado para usar Stampy.",
    };
  }

  const featureUnavailable = await ensureStampyActionFeatures(supabase, access);
  if (featureUnavailable) return featureUnavailable;

  return executeCreateFilament({ supabase, actionRequestId });
}

export async function confirmStampyCreatePrinterAction(actionRequestId: string) {
  if (!UUID_PATTERN.test(actionRequestId)) {
    return {
      success: false,
      errorCode: "invalid_action_request_id",
      message: "La solicitud de creación no es válida.",
    };
  }

  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  if (!access.authenticated || !access.userId) {
    return {
      success: false,
      errorCode: "unauthenticated",
      message: "Necesitás iniciar sesión para crear la impresora.",
    };
  }

  if (!access.capabilities.useStampy) {
    return {
      success: false,
      errorCode: "stampy_access_required",
      message: "No tenés acceso habilitado para usar Stampy.",
    };
  }

  const featureUnavailable = await ensureStampyActionFeatures(supabase, access);
  if (featureUnavailable) return featureUnavailable;

  return executeCreatePrinter({ supabase, actionRequestId });
}

export async function confirmStampyCreateProductAction(actionRequestId: string) {
  if (!UUID_PATTERN.test(actionRequestId)) {
    return {
      success: false,
      errorCode: "invalid_action_request_id",
      message: "La solicitud de creación no es válida.",
    };
  }

  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  if (!access.authenticated || !access.userId) {
    return {
      success: false,
      errorCode: "unauthenticated",
      message: "Necesitás iniciar sesión para crear el producto.",
    };
  }

  if (!access.capabilities.useStampy) {
    return {
      success: false,
      errorCode: "stampy_access_required",
      message: "No tenés acceso habilitado para usar Stampy.",
    };
  }

  const featureUnavailable = await ensureStampyActionFeatures(supabase, access);
  if (featureUnavailable) return featureUnavailable;

  return executeCreateProduct({ supabase, actionRequestId });
}

export async function confirmStampyDiscountProductFilamentsAction(
  actionRequestId: string,
  currentScreenContext?: unknown,
) {
  if (!UUID_PATTERN.test(actionRequestId)) {
    return {
      success: false,
      errorCode: "invalid_action_request_id",
      message: "La solicitud de descuento no es válida.",
    };
  }

  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  if (!access.authenticated || !access.userId) {
    return {
      success: false,
      errorCode: "unauthenticated",
      message: "Necesitás iniciar sesión para descontar los filamentos.",
    };
  }

  if (!access.capabilities.useStampy) {
    return {
      success: false,
      errorCode: "stampy_access_required",
      message: "No tenés acceso habilitado para usar Stampy.",
    };
  }

  const featureUnavailable = await ensureStampyActionFeatures(supabase, access);
  if (featureUnavailable) return featureUnavailable;

  const { data: actionRequest, error: actionRequestError } = await supabase
    .from("stampy_action_requests")
    .select("id, status, extracted")
    .eq("id", actionRequestId)
    .eq("user_id", access.userId)
    .maybeSingle();
  if (actionRequestError || !actionRequest) {
    return {
      success: false,
      errorCode: "action_request_not_found",
      message: "No encontré una acción pendiente para confirmar.",
    };
  }

  const extracted = actionRequest.extracted && typeof actionRequest.extracted === "object"
    ? actionRequest.extracted as Record<string, unknown>
    : {};
  const contextBinding = extracted.contextBinding && typeof extracted.contextBinding === "object"
    ? extracted.contextBinding as Record<string, unknown>
    : null;
  const confirmationExpiresAt = Date.parse(String(extracted.confirmationExpiresAt ?? ""));
  if (!Number.isFinite(confirmationExpiresAt) || confirmationExpiresAt <= Date.now()) {
    await supabase
      .from("stampy_action_requests")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", actionRequestId)
      .eq("user_id", access.userId)
      .in("status", ["suggested", "opened_tool"]);
    return {
      success: false,
      errorCode: "confirmation_expired",
      message: "La confirmación venció. Prepará nuevamente el descuento para usar el stock actual.",
    };
  }
  if (contextBinding) {
    const { sanitizeStampyScreenContext } = await import("./screen-context");
    const screenContext = sanitizeStampyScreenContext(currentScreenContext);
    const expectedRoute = String(contextBinding.route ?? "");
    const expectedEntityId = String(contextBinding.selectedEntityId ?? "");
    const stillCurrent =
      screenContext?.page.route === expectedRoute
      && screenContext.selectedEntity?.type === "product"
      && screenContext.selectedEntity.id === expectedEntityId;

    if (!stillCurrent) {
      await supabase
        .from("stampy_action_requests")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", actionRequestId)
        .eq("user_id", access.userId)
        .in("status", ["suggested", "opened_tool"]);
      return {
        success: false,
        errorCode: "stale_context",
        message: "La selección cambió o la confirmación venció. Prepará nuevamente el descuento para usar los datos actuales.",
      };
    }
  }

  return executeProductFilamentDiscount({ supabase, actionRequestId });
}

export async function cancelStampyActionRequest({
  actionRequestId
}: CancelParams): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No user" };

    const { data, error } = await supabase
      .from("stampy_action_requests")
      .update({ 
        status: "cancelled", 
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString() 
      })
      .eq("id", actionRequestId)
      .eq("user_id", user.id)
      .in("status", ["suggested", "opened_tool"])
      .select("id")
      .maybeSingle(); // Allow cancel if opened but not executed

    if (error) {
      console.error("[cancelStampyActionRequest] Error:", error);
      return { success: false, error: error.message };
    }

    if (!data) {
      return {
        success: false,
        error: "No se encontró una solicitud pendiente para cancelar."
      };
    }

    return { success: true };
  } catch (error: any) {
    console.error("[cancelStampyActionRequest] Catch Error:", error);
    return { success: false, error: error.message };
  }
}
