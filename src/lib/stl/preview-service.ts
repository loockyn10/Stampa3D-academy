import type { SupabaseClient } from "@supabase/supabase-js";
import { STL_VIEWER_MAX_BYTES, getStlViewerSupport } from "@/lib/stl/library";
import {
  PREVIEW_FAILURE_NOTICE,
  STL_PREVIEW_BUCKET,
  buildPreviewPath,
  buildPreviewUrl,
  canGeneratePreview,
} from "@/lib/stl/preview-media";
import type { GeneratedPreview } from "@/lib/stl/generate-preview";
import type { Model3DFormat } from "@/lib/stl/library";

export type PreviewStoreResult =
  | { ok: true; previewUrl: string; bytes: number }
  | { ok: false; message: string; reason: string };

export interface PreviewStoreInput {
  supabase: SupabaseClient;
  modelId: string;
  /** Variante descargable: el archivo se lee con /api/stl/preview (misma autorización que el viewer). */
  variantId: string | null;
  fileUrl: string | null;
}

export interface PreviewStoreDeps {
  fetchImpl?: typeof fetch;
  generate?: (format: Model3DFormat, buffer: ArrayBuffer) => Promise<GeneratedPreview>;
  now?: () => number;
}

function failure(reason: string): PreviewStoreResult {
  return { ok: false, message: PREVIEW_FAILURE_NOTICE, reason };
}

/**
 * Genera el preview 360° de un modelo y lo publica (Storage + `stl_models.preview_url`).
 * NUNCA lanza: cualquier fallo vuelve como `{ ok: false }` para que el alta/edición del modelo
 * no se vea afectada. `stl-files` sigue privado: el archivo se lee por URL firmada de 5 min.
 */
export async function generateAndStorePreview(input: PreviewStoreInput, deps: PreviewStoreDeps = {}): Promise<PreviewStoreResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  try {
    if (!input.variantId) return failure("sin-variante");
    if (!canGeneratePreview(input.fileUrl)) return failure("formato-no-soportado");
    const support = getStlViewerSupport(input.fileUrl);
    if (!support.supported) return failure("formato-no-soportado");

    const signRes = await fetchImpl("/api/stl/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: input.variantId }),
    });
    const signed = await signRes.json().catch(() => ({}));
    if (!signRes.ok || !signed?.url) return failure(`firma-${signRes.status}`);

    const fileRes = await fetchImpl(signed.url as string);
    if (!fileRes.ok) return failure(`descarga-${fileRes.status}`);
    const buffer = await fileRes.arrayBuffer();
    if (buffer.byteLength > STL_VIEWER_MAX_BYTES) return failure("archivo-pesado");

    const generate = deps.generate ?? (await import("@/lib/stl/generate-preview")).generateModelPreview;
    const generated = await generate(support.format, buffer);

    const path = buildPreviewPath(input.modelId);
    const { error: uploadError } = await input.supabase.storage
      .from(STL_PREVIEW_BUCKET)
      .upload(path, generated.blob, { upsert: true, contentType: "video/webm", cacheControl: "3600" });
    if (uploadError) return failure(`storage: ${uploadError.message}`);

    const { data } = input.supabase.storage.from(STL_PREVIEW_BUCKET).getPublicUrl(path);
    const previewUrl = buildPreviewUrl(data.publicUrl, now());
    const { error: updateError } = await input.supabase.from("stl_models").update({ preview_url: previewUrl }).eq("id", input.modelId);
    if (updateError) return failure(`db: ${updateError.message}`);

    return { ok: true, previewUrl, bytes: generated.bytes };
  } catch (err) {
    return failure(err instanceof Error ? err.message : "error-desconocido");
  }
}
