import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildStlModelPayload,
  buildStlModelSlug,
  buildStlVariantPayload,
  pickAvailableSlug,
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
  | {
      ok: false;
      stage: "validation" | "model" | "variant";
      message: string;
      /** Modelo que quedó en DB (sin archivo) cuando falla la variante y no se pudo limpiar. */
      orphanModelId?: string;
    };

const UNIQUE_VIOLATION = "23505";
const MAX_SLUG_ATTEMPTS = 5;

async function findAvailableSlug(supabase: SupabaseClient, base: string): Promise<string> {
  const { data } = await supabase.from("stl_models").select("slug").like("slug", `${base}%`);
  const taken = ((data ?? []) as { slug: string | null }[]).map((row) => row.slug).filter((slug): slug is string => Boolean(slug));
  return pickAvailableSlug(base, taken);
}

/**
 * Único camino de alta/edición de `stl_models` (+ variante descargable) del Admin.
 *
 * Schema real (NOT NULL): stl_models.name, stl_models.slug; stl_variants.model_id, name, file_url.
 * - El título se normaliza (trim) y se valida acá antes de tocar Supabase.
 * - Alta: slug derivado del título, con sufijo -2, -3… si ya existe (reintenta si hay carrera por unique).
 * - Edición: el slug existente no se toca.
 * - Si la primera variante falla en un alta, se intenta borrar el modelo recién creado (nadie más lo
 *   referencia todavía); si no se puede, se informa el modelo huérfano. No hay transacción.
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
  const isCreate = !input.modelId;

  if (input.modelId) {
    const { error } = await supabase.from("stl_models").update(payload).eq("id", input.modelId);
    if (error) return { ok: false, stage: "model", message: error.message };
    modelId = input.modelId;
  } else {
    const baseSlug = buildStlModelSlug(payload.name);
    let created: { id?: string } | null = null;
    let lastError = "No se pudo crear el modelo.";
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS && !created; attempt += 1) {
      const slug = await findAvailableSlug(supabase, baseSlug);
      const { data, error } = await supabase
        .from("stl_models")
        .insert([{ ...payload, slug, sort_order: 0 }])
        .select()
        .single();
      if (!error && data?.id) {
        created = data;
        break;
      }
      lastError = error?.message ?? lastError;
      if (error?.code !== UNIQUE_VIOLATION) return { ok: false, stage: "model", message: lastError };
    }
    if (!created?.id) return { ok: false, stage: "model", message: lastError };
    modelId = String(created.id);
  }

  if (!input.fileUrl) return { ok: true, modelId, variantId: input.variantId ?? null };

  let variantPayload: ReturnType<typeof buildStlVariantPayload>;
  try {
    variantPayload = buildStlVariantPayload(modelId, input.values, input.fileUrl);
  } catch (err) {
    return variantFailure(supabase, modelId, isCreate, err instanceof Error ? err.message : "Datos inválidos.");
  }

  const variantResult = input.variantId
    ? await supabase.from("stl_variants").update(variantPayload).eq("id", input.variantId).select("id").single()
    : await supabase.from("stl_variants").insert([variantPayload]).select("id").single();
  if (variantResult.error) return variantFailure(supabase, modelId, isCreate, variantResult.error.message);

  return { ok: true, modelId, variantId: variantResult.data?.id ?? input.variantId ?? null };
}

async function variantFailure(
  supabase: SupabaseClient,
  modelId: string,
  isCreate: boolean,
  detail: string,
): Promise<SaveStlModelResult> {
  if (!isCreate) {
    return { ok: false, stage: "variant", message: `Se guardaron los datos del modelo, pero no pude asociar el archivo: ${detail}` };
  }
  // Modelo recién creado en esta misma operación: sin variantes ni descargas, se puede retirar sin riesgo.
  const { error: cleanupError } = await supabase.from("stl_models").delete().eq("id", modelId);
  if (!cleanupError) {
    return { ok: false, stage: "variant", message: `No se creó el modelo: no pude asociar el archivo (${detail}). Probá de nuevo.` };
  }
  return {
    ok: false,
    stage: "variant",
    orphanModelId: modelId,
    message: `El modelo quedó creado sin archivo (no pude asociarlo: ${detail}). Buscalo en Modelos para completarlo antes de crear otro igual.`,
  };
}
