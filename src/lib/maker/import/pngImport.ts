import UPNG from "upng-js";
import { DesignImportError, IMPORT_LIMITS, type PngImportOptions, type RawDesign } from "@/lib/maker/import/types";
import { traceRaster, type RasterImage } from "@/lib/maker/import/rasterTrace";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Decodifica un PNG a RGBA. Valida firma, tamaño de archivo y dimensiones
 * (leídas del IHDR ANTES de decodificar, para no expandir una imagen
 * gigante en memoria) y traduce cualquier fallo del decodificador a un
 * mensaje claro. La misma ruta se usa en el navegador y en los tests.
 */
export function decodePng(bytes: Uint8Array): RasterImage {
  if (bytes.length > IMPORT_LIMITS.maxFileBytes) {
    throw new DesignImportError("FILE_TOO_LARGE", "El archivo PNG es demasiado grande (máximo 10 MB).");
  }
  if (bytes.length < 33 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
    throw new DesignImportError("PNG_INVALID", "El archivo no es un PNG válido.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!(width > 0 && height > 0)) throw new DesignImportError("PNG_INVALID", "El archivo PNG tiene dimensiones inválidas.");
  if (width > IMPORT_LIMITS.maxPngDimension || height > IMPORT_LIMITS.maxPngDimension) {
    throw new DesignImportError("PNG_TOO_LARGE", `El PNG es demasiado grande (${width}×${height}px). El máximo es ${IMPORT_LIMITS.maxPngDimension}×${IMPORT_LIMITS.maxPngDimension}px.`);
  }
  try {
    const copy = bytes.slice().buffer as ArrayBuffer;
    const img = UPNG.decode(copy);
    const frames = UPNG.toRGBA8(img);
    if (!frames.length) throw new Error("sin datos");
    return { width: img.width, height: img.height, data: new Uint8Array(frames[0]) };
  } catch {
    throw new DesignImportError("PNG_INVALID", "No se pudo leer el PNG (archivo dañado o con un formato no soportado).");
  }
}

/** Etapa 1 PNG: bytes -> formas trazadas (ver rasterTrace.ts). */
export function extractPngShapes(bytes: Uint8Array, options: PngImportOptions): RawDesign {
  return traceRaster(decodePng(bytes), options);
}
