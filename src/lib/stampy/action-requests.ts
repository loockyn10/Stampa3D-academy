"use server";

import { createClient } from "@/utils/supabase/server";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { StampyActionIntent, StampyActionRequest } from "./types";
import {
  executeCreateFilament,
  executeCreatePrinter,
  executeFilamentStockMovement,
} from "./action-executor";

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

  return executeCreatePrinter({ supabase, actionRequestId });
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
