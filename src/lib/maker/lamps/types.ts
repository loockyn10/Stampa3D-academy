import type { LetterGeometryResult } from "@/lib/maker/types";
import type { IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * Lámparas E27 (Stampa Maker). `LampDefinition` es la ÚNICA fuente de verdad: la UI y los presets solo editan este
 * objeto; la geometría sale exclusivamente de `createLamp`. Tres piezas independientes: pantalla, inserto de color y
 * base para un portalámparas E27 comercial (que NUNCA se imprime).
 */
export type LampFamily = "wavy" | "spiral" | "organic";
export type LampProfile = "straight" | "barrel" | "waist" | "bell" | "tulip";

export interface LampShadeDef {
  family: LampFamily;
  heightMm: number;
  /** Diámetro exterior del collar recto inferior (donde apoya en la base) y de arranque del perfil. */
  bottomDiameterMm: number;
  topDiameterMm: number;
  profile: LampProfile;
  /** 0–100: cuánto se aparta el perfil de la recta (abombado/cintura, exponente de la campana, mezcla S del tulipán). */
  profileAmountPct: number;
  /** Cantidad de ondas alrededor (entero). */
  waves: number;
  /** Desvío radial máximo de la onda (mm). */
  amplitudeMm: number;
  /** Giro total de las ondas entre el collar y el borde superior (grados, con signo). */
  twistDeg: number;
  /** Ciclos de variación vertical de la amplitud a lo alto de la pantalla (0 = ninguna). */
  verticalFrequency: number;
  /** 0–100: cuánto modula la variación vertical a las ondas (0 = ondas puras). */
  patternIntensityPct: number;
  /** 0–100: peso de los términos orgánicos (solo familia "organic"). */
  organicPct: number;
  /** Semilla reproducible de los términos orgánicos. */
  seed: number;
  /** Espesor del sólido (mm). En modo vaso la pared real es el ancho de extrusión del laminador. */
  wallMm: number;
  /** Altura del collar recto inferior (mm): el anillo circular que encastra con la base. */
  collarHeightMm: number;
}

export interface LampInsertDef {
  enabled: boolean;
  /** null = automático: el mayor diámetro exterior que entra en la pantalla con la holgura elegida. */
  diameterMm: number | null;
  /** Altura del inserto como % de la altura disponible (desde el asiento de la base hasta el borde de la pantalla). */
  heightPct: number;
  thicknessMm: number;
  /** Holgura de montaje por lado (mm) entre inserto y pantalla / ranura de la base. */
  clearanceMm: number;
  /** Separación radial MÍNIMA de diseño entre la bombilla (o el cuerpo del portalámparas) y el inserto/pantalla. No es una distancia segura. */
  minBulbGapMm: number;
  /** Dos lengüetas exteriores en el borde superior (para extraer el inserto). Obliga a impresión convencional. */
  tabs: boolean;
  /** Muescas de ventilación en el borde inferior (0 = sin muescas). Obliga a impresión convencional. */
  ventNotches: number;
  /** Color de la VISTA PREVIA (#rrggbb). No es geometría ni simula la luz real. */
  previewColor: string;
}

export interface LampBaseDef {
  /** null = automático (según la pantalla). */
  diameterMm: number | null;
  heightMm: number;
  /** Luz de ventilación entre el borde de la pantalla y la cubierta de la base (mm). */
  ventGapMm: number;
}

/**
 * Medidas del portalámparas E27 comercial. E27 describe la rosca de la bombilla, NO las dimensiones exteriores del
 * portalámparas: estos valores son marcadores de posición hasta que se midan en el componente real (`measured`).
 */
export interface LampHolderDef {
  /** true = el usuario cargó medidas de su portalámparas real. false = geometría PRELIMINAR NO VALIDADA. */
  measured: boolean;
  /** Diámetro del cuerpo/faldón que apoya sobre la base. */
  bodyDiameterMm: number;
  /** Desde la cara de apoyo hasta el borde superior del portalámparas (donde entra la bombilla). */
  heightMm: number;
  /** Diámetro de la espiga roscada de fijación (nominal, p.ej. M10). */
  threadDiameterMm: number;
  /** Alojamiento inferior para la tuerca / bornes. */
  nutRecessDiameterMm: number;
  nutRecessDepthMm: number;
}

export interface LampBulbDef {
  diameterMm: number;
  /** Alto de la bombilla por encima del borde superior del portalámparas. */
  heightAboveHolderMm: number;
}

export interface LampCableDef {
  diameterMm: number;
}

export interface LampDefinition {
  version: 1;
  shade: LampShadeDef;
  insert: LampInsertDef;
  base: LampBaseDef;
  holder: LampHolderDef;
  bulb: LampBulbDef;
  cable: LampCableDef;
}

export type LampIssueSeverity = "error" | "warning";

export interface LampIssue {
  code: string;
  message: string;
  /** Campo de la definición al que apunta (`shade.waves`, `insert.thicknessMm`...). */
  field?: string;
}

/** Verificación de los prerrequisitos GEOMÉTRICOS del modo vaso (spiral vase). No reemplaza abrir el STL en el laminador. */
export interface LampVaseReport {
  ready: boolean;
  /** Ángulo máximo de la pared respecto de la vertical (0° = pared vertical). */
  maxOverhangDeg: number;
  reasons: string[];
}

export interface LampPartMetrics {
  triangleCount: number;
  volumeCm3: number;
  /** Cerrada + manifold + orientada, sin triángulos degenerados. */
  watertight: boolean;
  boundingBox: { width: number; depth: number; height: number };
}

export interface LampFitReport {
  /** Z (ensamblado, base en 0) del asiento de la pantalla, del inserto y del borde superior. */
  shadeBottomZ: number;
  shadeTopZ: number;
  insertBottomZ: number | null;
  insertTopZ: number | null;
  holderTopZ: number;
  bulbTopZ: number;
  /** Diámetro exterior efectivo del inserto (mm) y si salió del modo automático. */
  insertOuterDiameterMm: number | null;
  insertInnerDiameterMm: number | null;
  insertAuto: boolean;
  /** Radio libre mínimo de la pantalla en la altura del inserto (para explicar por qué no entra). */
  shadeClearRadiusMm: number | null;
  /** Radio interior mínimo necesario para respetar la separación de diseño a la bombilla. */
  requiredInsertInnerRadiusMm: number;
  /** Separación radial real entre el inserto y la bombilla/portalámparas. */
  insertBulbGapMm: number | null;
  /** Diámetro de la base (efectivo). */
  baseDiameterMm: number;
}

export interface LampMetrics {
  totalHeightMm: number;
  maxDiameterMm: number;
  shade: LampPartMetrics & { vase: LampVaseReport; maxTiltDeg: number; minRidgeRadiusMm: number | null };
  insert: (LampPartMetrics & { vaseCapable: boolean }) | null;
  base: LampPartMetrics;
  totalTriangles: number;
  /** Tiempo de generación (ms) de esta llamada (0 si todas las piezas salieron del cache). */
  generationMs: number;
  fit: LampFitReport;
}

export interface LampResult {
  /** Piezas listas para MakerViewport / Vista Cama / STL: base ("body"), inserto ("lampInsert") y pantalla ("lampShade"). null si hay errores. */
  geometry: LetterGeometryResult | null;
  /** Mallas indexadas por pieza (tests y chequeos topológicos). */
  indexed: { base: IndexedMesh; insert: IndexedMesh | null; shade: IndexedMesh } | null;
  metrics: LampMetrics | null;
  errors: LampIssue[];
  warnings: LampIssue[];
}

/** Límites de cada campo numérico: los usa la validación y la UI. */
export interface FieldLimit {
  min: number;
  max: number;
  integer?: boolean;
  label: string;
}

export const LAMP_LIMITS = {
  "shade.heightMm": { min: 60, max: 400, label: "Altura de la pantalla" },
  "shade.bottomDiameterMm": { min: 70, max: 300, label: "Diámetro inferior" },
  "shade.topDiameterMm": { min: 40, max: 300, label: "Diámetro superior" },
  "shade.profileAmountPct": { min: 0, max: 100, label: "Intensidad del perfil" },
  "shade.waves": { min: 2, max: 32, integer: true, label: "Ondas" },
  "shade.amplitudeMm": { min: 0, max: 25, label: "Amplitud" },
  "shade.twistDeg": { min: -1440, max: 1440, label: "Torsión" },
  "shade.verticalFrequency": { min: 0, max: 8, label: "Frecuencia vertical" },
  "shade.patternIntensityPct": { min: 0, max: 100, label: "Intensidad del patrón" },
  "shade.organicPct": { min: 0, max: 100, label: "Variación orgánica" },
  "shade.seed": { min: 0, max: 4294967295, integer: true, label: "Semilla" },
  "shade.wallMm": { min: 0.6, max: 3, label: "Espesor de pared" },
  "shade.collarHeightMm": { min: 6, max: 40, label: "Altura del collar" },
  "insert.heightPct": { min: 30, max: 95, label: "Altura del inserto" },
  "insert.thicknessMm": { min: 0.4, max: 3, label: "Espesor del inserto" },
  "insert.clearanceMm": { min: 0.3, max: 2, label: "Holgura de montaje" },
  "insert.minBulbGapMm": { min: 5, max: 40, label: "Separación mínima a la bombilla" },
  "insert.ventNotches": { min: 0, max: 12, integer: true, label: "Muescas de ventilación" },
  "base.heightMm": { min: 20, max: 80, label: "Altura de la base" },
  "base.ventGapMm": { min: 2, max: 8, label: "Luz de ventilación" },
  "holder.bodyDiameterMm": { min: 20, max: 80, label: "Diámetro del portalámparas" },
  "holder.heightMm": { min: 20, max: 120, label: "Altura del portalámparas" },
  "holder.threadDiameterMm": { min: 6, max: 20, label: "Diámetro de la espiga" },
  "holder.nutRecessDiameterMm": { min: 14, max: 50, label: "Alojamiento de la tuerca" },
  "holder.nutRecessDepthMm": { min: 4, max: 20, label: "Profundidad del alojamiento" },
  "bulb.diameterMm": { min: 30, max: 120, label: "Diámetro de la bombilla" },
  "bulb.heightAboveHolderMm": { min: 40, max: 200, label: "Alto de la bombilla sobre el portalámparas" },
  "cable.diameterMm": { min: 3, max: 12, label: "Diámetro del cable" },
} as const satisfies Record<string, FieldLimit>;

export type LampLimitKey = keyof typeof LAMP_LIMITS;

/** Constantes geométricas fijas del sistema de encastre (no son parámetros del usuario). */
export const LAMP_GEOMETRY = {
  /** Profundidad de la ranura de la base donde apoya el borde inferior del inserto. */
  grooveDepthMm: 3,
  /** Profundidad del asiento del portalámparas en la cara superior de la base. */
  holderRecessDepthMm: 2,
  /** Holgura radial (por lado) del asiento respecto del cuerpo del portalámparas. */
  holderFitClearanceMm: 0.5,
  /** Holgura radial entre el collar de la pantalla y el aro de centrado de la base (medida sobre el diámetro EXTERIOR de la pantalla: vale también en modo vaso). */
  shadeFitClearanceMm: 0.4,
  lipWidthMm: 3,
  lipHeightMm: 8,
  padArcs: 6,
  padArcDeg: 38,
  tabLengthMm: 7,
  tabThicknessMm: 2.4,
  tabArcMm: 18,
  /** Altura libre de las muescas de ventilación sobre la cubierta de la base. */
  notchWindowMm: 6,
  /** Piso GEOMÉTRICO anti-contacto entre inserto/pantalla y la bombilla. No es una distancia térmicamente segura. */
  bulbGapFloorMm: 5,
  /** Distancia mínima del borde superior del inserto al de la pantalla. */
  insertTopMarginMm: 4,
  /** Material mínimo de la base sobre las cavidades inferiores. */
  baseMinRoofMm: 8,
  /** Pendiente máxima (grados respecto de la vertical) para declarar la pantalla compatible con modo vaso. */
  vaseMaxOverhangDeg: 45,
  /** Pendiente a partir de la cual la geometría se considera degenerada para impresión (bloquea). */
  hardMaxTiltDeg: 70,
  /** Triángulos máximos de la pantalla (presupuesto de malla). */
  maxShadeTriangles: 110_000,
} as const;
