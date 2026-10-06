import type {
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
} from "openai/resources/responses/responses";

export const STAMPY_DEFAULT_MODEL = "gpt-5.6-terra";
export const STAMPY_DEFAULT_REASONING_EFFORT = "low";
export const STAMPY_DEFAULT_MAX_OUTPUT_TOKENS = 4000;

// "xhigh" y "max" quedan fuera a propósito: son demasiado lentos/caros para chat.
const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;
const TEXT_VERBOSITIES = ["low", "medium", "high"] as const;

export type StampyReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type StampyTextVerbosity = (typeof TEXT_VERBOSITIES)[number];

export interface StampyModelConfig {
  model: string;
  reasoningEffort: StampyReasoningEffort | null;
  verbosity: StampyTextVerbosity | null;
  maxOutputTokens: number;
}

export interface StampyHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

type StampyEnv = Record<string, string | undefined>;

function pickOption<T extends string>(
  value: string | undefined,
  options: readonly T[],
): T | null {
  const normalized = value?.trim().toLowerCase();
  return options.find((option) => option === normalized) ?? null;
}

/**
 * Modelo y razonamiento de Stampy.
 * - OPENAI_MODEL: modelo (por defecto gpt-5.6-terra).
 * - STAMPY_REASONING_EFFORT: none|minimal|low|medium|high, u "off" para no
 *   enviar el parámetro (modelos sin razonamiento). Por defecto "low".
 * - STAMPY_TEXT_VERBOSITY: low|medium|high. Sin valor no se envía.
 * - STAMPY_MAX_OUTPUT_TOKENS: tope de salida (incluye tokens de razonamiento).
 */
export function getStampyModelConfig(env: StampyEnv = process.env): StampyModelConfig {
  const rawEffort = env.STAMPY_REASONING_EFFORT?.trim().toLowerCase();
  const reasoningEffort = rawEffort === "off"
    ? null
    : pickOption(rawEffort, REASONING_EFFORTS) ?? STAMPY_DEFAULT_REASONING_EFFORT;
  const maxOutputTokens = Number.parseInt(env.STAMPY_MAX_OUTPUT_TOKENS ?? "", 10);

  return {
    model: env.OPENAI_MODEL?.trim() || STAMPY_DEFAULT_MODEL,
    reasoningEffort,
    verbosity: pickOption(env.STAMPY_TEXT_VERBOSITY, TEXT_VERBOSITIES),
    maxOutputTokens:
      Number.isFinite(maxOutputTokens) && maxOutputTokens >= 500
        ? maxOutputTokens
        : STAMPY_DEFAULT_MAX_OUTPUT_TOKENS,
  };
}

/**
 * Conversación multi-turn nativa: cada mensaje conserva su rol. El historial
 * lo administra la aplicación (stampy_messages), así los turnos resueltos sin
 * modelo (acciones, herramientas directas) también forman parte del contexto.
 */
export function buildStampyResponseInput(
  history: StampyHistoryMessage[],
  userMessage: string,
): ResponseInputItem[] {
  return [
    ...history
      .filter((message) => message.content.trim().length > 0)
      .map((message) => ({ role: message.role, content: message.content })),
    { role: "user" as const, content: userMessage },
  ];
}

export function buildStampyResponseRequest({
  config,
  instructions,
  history,
  userMessage,
}: {
  config: StampyModelConfig;
  instructions: string;
  history: StampyHistoryMessage[];
  userMessage: string;
}): ResponseCreateParamsNonStreaming {
  return {
    model: config.model,
    instructions,
    input: buildStampyResponseInput(history, userMessage),
    // El historial vive en Supabase; no se retiene estado en OpenAI.
    store: false,
    max_output_tokens: config.maxOutputTokens,
    ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
    ...(config.verbosity ? { text: { verbosity: config.verbosity } } : {}),
  };
}

type StampyResponseLike = {
  output_text?: string | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

export function extractStampyResponseText(response: StampyResponseLike): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  return (response.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
}

export const STAMPY_MODEL_UNAVAILABLE_MESSAGE =
  "Stampy no está disponible en este momento y no pudo generar una respuesta. No se hizo ningún cambio; probá de nuevo en unos segundos.";

/** Datos seguros para loguear un fallo del proveedor: sin headers, keys ni payloads. */
export function describeStampyModelError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return { message: String(error).substring(0, 300) };
  }
  const candidate = error as {
    name?: unknown;
    status?: unknown;
    code?: unknown;
    type?: unknown;
    requestID?: unknown;
    message?: unknown;
  };
  return {
    name: typeof candidate.name === "string" ? candidate.name : "Error",
    status: typeof candidate.status === "number" ? candidate.status : null,
    code: typeof candidate.code === "string" ? candidate.code : null,
    type: typeof candidate.type === "string" ? candidate.type : null,
    requestId: typeof candidate.requestID === "string" ? candidate.requestID : null,
    message:
      typeof candidate.message === "string"
        ? candidate.message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***").substring(0, 300)
        : null,
  };
}

function normalizeForMatching(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FOLLOW_UP_START =
  /^(y|e|o|pero|entonces|osea|o sea|ok|bueno|dale|tambien|ademas|por que|porque|como asi|en serio|y si|y con|y para|y en|y el|y la|y los|y las|y eso|eso|esa|ese|esto|la otra|el otro|lo otro|la primera|la segunda|el primero|el segundo|cual|cuales|explicame|explica|ampliame|amplia|mas detalle|detallame|no entendi|no entiendo|ejemplo|dame un ejemplo|seguro|y ahora)\b/;

/**
 * Un mensaje corto o anafórico ("¿y con PETG?", "¿por qué?", "la otra")
 * depende del turno anterior para tener sentido.
 */
export function isStampyFollowUpMessage(message: string): boolean {
  const normalized = normalizeForMatching(message);
  if (!normalized) return false;
  const words = normalized.split(" ").length;
  return words <= 4 || (words <= 12 && FOLLOW_UP_START.test(normalized));
}

/**
 * Texto para clasificar y buscar contexto (intención, herramientas, clases,
 * retrieval). Los seguimientos se combinan con el último mensaje del usuario
 * para no perder el tema; el modelo igual recibe el historial completo.
 */
export function buildStampyContextQuery({
  userMessage,
  history,
}: {
  userMessage: string;
  history: StampyHistoryMessage[];
}): string {
  if (!isStampyFollowUpMessage(userMessage)) return userMessage;

  const previousUserMessage = [...history]
    .reverse()
    .find((message) => message.role === "user" && message.content.trim());
  if (!previousUserMessage) return userMessage;

  return `${previousUserMessage.content.trim().substring(0, 400)}\n${userMessage}`;
}
