import type { MakerFontId } from "@/lib/maker/types";

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

// ---------------------------------------------------------------- Decoraciones (0.2)
/**
 * Convención SEMÁNTICA de ángulo (la única que ve la UI y la IA): 0° = frente, +90° = lado derecho (lado del asa),
 * 180° = atrás, -90° = lado izquierdo. Internamente el asa vive en +X (theta = 0) y el frente mira a -Y, así que
 * theta = angleDeg - 90°. Ver decorations/placement.ts.
 */
export type MugDecorationMode = "emboss" | "engrave" | "medallion";
export type MugMedallionShape = "oval" | "circle" | "rounded-rect";
export type MugTextAlign = "left" | "center" | "right";
export type MugRasterDetection = "auto" | "alpha" | "luminance";

/** Texto en fuente rellena (Montserrat). Puede tener varias líneas ("
"), alineadas según `align`. */
export interface MugTextSource {
  kind: "text";
  text: string;
  fontId: MakerFontId;
  align: MugTextAlign;
}
/** SVG relleno: el contenido vive en un ASSET (Storage privado en proyectos), nunca dentro de la definición. */
export interface MugSvgSource {
  kind: "svg";
  assetId: string;
  fileName: string;
}
/** PNG / JPG: silueta (máscara) por transparencia o luminosidad. Asset aparte, igual que el SVG. */
export interface MugRasterSource {
  kind: "raster";
  assetId: string;
  fileName: string;
  format: "png" | "jpg";
  detection: MugRasterDetection;
  /** 0-255. null = automático (Otsu en luminosidad, 128 en transparencia). */
  threshold: number | null;
  invert: boolean;
}
/** Sin arte: solo válido para un medallón liso. */
export interface MugNoArtSource {
  kind: "none";
}
export type MugDecorationSource = MugTextSource | MugSvgSource | MugRasterSource | MugNoArtSource;

export interface MugMedallionDef {
  shape: MugMedallionShape;
  /** Espesor de la base del medallón (mm sobre la superficie). */
  baseDepthMm: number;
  /** Margen entre el borde del medallón y el arte (mm). */
  paddingMm: number;
  /** Radio de esquina (solo rectángulo redondeado). */
  cornerRadiusMm: number;
}

/**
 * Una decoración sobre el cuerpo: serializable, independiente de React y apta para proyectos / IA futura
 * (`prompt -> MugDefinition + MugDecoration[] -> mismo motor`). Emboss/engrave: `size` es el del arte; medallón:
 * `size` es el del medallón y el arte se ajusta dentro (`paddingMm`), con `depthMm` = altura del arte sobre la base.
 */
export interface MugDecoration {
  id: string;
  name: string;
  enabled: boolean;
  source: MugDecorationSource;
  mode: MugDecorationMode;
  position: { angleDeg: number; centerZMm: number };
  size: { widthMm: number; heightMm: number; lockAspectRatio: boolean };
  rotationDeg: number;
  depthMm: number;
  edgeBevelMm: number;
  medallion: MugMedallionDef;
}
