"use server";

import { createClient } from "@/utils/supabase/server";
import { StampyFeedbackReason, StampyMessageFeedback } from "@/lib/stampy/types";

export interface SubmitFeedbackPayload {
  messageId: string;
  conversationId: string;
  rating: "positive" | "negative";
  reason?: StampyFeedbackReason | null;
  comment?: string | null;
  source?: string;
}

export async function submitStampyFeedbackAction({
  messageId,
  conversationId,
  rating,
  reason,
  comment,
  source = "stampy",
}: SubmitFeedbackPayload): Promise<{ data?: StampyMessageFeedback; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;

    if (!user) {
      return { error: "No autorizado" };
    }

    if (!messageId || !conversationId) {
      return { error: "Faltan datos requeridos para el feedback" };
    }

    if (comment && comment.length > 1000) {
      comment = comment.substring(0, 1000);
    }

    const { data, error } = await supabase
      .from("stampy_message_feedback")
      .upsert(
        {
          message_id: messageId,
          conversation_id: conversationId,
          user_id: user.id,
          rating,
          reason: reason || null,
          comment: comment || null,
          source,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "message_id,user_id",
        }
      )
      .select("*")
      .single();

    if (error) {
      console.error("[Stampy] submitStampyFeedback error", error);
      return { error: "Ocurrió un error al guardar el feedback" };
    }

    console.log("[Stampy] feedback submitted", {
      userId: user.id,
      messageId,
      conversationId,
      rating,
      reason,
      source,
    });

    return { data };
  } catch (error) {
    console.error("[Stampy] submitStampyFeedback exception", error);
    return { error: "Ocurrió un error interno al guardar el feedback" };
  }
}
