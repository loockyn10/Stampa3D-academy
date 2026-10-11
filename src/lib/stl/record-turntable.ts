import { PREVIEW_SPEC, pickRecorderMimeType, turntableAngle } from "@/lib/stl/preview-media";

/** Subconjunto de APIs del navegador que usamos: se inyecta para poder testear en Node. */
export interface TurntableRecorderDeps {
  canvas: { captureStream?: (fps?: number) => { getTracks(): { stop(): void }[] } };
  MediaRecorderCtor?: {
    new (stream: unknown, options?: { mimeType?: string; videoBitsPerSecond?: number }): TurntableMediaRecorder;
    isTypeSupported?: (type: string) => boolean;
  } | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Dibuja un frame con el ángulo dado (rad). */
  renderFrame: (angle: number) => void;
}

export interface TurntableMediaRecorder {
  state: string;
  ondataavailable: ((event: { data: { size: number } }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export class PreviewUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewUnsupportedError";
  }
}

export interface TurntableResult {
  chunks: { size: number }[];
  mimeType: string;
  frames: number;
}

/**
 * Graba una vuelta completa (360°) del canvas con MediaRecorder.
 * El ángulo sale del reloj (no del número de frame): si el navegador se retrasa, la vuelta
 * igual dura `durationMs`. Usa setTimeout (no rAF) para no frenarse en pestañas en segundo plano.
 */
export async function recordTurntable(
  deps: TurntableRecorderDeps,
  spec: { durationMs: number; fps: number; videoBitsPerSecond: number } = PREVIEW_SPEC,
): Promise<TurntableResult> {
  const { canvas, MediaRecorderCtor } = deps;
  if (typeof canvas.captureStream !== "function") {
    throw new PreviewUnsupportedError("Este navegador no soporta canvas.captureStream.");
  }
  if (!MediaRecorderCtor) throw new PreviewUnsupportedError("Este navegador no soporta MediaRecorder.");
  const mimeType = pickRecorderMimeType(MediaRecorderCtor.isTypeSupported?.bind(MediaRecorderCtor));
  if (!mimeType) throw new PreviewUnsupportedError("Este navegador no puede grabar video WebM.");

  const stream = canvas.captureStream(spec.fps);
  const recorder = new MediaRecorderCtor(stream, { mimeType, videoBitsPerSecond: spec.videoBitsPerSecond });
  const chunks: { size: number }[] = [];
  let failure: unknown = null;
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onerror = (event) => {
    failure = event ?? new Error("MediaRecorder falló.");
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const frameMs = 1000 / spec.fps;
  let frames = 0;
  try {
    deps.renderFrame(0);
    recorder.start();
    const startedAt = deps.now();
    for (;;) {
      const elapsed = deps.now() - startedAt;
      deps.renderFrame(turntableAngle(elapsed, spec.durationMs));
      frames += 1;
      if (elapsed >= spec.durationMs || failure) break;
      await deps.sleep(frameMs);
    }
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
  }
  await stopped;

  if (failure) throw failure instanceof Error ? failure : new Error("MediaRecorder falló.");
  if (chunks.length === 0) throw new Error("La grabación no produjo datos.");
  return { chunks, mimeType, frames };
}
