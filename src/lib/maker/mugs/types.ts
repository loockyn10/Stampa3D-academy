/**
 * Jarros 3D — modelo paramétrico central.
 *
 * `MugDefinition` es la ÚNICA fuente de verdad del motor: la UI, los presets del sistema, los proyectos guardados y
 * (más adelante) la IA producen SOLO este objeto; nunca arman geometría. 1 unidad = 1 mm, Z vertical, asa hacia +X.
 *
 * Dónde encajará la IA (NO implementada en 0.1):
 *   prompt -> `MugDesignProposal` (salida del modelo, parcial y no confiable)
 *          -> `normalizeMugDefinition()` (acota/completa, mismo camino que abrir un proyecto)
 *          -> `validateMug()` -> `createMug()`.
 */
export type MugMode = "printed" | "insert-shell";
export type MugBodyStyle = "straight" | "conical" | "barrel" | "bulged";
export type MugRimStyle = "simple" | "thick" | "rounded";
export type MugBaseStyle = "normal" | "reinforced";
export type MugHandleStyle = "classic" | "square" | "angular";
export type MugSurfaceStyle = "smooth" | "faceted";

export interface MugInsert {
  heightMm: number;
  topDiameterMm: number;
  bottomDiameterMm: number;
  /** Holgura radial por lado (mm). */
  clearanceMm: number;
}

export interface MugHandleDef {
  enabled: boolean;
  style: MugHandleStyle;
  /** true: altura, proyección y posición se derivan del tamaño del jarro (ver deriveHandleDefaults). */
  auto: boolean;
  /** Distancia vertical entre los centros de las dos uniones. */
  heightMm: number;
  /** Cuánto se aleja del cuerpo el eje central del asa. */
  projectionMm: number;
  /** Espesor de la sección en el plano del asa (radial). */
  thicknessMm: number;
  /** Ancho de la sección (tangencial al cuerpo). */
  sectionWidthMm: number;
  /** Posición vertical del centro del asa, % de la altura total. */
  verticalPositionPct: number;
}

export interface MugBandsDef {
  enabled: boolean;
  count: number;
  heightMm: number;
  reliefMm: number;
}

export interface MugGroovesDef {
  enabled: boolean;
  count: number;
  depthMm: number;
}

/** Reservado (0.2+): texto, SVG, logos, relieves, medallones. No se usa en 0.1. */
export interface MugDecoration {
  kind: string;
}

export interface MugDefinition {
  mode: MugMode;
  heightMm: number;
  topDiameterMm: number;
  bottomDiameterMm: number;
  wallThicknessMm: number;
  bottomThicknessMm: number;
  bodyStyle: MugBodyStyle;
  /** 0–100. Solo barril / abombado. */
  bodyBulgePct: number;
  rim: MugRimStyle;
  base: MugBaseStyle;
  surface: { style: MugSurfaceStyle; sides: number };
  grooves: MugGroovesDef;
  bands: MugBandsDef;
  handle: MugHandleDef;
  /** Solo modo "insert-shell". */
  insert: MugInsert;
  decorations: MugDecoration[];
}

/** Salida futura de una IA: una propuesta no confiable que SIEMPRE pasa por normalizeMugDefinition antes de usarse. */
export interface MugDesignProposal {
  prompt: string;
  definition: unknown;
  rationale?: string;
}

/** Calidad de malla: "preview" para sliders, "export" para el STL. */
export type MugQuality = "preview" | "export";

export interface MugIssue {
  code: string;
  message: string;
  field?: string;
}

export interface MugMetrics {
  heightMm: number;
  maxDiameterMm: number;
  /** Capacidad geométrica aproximada (ml): integral del perfil interior hasta el borde. */
  capacityMl: number | null;
  materialVolumeCm3: number | null;
  /** Diámetro interior resultante (base y boca). En "insert-shell": inserto + 2 × holgura. */
  interior: { bottomDiameterMm: number; topDiameterMm: number };
  triangleCount: number;
  boundingBox: { width: number; depth: number; height: number };
}
