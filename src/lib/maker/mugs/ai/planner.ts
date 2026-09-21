import { buildMugDesignerSystemPrompt, buildMugDesignerUserMessage, normalizeMugAiPrompt } from "@/lib/maker/mugs/ai/prompt";
import { sanitizeMugDesignProposal } from "@/lib/maker/mugs/ai/sanitizeProposal";
import { MUG_AI_SCHEMA_VERSION, type MugAiErrorCode, type MugDesignRequest, type MugDesignResult } from "@/lib/maker/mugs/ai/types";

export interface PlannerMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Llamada al proveedor: devuelve el JSON (texto) de la respuesta. La inyecta el server action (o un mock en tests). */
export type CompleteFn = (messages: PlannerMessage[]) => Promise<string>;

/** Máximo de reintentos automáticos cuando la salida es inválida (1, sin loops). */
export const MAX_INVALID_RETRIES = 1;

const MESSAGES: Record<MugAiErrorCode, string> = {
  auth: "Iniciá sesión para diseñar con IA.",
  membership: "Diseñar con IA requiere una membresía activa.",
  rate_limit: "Llegaste al límite de diseños con IA por ahora. Probá de nuevo más tarde.",
  prompt: "Revisá la descripción del jarro.",
  unavailable: "El servicio de IA no está disponible en este momento. Tu diseño actual no cambió.",
  timeout: "La IA tardó demasiado en responder. Tu diseño actual no cambió; probá de nuevo.",
  invalid: "La IA devolvió una propuesta que no se pudo usar. Tu diseño actual no cambió; probá con otra descripción.",
  unknown: "No se pudo generar el diseño. Tu diseño actual no cambió.",
};

export const mugAiError = (code: MugAiErrorCode, message?: string): MugDesignResult => ({ ok: false, code, message: message ?? MESSAGES[code] });

/** Traduce errores del proveedor (SDK de OpenAI u otros) a un código propio, sin filtrar detalles internos. */
export function mapProviderError(err: unknown): MugAiErrorCode {
  const e = (err ?? {}) as { status?: number; name?: string; code?: string; message?: string };
  if (e.name === "APIConnectionTimeoutError" || e.name === "AbortError" || e.code === "ETIMEDOUT") return "timeout";
  if (e.status === 429) return "unavailable";
  if (typeof e.status === "number" && e.status >= 500) return "unavailable";
  if (e.status === 401 || e.status === 403) return "unavailable"; // credenciales del servidor: no es problema del usuario
  if (/api[_ ]?key|not set/i.test(e.message ?? "")) return "unavailable";
  return "unknown";
}

/**
 * Orquesta pedido -> modelo -> sanitización. No conoce OpenAI ni Supabase (testeable sin red). Si la salida no parsea
 * o no pasa el sanitizador, reintenta UNA vez informando el problema; no hay más loops.
 */
export async function planMugDesign(request: MugDesignRequest, complete: CompleteFn): Promise<MugDesignResult> {
  const checked = normalizeMugAiPrompt(request.prompt);
  if (!checked.ok) return mugAiError("prompt", checked.message);

  const messages: PlannerMessage[] = [
    { role: "system", content: buildMugDesignerSystemPrompt() },
    { role: "user", content: buildMugDesignerUserMessage({ ...request, prompt: checked.prompt }) },
  ];
  const ctx = { mode: request.mode, assets: request.assets, currentDecorationIds: request.current.decorations.map((d) => d.id) };

  for (let attempt = 0; attempt <= MAX_INVALID_RETRIES; attempt++) {
    let content: string;
    try {
      content = await complete(messages);
    } catch (err) {
      return mugAiError(mapProviderError(err));
    }
    let problem: string;
    try {
      const sanitized = sanitizeMugDesignProposal(JSON.parse(content), ctx);
      if (sanitized.ok) return { ok: true, proposal: sanitized.proposal, aiDesignSchemaVersion: MUG_AI_SCHEMA_VERSION };
      problem = sanitized.error;
    } catch {
      problem = "La respuesta no era JSON válido.";
    }
    messages.push({ role: "assistant", content: content.slice(0, 4000) }, { role: "user", content: `Tu respuesta no es válida: ${problem} Respondé de nuevo SOLO con el JSON del schema, modo "${request.mode}".` });
  }
  return mugAiError("invalid");
}
