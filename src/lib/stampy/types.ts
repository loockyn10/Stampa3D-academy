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

export interface LessonTranscript {
  id: string;
  lesson_id: string;
  source_type: string;
  language: string;
  status: string;
  transcript_text: string | null;
  raw_payload: any | null;
  provider: string | null;
  external_id: string | null;
  source_url: string | null;
  duration_seconds: number | null;
  segments_count: number;
  imported_by: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LessonTranscriptSegment {
  id: string;
  transcript_id: string;
  lesson_id: string;
  position: number;
  start_seconds: number;
  end_seconds: number;
  text: string;
  confidence: number | null;
  created_at: string;
}

export type StampyFeedbackReason = 
  | "helpful"
  | "incorrect"
  | "too_generic"
  | "did_not_understand"
  | "did_not_use_context"
  | "bad_tool_recommendation"
  | "other";

export interface StampyMessageFeedback {
  id: string;
  message_id: string;
  conversation_id: string;
  user_id: string;
  rating: "positive" | "negative";
  reason: StampyFeedbackReason | null;
  comment: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export type StampyActionIntentType =
  | "discount_filament"
  | "add_filament"
  | "increase_filament_stock"
  | "add_printer"
  | "create_product"
  | "create_quote"
  | "calculate_price"
  | "update_stock"
  | "unknown_action";

export interface StampyActionIntent {
  type: StampyActionIntentType;
  confidence: number;
  title: string;
  summary: string;
  extracted: Record<string, unknown>;
  toolHref?: string;
  toolLabel?: string;
  canExecute: false;
  reason: string;
}

export type StampyActionRequestStatus = "suggested" | "opened_tool" | "cancelled" | "executed" | "error";

export interface StampyActionRequest {
  id: string;
  user_id: string;
  conversation_id: string;
  message_id: string;
  action_type: StampyActionIntentType;
  status: StampyActionRequestStatus;
  confidence: number;
  extracted: Record<string, any>;
  tool_href: string | null;
  tool_label: string | null;
  source: string;
  can_execute: boolean;
  executed_at: string | null;
  cancelled_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
