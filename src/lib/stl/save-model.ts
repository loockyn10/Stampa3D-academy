import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildStlModelPayload,
  buildStlVariantPayload,
  type StlModelFormValues,
} from "@/lib/stl/model-payload";

export interface SaveStlModelInput {
  /** Presente = edición; ausente = alta. */
  modelId?: string | null;
  values: StlModelFormValues;
  fileUrl: string;
  /** Variante existente a actualizar (si no, se crea una). */
  variantId?: string | null;
}

export type SaveStlModelResult =
  | { ok: true; modelId: string; variantId: string | null }
  | { ok: false; stage: "validation" | "model" | "variant"; message: string; modelId?: string };

/**
 * Único camino de alta/edición de `stl_models` (+ variante descargable) del Admin.
 * `stl_models.name` es NOT NULL: el título se normaliza (trim) y se valida acá, del lado
 * de la aplicación, antes de tocar Supabase. Nunca se envía name null/undefined/"".
 */
export async function saveStlModel(supabase: SupabaseClient, input: SaveStlModelInput): Promise<SaveStlModelResult> {
  let payload: ReturnType<typeof buildStlModelPayload>;
  try {
    payload = buildStlModelPayload(input.values);
  } catch (err) {
    return { ok: false, stage: "validation", message: err instanceof Error ? err.message : "Datos inválidos." };
  }
  if (typeof payload.name !== "string" || payload.name.trim() === "") {
    return { ok: false, stage: "validation", message: "El modelo necesita un título." };
  }

  let modelId: string;
  if (input.modelId) {
    const { error } = await supabase.from("stl_models").update(payload).eq("id", input.modelId);
    if (error) return { ok: false, stage: "model", message: error.message };
    modelId = input.modelId;
  } else {
    const { data, error } = await supabase.from("stl_models").insert([payload]).select().single();
    if (error) return { ok: false, stage: "model", message: error.message };
    if (!data?.id) return { ok: false, stage: "model", message: "No se pudo crear el modelo." };
    modelId = String(data.id);
  }

  if (!input.fileUrl) return { ok: true, modelId, variantId: input.variantId ?? null };

  const variantPayload = buildStlVariantPayload(modelId, input.values, input.fileUrl);
  const variantResult = input.variantId
    ? await supabase.from("stl_variants").update(variantPayload).eq("id", input.variantId).select("id").single()
    : await supabase.from("stl_variants").insert([variantPayload]).select("id").single();
  if (variantResult.error) {
    return {
      ok: false,
      stage: "variant",
      modelId,
      message: `El modelo se guardó, pero no pude asociar el archivo: ${variantResult.error.message}`,
    };
  }
  return { ok: true, modelId, variantId: variantResult.data?.id ?? input.variantId ?? null };
}
