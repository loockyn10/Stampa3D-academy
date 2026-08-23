import { SupabaseClient } from "@supabase/supabase-js";
import { StampyUsageLog } from "./types";

export interface LogStampyUsageParams {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string | null;
  model: string | null;
  mode: StampyUsageLog["mode"];
  status: StampyUsageLog["status"];
  messageChars: number;
  promptChars?: number | null;
  completionChars?: number | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
}

export async function logStampyUsage({
  supabase,
  userId,
  conversationId,
  model,
  mode,
  status,
  messageChars,
  promptChars = null,
  completionChars = null,
  latencyMs = null,
  errorMessage = null,
}: LogStampyUsageParams) {
  try {
    const { error } = await supabase.from("stampy_usage_logs").insert({
      user_id: userId,
      conversation_id: conversationId,
      model,
      mode,
      status,
      message_chars: messageChars,
      prompt_chars: promptChars,
      completion_chars: completionChars,
      latency_ms: latencyMs,
      error_message: errorMessage,
    });

    if (error) {
      console.error("[Stampy] Failed to insert usage log", error);
    }
  } catch (error) {
    console.error("[Stampy] usage log exception", error);
  }
}
