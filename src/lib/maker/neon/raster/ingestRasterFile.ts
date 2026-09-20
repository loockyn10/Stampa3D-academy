import { decodeRasterImage } from "@/lib/maker/neon/raster/decodeRasterImage";
import { UNSUPPORTED_KIND_LABEL, detectRasterFormat, rasterKindOf, type RasterFormatDetection } from "@/lib/maker/neon/raster/detectRasterFormat";
import { NeonInputError } from "@/lib/maker/neon/types";
import { RASTER_LIMITS, type RasterKind } from "@/lib/maker/neon/raster/types";

/**
 * Ingestión de un archivo de imagen elegido por el usuario: bytes -> formato (por contenido) -> decodificación -> listo
 * para el pipeline raster. Es lo que ejecuta la página Neon al cargar un archivo, separado del componente para poder
 * probarlo. Cada fallo tiene un mensaje propio (no un genérico "formato no compatible").
 */
export const INGEST_MESSAGES = {
  notImage: "El archivo seleccionado no es un PNG o JPEG válido.",
  readFailed: "No se pudo leer el archivo.",
  jpegDecode: "No se pudo decodificar el archivo JPEG.",
  pngDecode: "No se pudo decodificar el archivo PNG.",
  jpegTooLarge: "El JPEG supera el tamaño máximo permitido.",
  pngTooLarge: "El PNG supera el tamaño máximo permitido.",
} as const;

export interface RasterIngestInput {
  bytes: Uint8Array;
  fileName?: string;
  mimeType?: string;
}

export interface RasterIngestDebug {
  fileName: string;
  mimeType: string;
  format: string;
  hint: string | null;
  hintContradicts: boolean;
  byteLength: number;
  width: number | null;
  height: number | null;
  error: string | null;
}

export type RasterIngestResult =
  | { ok: true; kind: RasterKind; width: number; height: number; detection: RasterFormatDetection; debug: RasterIngestDebug }
  | { ok: false; message: string; code: string; debug: RasterIngestDebug };

/**
 * Valida y decodifica un archivo ya leído a bytes. La decodificación queda cacheada por identidad de `bytes`
 * (decodeRasterImage), así que el pipeline posterior no la repite. Nunca lanza: devuelve `{ ok: false, message }`.
 */
export function ingestRasterBytes(input: RasterIngestInput): RasterIngestResult {
  const { bytes, fileName = "", mimeType = "" } = input;
  const detection = detectRasterFormat(bytes, fileName, mimeType);
  const debug: RasterIngestDebug = {
    fileName,
    mimeType,
    format: detection.format === "unsupported" ? `unsupported(${detection.unsupportedKind})` : detection.format,
    hint: detection.hint,
    hintContradicts: detection.hintContradicts,
    byteLength: bytes.length,
    width: null,
    height: null,
    error: null,
  };
  const fail = (message: string, code: string, error?: unknown): RasterIngestResult => {
    debug.error = error instanceof Error ? `${error.name}: ${error.message}` : (error as string | undefined) ?? message;
    return { ok: false, message, code, debug };
  };

  const kind = rasterKindOf(detection.format);
  if (!kind) {
    const known = detection.unsupportedKind && detection.unsupportedKind !== "unknown" ? detection.unsupportedKind : null;
    const extra = known ? ` El contenido del archivo es ${UNSUPPORTED_KIND_LABEL[known]}${detection.hint ? ` aunque su nombre/tipo indica ${detection.hint === "jpeg" ? "JPG" : "PNG"}` : ""}: exportalo como PNG o JPEG.` : "";
    return fail(`${INGEST_MESSAGES.notImage}${extra}`, "RASTER_NOT_IMAGE");
  }
  if (bytes.length > RASTER_LIMITS.maxFileBytes) {
    return fail(`${INGEST_MESSAGES[kind === "jpg" ? "jpegTooLarge" : "pngTooLarge"]} (máximo ${RASTER_LIMITS.maxFileBytes / 1048576} MB).`, "RASTER_TOO_LARGE");
  }
  try {
    const { image } = decodeRasterImage(bytes);
    debug.width = image.width;
    debug.height = image.height;
    return { ok: true, kind, width: image.width, height: image.height, detection, debug };
  } catch (err) {
    if (err instanceof NeonInputError && err.code === "RASTER_TOO_LARGE") {
      // Dimensiones/megapíxeles fuera de límite: el mensaje trae el detalle (p.ej. "8064×6048px").
      return fail(`${INGEST_MESSAGES[kind === "jpg" ? "jpegTooLarge" : "pngTooLarge"]} ${err.message}`, "RASTER_TOO_LARGE", err);
    }
    return fail(kind === "jpg" ? INGEST_MESSAGES.jpegDecode : INGEST_MESSAGES.pngDecode, "RASTER_DECODE_FAILED", err);
  }
}

/** Diagnóstico de desarrollo: qué archivo entró, qué se detectó y por qué falló. Silencioso en producción. */
export function logRasterIngest(debug: RasterIngestDebug): void {
  if (process.env.NODE_ENV === "production") return;
  const line = { ...debug };
  if (debug.error) console.warn("[neon-ingest] rechazado", line);
  else console.debug("[neon-ingest] ok", line);
}

/**
 * Versión para el navegador: lee el `File` (arrayBuffer) y aplica la ingestión. La lectura fallida y el archivo enorme
 * (antes de leerlo a memoria) tienen su mensaje.
 */
export async function ingestRasterFile(file: File): Promise<RasterIngestResult & { bytes?: Uint8Array }> {
  if (file.size > RASTER_LIMITS.maxFileBytes) {
    const hint = /\.png$/i.test(file.name) ? "png" : "jpeg";
    const debug: RasterIngestDebug = { fileName: file.name, mimeType: file.type, format: "unread", hint, hintContradicts: false, byteLength: file.size, width: null, height: null, error: "file too large" };
    logRasterIngest(debug);
    return { ok: false, code: "RASTER_TOO_LARGE", message: `${INGEST_MESSAGES[hint === "png" ? "pngTooLarge" : "jpegTooLarge"]} (máximo ${RASTER_LIMITS.maxFileBytes / 1048576} MB).`, debug };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    const debug: RasterIngestDebug = { fileName: file.name, mimeType: file.type, format: "unread", hint: null, hintContradicts: false, byteLength: file.size, width: null, height: null, error: err instanceof Error ? `${err.name}: ${err.message}` : "read failed" };
    logRasterIngest(debug);
    return { ok: false, code: "RASTER_READ_FAILED", message: INGEST_MESSAGES.readFailed, debug };
  }
  const result = ingestRasterBytes({ bytes, fileName: file.name, mimeType: file.type });
  logRasterIngest(result.debug);
  return { ...result, bytes };
}
