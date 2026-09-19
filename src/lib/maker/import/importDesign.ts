import { DesignImportError, DEFAULT_PNG_OPTIONS, IMPORT_LIMITS, type DesignSource, type ImportedDesign, type PngImportOptions, type RawDesign } from "@/lib/maker/import/types";
import { extractSvgShapes } from "@/lib/maker/import/svgImport";
import { extractPngShapes } from "@/lib/maker/import/pngImport";
import { normalizeRawDesign } from "@/lib/maker/import/normalize";
import type { ContourPiece } from "@/lib/maker/geometry/createLetterGeometry";

export type FileDesignSource = Exclude<DesignSource, { type: "text" }>;

/** Detecta el tipo de archivo por extensión (solo .svg y .png; nada de JPG/WEBP/PDF todavía). */
export function detectFileKind(fileName: string): "svg" | "png" | null {
  const ext = fileName.toLowerCase().split(".").pop();
  return ext === "svg" ? "svg" : ext === "png" ? "png" : null;
}

/**
 * Etapa 1: fuente -> formas crudas (SVG vectorial o PNG trazado), en las
 * unidades de la fuente. Cacheable: no depende del alto en mm.
 */
export function extractRawDesign(source: FileDesignSource, pngOptions: PngImportOptions = DEFAULT_PNG_OPTIONS): RawDesign {
  try {
    if (source.type === "svg") return extractSvgShapes(source.content);
    return extractPngShapes(source.bytes, pngOptions);
  } catch (err) {
    throw toImportError(err);
  }
}

/** Etapa 2: formas crudas -> ContourGroups en mm (alto exacto, aspect ratio intacto, mínimo en el origen). Barata: se re-ejecuta al cambiar solo el alto. */
export function normalizeDesign(raw: RawDesign, source: FileDesignSource, heightMm: number): ImportedDesign {
  try {
    return normalizeRawDesign(raw, heightMm, source.type, source.fileName);
  } catch (err) {
    throw toImportError(err);
  }
}

/** Fuente de archivo -> ContourGroups (etapas 1 y 2). Única puerta de entrada para SVG/PNG. */
export function importDesign(source: FileDesignSource, heightMm: number, pngOptions: PngImportOptions = DEFAULT_PNG_OPTIONS): ImportedDesign {
  const size = source.type === "svg" ? source.content.length : source.bytes.length;
  if (size > IMPORT_LIMITS.maxFileBytes) throw new DesignImportError("FILE_TOO_LARGE", "El archivo es demasiado grande (máximo 10 MB).");
  return normalizeDesign(extractRawDesign(source, pngOptions), source, heightMm);
}

/** Diseño importado -> pieza para el motor Maker (`createGeometryFromContourPieces`). Un solo componente físico por diseño; las islas quedan juntas en sus posiciones relativas. */
export function designToContourPieces(design: ImportedDesign): ContourPiece[] {
  return [{ char: "diseno", label: "el diseño importado", contourGroups: design.contourGroups }];
}

function toImportError(err: unknown): DesignImportError {
  if (err instanceof DesignImportError) return err;
  return new DesignImportError("IMPORT_FAILED", "No se pudo importar el archivo. Verificá que sea un SVG o PNG válido.");
}
