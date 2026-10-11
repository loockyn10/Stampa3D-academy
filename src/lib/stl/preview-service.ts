import type { SupabaseClient } from "@supabase/supabase-js";
import { STL_VIEWER_MAX_BYTES, getStlViewerSupport } from "@/lib/stl/library";
import {
  PREVIEW_FAILURE_NOTICE,
  STL_PREVIEW_BUCKET,
  STL_THUMBNAIL_BUCKET,
  THUMBNAIL_FAILURE_NOTICE,
  buildPreviewPath,
  buildPreviewUrl,
  buildThumbnailPath,
  canGeneratePreview,
  shouldGenerateThumbnail,
} from "@/lib/stl/preview-media";
import type { GeneratedAssets } from "@/lib/stl/generate-preview";
import type { Model3DFormat } from "@/lib/stl/library";

/** Estado de la miniatura tras una corrida: nunca bloquea el resultado del preview (y viceversa). */
export type ThumbnailOutcome = "generated" | "kept" | "failed" | "skipped";

export type PreviewStoreResult =
  | { ok: true; previewUrl: string | null; bytes: number; thumbnail: ThumbnailOutcome; thumbnailUrl: string | null; notice: string | null }
  | {
      ok: false;
      message: string;
      reason: string;
      /** Si la miniatura sí se pudo guardar aunque el preview falló. */
      thumbnail?: ThumbnailOutcome;
      thumbnailUrl?: string | null;
    };

export interface PreviewStoreInput {
  supabase: SupabaseClient;
  modelId: string;
  /** Variante descargable: el archivo se lee con /api/stl/preview (misma autorización que el viewer). */
  variantId: string | null;
  fileUrl: string | null;
  /** thumbnail_url actual del modelo: una miniatura manual no se pisa salvo `forceThumbnail`. */
  currentThumbnailUrl?: string | null;
  /** Acción explícita "Regenerar miniatura": reemplaza incluso una manual. */
  forceThumbnail?: boolean;
  /** Solo miniatura (sin grabar el WebM). Por defecto se genera todo. */
  thumbnailOnly?: boolean;
}

export interface PreviewStoreDeps {
  fetchImpl?: typeof fetch;
  generate?: (format: Model3DFormat, buffer: ArrayBuffer, options: { thumbnail: boolean; preview: boolean }) => Promise<GeneratedAssets>;
  now?: () => number;
}

function failure(reason: string, extra: { thumbnail?: ThumbnailOutcome; thumbnailUrl?: string | null } = {}): PreviewStoreResult {
  return { ok: false, message: PREVIEW_FAILURE_NOTICE, reason, ...extra };
}

/**
 * Genera la miniatura WebP y el preview 360° de un modelo y los publica
 * (Storage + `stl_models.thumbnail_url` / `preview_url`).
 * NUNCA lanza: cualquier fallo vuelve como `{ ok: false }` para que el alta/edición del modelo
 * no se vea afectada. `stl-files` sigue privado: el archivo se lee por URL firmada de 5 min.
 * Los dos assets son independientes: si falla uno, el otro igual se guarda.
 * Una miniatura manual existente no se sobrescribe salvo `forceThumbnail`.
 */
export async function generateAndStorePreview(input: PreviewStoreInput, deps: PreviewStoreDeps = {}): Promise<PreviewStoreResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  try {
    if (!input.variantId) return failure("sin-variante");
    if (!canGeneratePreview(input.fileUrl)) return failure("formato-no-soportado");
    const support = getStlViewerSupport(input.fileUrl);
    if (!support.supported) return failure("formato-no-soportado");

    const wantThumbnail = shouldGenerateThumbnail({
      currentUrl: input.currentThumbnailUrl,
      modelId: input.modelId,
      force: input.forceThumbnail,
    });
    const wantPreview = !input.thumbnailOnly;
    const keptThumbnail: ThumbnailOutcome = input.currentThumbnailUrl ? "kept" : "skipped";

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

    const generate = deps.generate ?? (await import("@/lib/stl/generate-preview")).generateModelAssets;
    const assets = await generate(support.format, buffer, { thumbnail: wantThumbnail, preview: wantPreview });

    const version = now();
    const update: { preview_url?: string; thumbnail_url?: string } = {};
    let thumbnail: ThumbnailOutcome = wantThumbnail ? "failed" : keptThumbnail;
    let thumbnailUrl: string | null = wantThumbnail ? null : (input.currentThumbnailUrl ?? null);
    let thumbnailReason: string | null = wantThumbnail ? assets.thumbnailError ?? "sin-miniatura" : null;
    let previewUrl: string | null = null;
    let previewReason: string | null = wantPreview ? assets.previewError ?? "sin-preview" : null;

    // Assets independientes: el fallo de uno (generación o subida) nunca descarta al otro.
    if (wantThumbnail && assets.thumbnail) {
      const path = buildThumbnailPath(input.modelId);
      const { error } = await input.supabase.storage
        .from(STL_THUMBNAIL_BUCKET)
        .upload(path, assets.thumbnail.blob, { upsert: true, contentType: "image/webp", cacheControl: "3600" });
      if (error) {
        thumbnailReason = `storage-thumbnail: ${error.message}`;
      } else {
        const { data } = input.supabase.storage.from(STL_THUMBNAIL_BUCKET).getPublicUrl(path);
        thumbnailUrl = buildPreviewUrl(data.publicUrl, version);
        update.thumbnail_url = thumbnailUrl;
        thumbnail = "generated";
        thumbnailReason = null;
      }
    }

    if (wantPreview && assets.preview) {
      const path = buildPreviewPath(input.modelId);
      const { error } = await input.supabase.storage
        .from(STL_PREVIEW_BUCKET)
        .upload(path, assets.preview.blob, { upsert: true, contentType: "video/webm", cacheControl: "3600" });
      if (error) {
        previewReason = `storage: ${error.message}`;
      } else {
        const { data } = input.supabase.storage.from(STL_PREVIEW_BUCKET).getPublicUrl(path);
        previewUrl = buildPreviewUrl(data.publicUrl, version);
        update.preview_url = previewUrl;
        previewReason = null;
      }
    }

    if (Object.keys(update).length > 0) {
      const { error: updateError } = await input.supabase.from("stl_models").update(update).eq("id", input.modelId);
      if (updateError) return failure(`db: ${updateError.message}`);
    }

    if (thumbnailReason) console.warn("[stl-preview] miniatura no generada:", thumbnailReason);

    if (wantPreview && !previewUrl) {
      return failure(previewReason ?? "sin-preview", { thumbnail, thumbnailUrl: thumbnail === "generated" ? thumbnailUrl : null });
    }
    if (input.thumbnailOnly && thumbnail === "failed") {
      return { ok: false, message: THUMBNAIL_FAILURE_NOTICE, reason: thumbnailReason ?? "sin-miniatura", thumbnail };
    }
    const bytes = assets.preview?.bytes ?? assets.thumbnail?.bytes ?? 0;
    return {
      ok: true,
      previewUrl,
      bytes,
      thumbnail,
      thumbnailUrl: thumbnail === "generated" ? thumbnailUrl : null,
      notice: wantThumbnail && thumbnail === "failed" ? THUMBNAIL_FAILURE_NOTICE : null,
    };
  } catch (err) {
    return failure(err instanceof Error ? err.message : "error-desconocido");
  }
}
