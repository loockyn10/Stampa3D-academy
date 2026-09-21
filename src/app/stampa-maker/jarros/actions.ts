"use server";

import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { cleanString } from "@/lib/maker/mugs/ai/sanitizeProposal";
import { buildMugDesignJsonSchema } from "@/lib/maker/mugs/ai/schema";
import { mugAiError, planMugDesign, type CompleteFn } from "@/lib/maker/mugs/ai/planner";
import { checkMugAiRateLimit, MUG_AI_MODEL_TAG } from "@/lib/maker/mugs/ai/rateLimit";
import type { MugAiAssetInfo, MugAiMode, MugDesignResult } from "@/lib/maker/mugs/ai/types";
import { normalizeMugDefinition } from "@/lib/maker/mugs/defaults";
import { createClient } from "@/utils/supabase/server";

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ASSETS = 20;

interface DesignMugInput {
  mode: MugAiMode;
  prompt: string;
  /** MugDefinition actual (no confiable: se re-normaliza acá). */
  current: unknown;
  /** Solo metadatos de los archivos cargados (id, tipo, nombre); nunca su contenido. */
  assets: { id: string; kind: string; fileName: string }[];
}

function readAssets(raw: unknown): MugAiAssetInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: MugAiAssetInfo[] = [];
  for (const a of raw.slice(0, MAX_ASSETS)) {
    const r = (a ?? {}) as Record<string, unknown>;
    const id = cleanString(r.id, 80);
    if (!id || (r.kind !== "svg" && r.kind !== "png" && r.kind !== "jpg")) continue;
    out.push({ id, kind: r.kind, fileName: cleanString(r.fileName, 80) || "archivo" });
  }
  return out;
}

/**
 * "Diseñar con IA": el modelo solo CONFIGURA parámetros del motor paramétrico (structured output + sanitización). Se
 * llama únicamente desde acciones explícitas del usuario (Generar / Regenerar / Modificar). No escribe nada en la
 * base salvo el log de uso usado como rate limit.
 */
export async function designMugWithAiAction(input: DesignMugInput): Promise<MugDesignResult> {
  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  const userId = access.userId;
  if (!access.authenticated || !userId) return mugAiError("auth");
  if (!access.capabilities.useStampy) return mugAiError("membership");
  if (input?.mode !== "full" && input?.mode !== "patch") return mugAiError("prompt", "Modo de diseño no válido.");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return mugAiError("unavailable");

  const { logStampyUsage } = await import("@/lib/stampy/usage-log");
  const promptChars = typeof input.prompt === "string" ? input.prompt.length : 0;
  const model = process.env.MUG_AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const tag = `${MUG_AI_MODEL_TAG}:${model}`;

  if ((await checkMugAiRateLimit(supabase, userId)).blocked) {
    await logStampyUsage({ supabase, userId, conversationId: null, model: MUG_AI_MODEL_TAG, mode: "blocked", status: "blocked", messageChars: promptChars });
    return mugAiError("rate_limit");
  }

  const startedAt = Date.now();
  let completionChars = 0;
  const complete: CompleteFn = async (messages) => {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0.6,
      response_format: { type: "json_schema", json_schema: { name: "mug_design_proposal", strict: true, schema: buildMugDesignJsonSchema() } },
    });
    const content = completion.choices[0]?.message?.content ?? "";
    completionChars += content.length;
    return content;
  };

  const result = await planMugDesign(
    { mode: input.mode, prompt: input.prompt, current: normalizeMugDefinition(input.current), assets: readAssets(input.assets) },
    complete,
  );

  // Los pedidos rechazados por validación de prompt no llegaron al proveedor: no cuentan para el límite.
  if (result.ok || result.code !== "prompt") {
    await logStampyUsage({
      supabase,
      userId,
      conversationId: null,
      model: tag,
      mode: result.ok ? "openai" : "error",
      status: result.ok ? "success" : "error",
      messageChars: promptChars,
      completionChars,
      latencyMs: Date.now() - startedAt,
      errorMessage: result.ok ? null : result.code,
    });
  }
  return result;
}
