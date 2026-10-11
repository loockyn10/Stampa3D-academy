/**
 * Previews 360° de la Librería STL: constantes y lógica pura (sin DOM, three ni Supabase),
 * para poder testearla en Node.
 *
 * Arquitectura: el Admin genera un WebM por modelo (client-side), lo sube al bucket público
 * `stl-previews` y guarda su URL en `stl_models.preview_url`. Las cards solo reproducen ese asset;
 * el viewer Three.js real vive únicamente en el detalle del modelo.
 */

export const STL_PREVIEW_BUCKET = "stl-previews";

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

/** Solo STL y 3MF generan preview; ZIP, URLs externas y otros no. */
export function canGeneratePreview(fileUrl: string | null | undefined): boolean {
  if (!fileUrl || !fileUrl.startsWith("storage://")) return false;
  const lower = fileUrl.toLowerCase();
  return lower.endsWith(".stl") || lower.endsWith(".3mf");
}

/* ---------------------------- Reproducción en cards ---------------------------- */

export interface PreviewPlaybackState {
  previewUrl: string | null | undefined;
  /** Video falló (error de red, formato, archivo borrado). */
  failed: boolean;
  reducedMotion: boolean;
  /** Dispositivo con hover real (desktop). En touch se reproduce por visibilidad. */
  canHover: boolean;
  hovering: boolean;
  /** La card está suficientemente visible en el viewport. */
  inView: boolean;
}

/** ¿Debe estar reproduciéndose el preview ahora? */
export function shouldPlayPreview(state: PreviewPlaybackState): boolean {
  if (!state.previewUrl || state.failed || state.reducedMotion) return false;
  return state.canHover ? state.hovering && state.inView : state.inView;
}

/**
 * ¿Debe el <video> tener `src` asignado? Antes de la primera activación no se pide nada.
 * Desktop: tras activarse se conserva el src (pausado) para reanudar sin nuevo request.
 * Touch: el src se libera al salir del viewport.
 */
export function shouldAttachPreviewSrc(state: PreviewPlaybackState & { hasActivated: boolean }): boolean {
  if (!state.previewUrl || state.failed || state.reducedMotion) return false;
  if (shouldPlayPreview(state)) return true;
  return state.canHover && state.hasActivated && state.inView;
}

/**
 * Registro de slots de reproducción simultánea: evita decenas de videos corriendo a la vez
 * en mobile. Al superar el máximo se desaloja al más antiguo.
 */
export function createPlaybackSlots(max: number) {
  const active: { id: string; release: () => void }[] = [];
  return {
    acquire(id: string, release: () => void): void {
      const existing = active.findIndex((slot) => slot.id === id);
      if (existing !== -1) active.splice(existing, 1);
      active.push({ id, release });
      while (active.length > max) active.shift()?.release();
    },
    release(id: string): void {
      const index = active.findIndex((slot) => slot.id === id);
      if (index !== -1) active.splice(index, 1);
    },
    size: () => active.length,
  };
}

export const MAX_SIMULTANEOUS_PREVIEWS = 2;
