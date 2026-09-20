// Tipos del módulo Neon LED de Stampa Maker. Todo en milímetros (1 unidad = 1 mm),
// plano XY con Y hacia arriba. Este módulo NO depende de createLetterGeometry.ts.
import type { Point2D } from "@/lib/maker/types";

/**
 * Un recorrido central (centerline) por el que pasa el Neon Flex. Es la
 * frontera del módulo: INPUT (texto / SVG) -> NeonPath[] -> motor geométrico.
 * `points` ya está aplanado (sin curvas) y en mm. En un path cerrado el
 * último punto NO repite al primero: el cierre es implícito.
 */
export interface NeonPath {
  points: Point2D[];
  closed: boolean;
}

export type NeonFontId = "mistral-singleline" | "relief-singleline" | "neon-linea" | "neon-cursiva";

export type NeonSourceType = "text" | "svg";

/**
 * Fuente del diseño. `fontId`/`letterSpacingPct` también rigen el texto `<text>` de un SVG
 * (se reemplaza siempre por la fuente Neon elegida: no se reproduce la font-family original).
 */
export type NeonSource =
  | { type: "text"; text: string; fontId: NeonFontId; letterSpacingPct: number }
  | { type: "svg"; fileName: string; content: string; fontId: NeonFontId; letterSpacingPct: number };

/** Parámetros físicos del canal U. */
export interface NeonChannelParams {
  /** Ancho del Neon Flex (mm). */
  neonWidthMm: number;
  /** Holgura lateral TOTAL (mm), repartida mitad a cada lado: canal interior = neonWidthMm + clearanceMm. */
  clearanceMm: number;
  /** Alto de las paredes sobre el piso (mm). Altura total = floorThicknessMm + wallHeightMm. */
  wallHeightMm: number;
  wallThicknessMm: number;
  floorThicknessMm: number;
  /** Radio mínimo de curvatura admisible del Neon (mm); solo dispara warnings. */
  minBendRadiusMm: number;
}

export interface NeonParams extends NeonChannelParams {
  /** Alto del DISEÑO (recorrido central) en mm. El canal impreso es más grande: suma el ancho exterior. */
  designHeightMm: number;
}

export type NeonIssueCode =
  | "NO_PATHS"
  | "CAVITY_COLLAPSED"
  | "GEOMETRY_FAILED"
  | "MIN_BEND_RADIUS"
  | "THIN_WALL"
  | "UNSUPPORTED_CHARS"
  | "IGNORED_FILLED_SHAPES"
  | "SVG_TEXT_FONT"
  | "TOO_MANY_POINTS";

export interface NeonIssue {
  code: NeonIssueCode;
  message: string;
}

/** Error de entrada (texto/SVG) con mensaje listo para la UI. */
export type NeonInputErrorCode = "SVG_FILL_ONLY" | "SVG_NO_PATHS" | "SVG_ZERO_HEIGHT" | "SVG_UNSUPPORTED" | "EMPTY_TEXT" | "NO_GLYPHS";

export class NeonInputError extends Error {
  code: NeonInputErrorCode;
  constructor(code: NeonInputErrorCode, message: string) {
    super(message);
    this.name = "NeonInputError";
    this.code = code;
  }
}

export interface NeonPathsResult {
  paths: NeonPath[];
  /** Avisos de entrada (caracteres omitidos, formas rellenas ignoradas...). */
  issues: NeonIssue[];
}

export interface CurvatureReport {
  /** Radio mínimo aproximado hallado (mm), o null si no se pudo medir (p.ej. todo son rectas cortas). */
  minRadiusMm: number | null;
  /** true si hay al menos una curva claramente más cerrada que el radio configurado. */
  belowMinimum: boolean;
}

export interface NeonMetrics {
  /** Longitud total de los centerlines ANTES del offset (mm). */
  lengthMm: number;
  /** Longitud recomendada de Neon Flex (+5%, mm). */
  recommendedLengthMm: number;
  innerWidthMm: number;
  outerWidthMm: number;
  /** Caja del recorrido central (mm). */
  pathBounds: { width: number; height: number };
  /** Caja de la pieza impresa (incluye el canal), en mm. */
  printedSize: { width: number; height: number; depth: number };
  curvature: CurvatureReport;
}
