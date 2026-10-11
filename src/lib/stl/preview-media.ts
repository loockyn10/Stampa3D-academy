/**
 * Previews 360° de la Librería STL: constantes y lógica pura (sin DOM, three ni Supabase),
 * para poder testearla en Node.
 *
 * Arquitectura: el Admin genera un WebM por modelo (client-side), lo sube al bucket público
 * `stl-previews` y guarda su URL en `stl_models.preview_url`. Las cards solo reproducen ese asset;
 * el viewer Three.js real vive únicamente en el detalle del modelo.
 */

export const STL_PREVIEW_BUCKET = "stl-previews";
/** Bucket público ya existente de miniaturas (WebP generadas conviven con las cargadas a mano). */
export const STL_THUMBNAIL_BUCKET = "stl-thumbnails";

/**
 * Miniatura automática: mismo render/escena/material/fondo que el WebM, pero en vista 3/4
 * (yaw 40° sobre el eje vertical del modelo; la elevación es la misma de la cámara del preview).
 */
export const THUMBNAIL_SPEC = {
  size: 512,
  mimeType: "image/webp",
  quality: 0.85,
  /** Giro del modelo para la vista 3/4 (rad). */
  yaw: (40 * Math.PI) / 180,
} as const;

export const PREVIEW_SPEC = {
  size: 512,
  durationMs: 4000,
  fps: 24,
  /** ~0.8 Mbps => ~400 KB para 4 s. */
  videoBitsPerSecond: 800_000,
  /** Debe coincidir con --stampa-bg-soft (fondo de la card). */
  background: 0x212126,
  /** Elevación de la cámara durante la vuelta (rad). */
  elevation: 0.45,
} as const;

/** Orden de preferencia: VP9 comprime mejor, VP8 es el más compatible. */
export const PREVIEW_MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"] as const;

export function pickRecorderMimeType(isTypeSupported?: ((type: string) => boolean) | null): string | null {
  if (typeof isTypeSupported !== "function") return null;
  for (const candidate of PREVIEW_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      /* ignorar y probar el siguiente */
    }
  }
  return null;
}

/** Path determinístico: regenerar reemplaza el asset anterior (upsert), no deja huérfanos. */
export function buildPreviewPath(modelId: string): string {
  if (!modelId || modelId.includes("/") || modelId.includes("..")) throw new Error("Id de modelo inválido para el preview.");
  return `${modelId}/preview.webm`;
}

/** Path determinístico de la miniatura generada: regenerar reemplaza el objeto (upsert). */
export function buildThumbnailPath(modelId: string): string {
  if (!modelId || modelId.includes("/") || modelId.includes("..")) throw new Error("Id de modelo inválido para la miniatura.");
  return `${modelId}/thumbnail.webp`;
}

/**
 * ¿La miniatura actual la generó el sistema (y por lo tanto se puede reemplazar sin pedir permiso)?
 * Sin columna de origen: se distingue por el path determinístico `{modelId}/thumbnail.webp` en `stl-thumbnails`.
 * Una miniatura cargada a mano (otra URL/path) nunca coincide.
 */
export function isGeneratedThumbnailUrl(url: string | null | undefined, modelId: string): boolean {
  if (!url || !modelId) return false;
  return url.split("?")[0].endsWith(`/${STL_THUMBNAIL_BUCKET}/${modelId}/thumbnail.webp`);
}

/** Regla de no-sobrescritura: genera si falta o si la actual es generada; una manual solo se pisa con `force`. */
export function shouldGenerateThumbnail(input: { currentUrl: string | null | undefined; modelId: string; force?: boolean }): boolean {
  if (input.force) return true;
  if (!input.currentUrl || !input.currentUrl.trim()) return true;
  return isGeneratedThumbnailUrl(input.currentUrl, input.modelId);
}

/** URL guardada en DB: URL pública + `?v=` para evitar el cache viejo tras regenerar. */
export function buildPreviewUrl(publicUrl: string, version: number): string {
  return `${publicUrl.split("?")[0]}?v=${version}`;
}

/** Ángulo (rad) de la vuelta completa según el tiempo transcurrido; nunca pasa de una vuelta. */
export function turntableAngle(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  const ratio = Math.min(Math.max(elapsedMs / durationMs, 0), 1);
  return ratio * Math.PI * 2;
}

export type PreviewGenerationStatus = "idle" | "generating" | "ready" | "failed";

export const PREVIEW_STATUS_LABEL: Record<PreviewGenerationStatus, string> = {
  idle: "Sin vista 360°",
  generating: "Generando vista 360°…",
  ready: "Vista 360° lista",
  failed: "No se pudo generar",
};

export const PREVIEW_FAILURE_NOTICE = "No pudimos generar la vista 360°. El modelo fue guardado correctamente.";

export const THUMBNAIL_FAILURE_NOTICE = "No pudimos generar la miniatura automática. El modelo y la vista 360° se guardaron igual.";

/** Solo STL y 3MF generan preview; ZIP, URLs externas y otros no. */
export function canGeneratePreview(fileUrl: string | null | undefined): boolean {
  if (!fileUrl || !fileUrl.startsWith("storage://")) return false;
  const lower = fileUrl.toLowerCase();
  return lower.endsWith(".stl") || lower.endsWith(".3mf");
}

/* ---------------------------- Ciclo ambiental en cards ---------------------------- */

export const AMBIENT_TIMING = {
  /** Espera antes de arrancar el primer preview ambiental (evita autoplay en el primer paint). */
  startDelayMs: 700,
  /** Pausa entre un preview que termina y el siguiente. */
  betweenDelayMs: 350,
  /** Pausa cuando solo hay una card candidata antes de repetirla. */
  soloDelayMs: 2500,
  /** Espera tras salir de hover/focus antes de volver al ciclo. */
  resumeDelayMs: 1000,
  /** Espera tras perder la card activa (scroll/error) antes de seguir con otra. */
  recoverDelayMs: 150,
  /** Umbral de IntersectionObserver para considerar una card "visible". */
  visibleThreshold: 0.5,
} as const;
