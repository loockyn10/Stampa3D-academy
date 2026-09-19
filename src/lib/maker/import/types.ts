import type { ContourGroup, Point2D } from "@/lib/maker/types";

/**
 * Origen del diseño (0.5). Todos terminan en `ContourGroup[]` (mm, Y arriba)
 * antes de tocar el motor de cuerpo/frente — ver import/importDesign.ts. La
 * fuente "text" no lleva datos acá: el texto/fuente viven en
 * `LetterSignParams` y su normalización sigue en createLetterGeometry.ts.
 */
export type DesignSource =
  | { type: "text" }
  | { type: "svg"; fileName: string; content: string }
  | { type: "png"; fileName: string; bytes: Uint8Array };

export type ImportErrorCode =
  | "INVALID_FILE"
  | "FILE_TOO_LARGE"
  | "SVG_INVALID"
  | "SVG_UNSUPPORTED"
  | "SVG_TEXT"
  | "SVG_UNSAFE"
  | "SVG_EMPTY"
  | "PNG_INVALID"
  | "PNG_TOO_LARGE"
  | "TRACE_EMPTY"
  | "TOO_COMPLEX"
  | "COLLAPSED"
  | "IMPORT_FAILED";

/** Error de importación con mensaje ya listo para mostrar en la UI (nunca una excepción técnica cruda). */
export class DesignImportError extends Error {
  code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "DesignImportError";
    this.code = code;
  }
}

export const IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxPngDimension: 4096,
  /** Vértices totales después de simplificar/unir; por encima se reintenta simplificando más y luego se rechaza. */
  maxVertices: 60000,
  /** Nodos XML de un SVG. */
  maxSvgNodes: 200000,
  maxXmlDepth: 200,
} as const;

/** Un conjunto de subpaths que se rellenan juntos con una misma regla (un <path>, un <rect>...). Coordenadas en unidades de la fuente. */
export interface RawShape {
  paths: Point2D[][];
  fillRule: "nonzero" | "evenodd";
}

/** Resultado de la etapa 1 (extraer geometría), antes de escalar a mm. `yDown`: SVG/PNG tienen Y hacia abajo. */
export interface RawDesign {
  shapes: RawShape[];
  warnings: string[];
  /** Solo PNG: qué canal definió el material ("alpha" si hay transparencia real, si no "luminosity" con umbral/invertir). */
  pngMode?: "alpha" | "luminosity";
}

/** Resultado de la etapa 2: diseño normalizado a mm, listo para el motor. */
export interface ImportedDesign {
  sourceType: "svg" | "png";
  fileName: string;
  contourGroups: ContourGroup[];
  widthMm: number;
  heightMm: number;
  warnings: string[];
  pngMode?: "alpha" | "luminosity";
}

export type PngSmoothing = "low" | "medium" | "high";

export interface PngImportOptions {
  /** Umbral de luminosidad 0-255 (imágenes SIN transparencia): luminosidad < umbral = material. */
  threshold: number;
  /** Invierte qué es material (logo blanco sobre fondo negro). */
  invert: boolean;
  smoothing: PngSmoothing;
}

export const DEFAULT_PNG_OPTIONS: PngImportOptions = { threshold: 128, invert: false, smoothing: "medium" };
