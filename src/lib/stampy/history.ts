import { SupabaseClient } from "@supabase/supabase-js";
import { StampyConversation, StampyMessage } from "./types";

// Ventana de la conversación activa que recibe el modelo (6 turnos).
export const STAMPY_HISTORY_MAX_MESSAGES = 12;
export const STAMPY_HISTORY_MESSAGE_MAX_CHARS = 2400;
export const STAMPY_HISTORY_TOTAL_MAX_CHARS = 14000;

interface EnsureConversationParams {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string | null;
  message: string;
}

export async function ensureConversation({
  supabase,
  userId,
  conversationId,
  message,
}: EnsureConversationParams): Promise<string | null> {
  try {
    if (conversationId) {
      // Validate existing conversation
      const { data: conv, error: convError } = await supabase
        .from("stampy_conversations")
        .select("id, user_id")
        .eq("id", conversationId)
        .single();

      if (!convError && conv && conv.user_id === userId) {
        // Update last_message_at
        await supabase
          .from("stampy_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conversationId);
          
        return conversationId;
      }
    }

    // Create new conversation
    const title = message.slice(0, 60);
    const { data: newConv, error: createError } = await supabase
      .from("stampy_conversations")
      .insert({
        user_id: userId,
        title,
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (createError || !newConv) {
      console.error("[Stampy] Failed to create conversation", createError);
      return null;
    }

    return newConv.id;
  } catch (error) {
    console.error("[Stampy] ensureConversation exception", error);
    return null;
  }
}

export async function getRecentHistory(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  try {
    // saveMessages inserta usuario y asistente del mismo turno en un solo
    // INSERT, así que comparten created_at: el rol desempata el orden.
    const { data: recentMessages, error } = await supabase
      .from("stampy_messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("role", { ascending: true })
      .limit(STAMPY_HISTORY_MAX_MESSAGES);

    if (error) {
      console.error("[Stampy] recent history failed", error);
      return [];
    }

    // Newest first: keep whole messages while the total budget allows it.
    const newestFirst: { role: "user" | "assistant"; content: string }[] = [];
    let totalChars = 0;
    for (const m of (recentMessages ?? []) as Array<{ role: string; content: string | null }>) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      const content = (m.content ?? "").substring(0, STAMPY_HISTORY_MESSAGE_MAX_CHARS);
      if (!content.trim()) continue;
      if (totalChars + content.length > STAMPY_HISTORY_TOTAL_MAX_CHARS) break;
      newestFirst.push({ role: m.role, content });
      totalChars += content.length;
    }

    const history = newestFirst.reverse();

    if (process.env.NODE_ENV !== "production") {
      console.log("[Stampy History]", {
        conversationId,
        previousMessagesCount: history.length,
        firstMessagePreview: history[0]?.content.substring(0, 80) ?? null,
        lastMessagePreview: history.at(-1)?.content.substring(0, 80) ?? null,
      });
    }

    return history;
  } catch (error) {
    console.error("[Stampy] recent history exception", error);
    return [];
  }
}

export async function saveMessages(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
  metadata: any
): Promise<{ userMessageId: string | null; assistantMessageId: string | null }> {
  try {
    const rows = [
      {
        conversation_id: conversationId,
        user_id: userId,
        role: "user",
        content: userMessage,
        metadata: {
          mode: metadata?.mode,
        },
      },
      {
        conversation_id: conversationId,
        user_id: userId,
        role: "assistant",
        content: assistantMessage,
        metadata: metadata ?? {},
      },
    ];

    const { data, error } = await supabase
      .from("stampy_messages")
      .insert(rows)
      .select("id, role");

    if (error) {
      console.error("[Stampy] saveMessages failed", error);
      return { userMessageId: null, assistantMessageId: null };
    }

    let userMessageId = null;
    let assistantMessageId = null;

    if (data) {
      for (const row of data) {
        if (row.role === "user") userMessageId = row.id;
        if (row.role === "assistant") assistantMessageId = row.id;
      }
    }

    return { userMessageId, assistantMessageId };
  } catch (error) {
    console.error("[Stampy] saveMessages exception", error);
    return { userMessageId: null, assistantMessageId: null };
  }
}
