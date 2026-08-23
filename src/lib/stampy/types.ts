export interface StampyConversation {
  id: string;
  user_id: string;
  title: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface StampyMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  metadata: any | null;
  created_at: string;
}

export interface StampyUsageLog {
  id: string;
  user_id: string;
  conversation_id: string | null;
  model: string | null;
  mode: "direct" | "openai" | "blocked" | "error";
  status: "success" | "blocked" | "error";
  message_chars: number;
  prompt_chars: number | null;
  completion_chars: number | null;
  latency_ms: number | null;
  error_message: string | null;
  created_at: string;
}
