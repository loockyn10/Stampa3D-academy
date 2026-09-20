import type { Point2D } from "@/lib/maker/types";
import type { NeonIssue, NeonPath } from "@/lib/maker/neon/types";

/**
 * Pipeline raster de Neon LED (0.2): imagen -> RasterMask -> skeleton -> NeonPath[].
 * PNG y JPEG comparten TODO a partir de `RasterImage` (RGBA). Nada acá depende de React ni del DOM.
 */
export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes por píxel, fila a fila. */
  data: Uint8Array;
}

export type RasterKind = "png" | "jpg";
export type RasterDetectionMode = "auto" | "alpha" | "luminance";
export type RasterSimplify = "low" | "medium" | "high";
export type RasterCleaning = 0 | 1 | 2 | 3;

/** Configuración de conversión: lo que se persiste en un proyecto (junto con el archivo original). */
export interface RasterSettings {
  /** "auto": alpha si la imagen tiene transparencia significativa, si no luminosidad. */
  detectionMode: RasterDetectionMode;
  /** Modo alpha: alpha > umbral = material (0-255). */
  alphaThreshold: number;
  /** Modo luminosidad: luminancia <= umbral = oscuro (0-255). null = automático (Otsu). */
  threshold: number | null;
  /** Invierte la MÁSCARA (no los paths): material = claro / transparente. */
  invert: boolean;
  /** -100..100: contraste de la luminancia antes del umbral (0 = sin cambios). Común a PNG en luminosidad y JPEG. */
  contrast: number;
  /** 0 = sin limpieza; 1 suave (default); 2 media; 3 fuerte. Blur + islas + agujeros diminutos (+ mayoría 3×3 desde 2). */
  cleaning: RasterCleaning;
  /** Ramas terminales más cortas que esto (mm sobre el diseño final) se eliminan. */
  pruneMm: number;
  simplify: RasterSimplify;
  /** 0-100: intensidad del suavizado de los paths ya trazados. */
  smoothing: number;
}

export const DEFAULT_RASTER_SETTINGS: RasterSettings = {
  detectionMode: "auto",
  alphaThreshold: 128,
  threshold: null,
  invert: false,
  contrast: 0,
  cleaning: 1,
  pruneMm: 2,
  simplify: "medium",
  smoothing: 40,
};

export const RASTER_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  /** Lado máximo del archivo original. */
  maxDimension: 8192,
  /** Píxeles máximos del original (decodificado a RGBA ocupa 4 B/px). */
  maxPixels: 40_000_000,
  /** Lado mayor de la resolución de trabajo del skeleton (nunca se procesa la imagen original). */
  workingMaxPx: 1024,
  /** Si el recorte queda más chico que esto, se sube (bilinear sobre el campo, antes del umbral) hasta este lado. */
  workingMinPx: 320,
  maxUpscale: 4,
  /** Margen técnico alrededor del foreground al recortar (px de la imagen original, mínimo 2). */
  cropMarginFraction: 0.02,
  /** Más componentes que esto => imagen demasiado compleja (error). */
  maxComponents: 150,
  /** Más recorridos que esto => error. */
  maxPaths: 400,
  /** Aviso de complejidad. */
  warnComponents: 40,
  warnPaths: 120,
} as const;

/** Máscara binaria (0/1) en resolución de trabajo, con margen vacío alrededor. */
export interface RasterMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RasterStats {
  sourceWidth: number;
  sourceHeight: number;
  workingWidth: number;
  workingHeight: number;
  /** Modo efectivamente usado ("auto" ya resuelto). */
  modeUsed: "alpha" | "luminance";
  /** Umbral efectivo (alpha o luminancia). */
  thresholdUsed: number;
  /** true si el umbral de luminosidad salió de Otsu. */
  thresholdAuto: boolean;
  components: number;
  skeletonPixels: number;
  /** NeonPaths finales. */
  paths: number;
  /** Nodos de grado >= 3 (bifurcaciones). */
  junctions: number;
  /** Extremos libres (grado 1). */
  endpoints: number;
  /** Lazos independientes del recorrido (número ciclomático del grafo: una "O" = 1, un "8" = 2), sin importar cómo se partan en paths. */
  loops: number;
  prunedBranches: number;
  /** mm por píxel de trabajo (diseño final). */
  mmPerPx: number;
  ms: number;
}

/** Lo que necesita el panel de preview 2D: la máscara y los paths en coordenadas de la máscara (Y hacia abajo). */
export interface RasterPreview {
  mask: RasterMask;
  pathsPx: Point2D[][];
  closed: boolean[];
}

export interface RasterConversion {
  /** Paths en mm, listos para el motor del canal (createNeonGeometry). */
  paths: NeonPath[];
  issues: NeonIssue[];
  preview: RasterPreview;
  stats: RasterStats;
}
