import { SupabaseClient } from "@supabase/supabase-js";
import { StampyConversation, StampyMessage } from "./types";

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
    const { data: recentMessages, error } = await supabase
      .from("stampy_messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8);

    if (error) {
      console.error("[Stampy] recent history failed", error);
      return [];
    }

    if (!recentMessages || recentMessages.length === 0) {
      return [];
    }

    // Reverse to chronological order and truncate
    return recentMessages.reverse().map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content.substring(0, 1200),
    }));
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
) {
  try {
    const { error } = await supabase.from("stampy_messages").insert([
      {
        conversation_id: conversationId,
        user_id: userId,
        role: "user",
        content: userMessage,
      },
      {
        conversation_id: conversationId,
        user_id: userId,
        role: "assistant",
        content: assistantMessage,
        metadata,
      },
    ]);

    if (error) {
      console.error("[Stampy] Failed to save messages", error);
    }
  } catch (error) {
    console.error("[Stampy] saveMessages exception", error);
  }
}
