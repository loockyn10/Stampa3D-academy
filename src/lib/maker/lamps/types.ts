import type { LetterGeometryResult } from "@/lib/maker/types";
import type { IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * Lámparas E27 (Stampa Maker). `LampDefinition` es la ÚNICA fuente de verdad: la UI y los presets solo editan este
 * objeto; la geometría sale exclusivamente de `createLamp`. Piezas independientes: pantalla (con cuello roscado macho,
 * o lisa + collar roscado para modo vaso), inserto de color y base con rosca hembra y alojamiento para un portalámparas
 * E27 comercial (que NUNCA se imprime). La interfaz roscada (`thread`) es independiente de la decoración de la pantalla.
 */
export type LampFamily = "wavy" | "spiral" | "organic";
export type LampProfile = "straight" | "barrel" | "waist" | "bell" | "tulip";

export interface LampShadeDef {
  family: LampFamily;
  /** Altura de la parte decorativa (sobre el cuello roscado y la transición de 45°). */
  heightMm: number;
  /** Diámetro exterior del tramo recto inferior de la parte decorativa (arranque del perfil). Debe ser mayor que la raíz de la rosca. */
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
  /** Altura del tramo recto inferior (mm): un anillo circular exacto antes de que nazca la ondulación (en modo collar es el que entra al encastre). */
  collarHeightMm: number;
}

export interface LampInsertDef {
  enabled: boolean;
  /** null = automático: el mayor diámetro exterior que entra en la pantalla con la holgura elegida. */
  diameterMm: number | null;
  /** Altura del inserto como % de la altura disponible (desde el asiento de la base hasta el borde de la pantalla). */
  heightPct: number;
  thicknessMm: number;
  /** Holgura de montaje por lado (mm) entre inserto y pantalla / ranura de la base / cuello roscado. */
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

/**
 * Interfaz mecánica pantalla–base (rosca de StampaMaker, NO la rosca eléctrica E27 de la bombilla). Es estándar y
 * propia: cualquier pantalla que comparta estos valores encaja en cualquier base que los comparta. Cambiar ondas,
 * torsión o patrón no la modifica.
 */
export interface LampThreadDef {
  /** "integrated": el cuello roscado macho es parte de la pantalla (impresión convencional). "collar": la pantalla queda lisa (modo vaso posible) y un collar roscado aparte la une a la base. */
  connection: "integrated" | "collar";
  /** Diámetro exterior (cresta) de la rosca macho. */
  majorDiameterMm: number;
  /** Paso de cada filete (mm). El avance por vuelta es paso × entradas. */
  pitchMm: number;
  /** Cantidad de entradas (filetes en paralelo): más entradas = menos vueltas para cerrar. */
  starts: number;
  /** Longitud roscada del macho (incluye la entrada y la salida del filete). */
  engagementMm: number;
  /** Holgura radial entre la rosca macho y la hembra (mm). */
  clearanceMm: number;
  /** Espesor del cuello macho por debajo de la raíz de la rosca (mm). */
  coreWallMm: number;
}

export interface LampBaseDef {
  /** null = automático (rosca + pared). */
  diameterMm: number | null;
  /** Ventanas de ventilación al nivel del piso de la base (0 = sin ventanas). */
  ventSlots: number;
}

/**
 * Medidas del portalámparas E27 comercial. E27 describe la rosca de la bombilla, NO las dimensiones exteriores del
 * portalámparas: estos valores son marcadores de posición hasta que se midan en el componente real (`measured`).
 */
export interface LampHolderDef {
  /** true = el usuario cargó medidas de su portalámparas real. false = geometría PRELIMINAR NO VALIDADA. */
  measured: boolean;
  /** "stem": espiga hueca roscada con tuerca. "screws": brida con dos tornillos. */
  mount: "stem" | "screws";
  /** Diámetro MÁXIMO (circunscripto) del faldón/brida que apoya sobre la base. */
  bodyDiameterMm: number;
  /** Desde la cara de apoyo hasta el borde superior del portalámparas (donde entra la bombilla). */
  heightMm: number;
  /** Diámetro de la espiga roscada (p.ej. M10 = 10) o del tornillo (p.ej. M4 = 4). */
  fixingDiameterMm: number;
  /** Cuánto sobresale la espiga (o el tornillo) por debajo de la cara de apoyo. */
  fixingLengthMm: number;
  /** Tuerca: medida entre caras planas (M10 ≈ 17, M4 = 7). */
  nutAcrossFlatsMm: number;
  /** Tuerca: espesor. */
  nutThicknessMm: number;
  /** Solo "screws": distancia entre los ejes de los dos tornillos. */
  screwSpacingMm: number;
}

export interface LampBulbDef {
  diameterMm: number;
  /** Alto de la bombilla por encima del borde superior del portalámparas. */
  heightAboveHolderMm: number;
}

export interface LampCableDef {
  diameterMm: number;
  /** Ranuras para una abrazadera plástica (precinto) comercial que sujeta el cable: alivio de tensión. */
  tieAnchor: boolean;
}

export interface LampDefinition {
  version: 2;
  shade: LampShadeDef;
  thread: LampThreadDef;
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

/** Resumen de la interfaz roscada ya resuelta (todos los valores salen de la misma función que genera las mallas). */
export interface LampThreadReport {
  connection: "integrated" | "collar";
  majorDiameterMm: number;
  rootDiameterMm: number;
  boreDiameterMm: number;
  pitchMm: number;
  starts: number;
  leadMm: number;
  depthMm: number;
  /** Longitud roscada del macho (con entrada y salida del filete) y tramo de profundidad completa. */
  engagementMm: number;
  usefulEngagementMm: number;
  /** Vueltas desde que el filete toca hasta el tope. */
  turnsToSeat: number;
  radialClearanceMm: number;
  /** Holgura medida en la dirección normal al flanco (45°). */
  normalClearanceMm: number;
  /** Juego axial total entre flancos (macho flojo en la hembra). */
  axialPlayMm: number;
  femaleDepthMm: number;
  /** Ancho del anillo plano del cuello que apoya en el tope de la base. */
  stopFaceWidthMm: number;
  /** Altura de la transición de 45° entre el cuello y la parte decorativa. */
  flareHeightMm: number;
  /** Largo del cuello liso + roscado, medido desde el tope. */
  neckLengthMm: number;
  /** Material de la base alrededor de la rosca hembra (mm, radial). */
  baseWallMm: number;
}

/** Una cota del ensamblaje con su mínimo exigido (cuando lo hay). `status` compara contra el mínimo de DISEÑO, no contra uno térmico. */
export interface LampClearanceCheck {
  id: string;
  label: string;
  valueMm: number;
  minMm: number | null;
  status: "ok" | "warn" | "fail" | "info";
}

export interface LampFitReport {
  /** Z (ensamblado, base en 0) del tope de la rosca, de la parte decorativa, del inserto y del borde superior. */
  shadeBottomZ: number;
  /** Z donde arranca la parte decorativa (sobre el cuello y la transición). */
  decorBottomZ: number;
  shadeTopZ: number;
  insertBottomZ: number | null;
  insertTopZ: number | null;
  holderTopZ: number;
  bulbTopZ: number;
  /** Diámetro exterior efectivo del inserto (mm) y si salió del modo automático. */
  insertOuterDiameterMm: number | null;
  insertInnerDiameterMm: number | null;
  insertAuto: boolean;
  /** Radio libre mínimo (cuello, transición y pantalla) a la altura del inserto, para explicar por qué no entra. */
  shadeClearRadiusMm: number | null;
  /** Radio interior mínimo necesario para respetar la separación de diseño a la bombilla. */
  requiredInsertInnerRadiusMm: number;
  /** Separación radial real entre el inserto y la bombilla/portalámparas. */
  insertBulbGapMm: number | null;
  /** El inserto sale por la abertura superior sin desmontar la pantalla. */
  insertRemovableFromTop: boolean | null;
  /** Diámetro de la base (efectivo) y su altura total. */
  baseDiameterMm: number;
  baseHeightMm: number;
  /** Piso de la base y recorrido de la espiga hasta la tuerca. */
  floorTopZ: number;
  /** Espesor de material entre la cara de apoyo del portalámparas y el techo del alojamiento de la tuerca. */
  fixingWebMm: number;
  thread: LampThreadReport;
  clearances: LampClearanceCheck[];
}

export interface LampMetrics {
  totalHeightMm: number;
  maxDiameterMm: number;
  shade: LampPartMetrics & { vase: LampVaseReport; maxTiltDeg: number; minRidgeRadiusMm: number | null };
  insert: (LampPartMetrics & { vaseCapable: boolean }) | null;
  /** Collar roscado independiente (solo con conexión "collar"). */
  collar: LampPartMetrics | null;
  base: LampPartMetrics;
  totalTriangles: number;
  /** Tiempo de generación (ms) de esta llamada (0 si todas las piezas salieron del cache). */
  generationMs: number;
  fit: LampFitReport;
}

export interface LampResult {
  /** Piezas listas para MakerViewport / Vista Cama / STL: base ("body"), inserto ("lampInsert"), collar ("lampCollar") y pantalla ("lampShade"). null si hay errores. */
  geometry: LetterGeometryResult | null;
  /** Mallas indexadas por pieza (tests y chequeos topológicos). */
  indexed: { base: IndexedMesh; insert: IndexedMesh | null; collar: IndexedMesh | null; shade: IndexedMesh } | null;
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
  "shade.bottomDiameterMm": { min: 90, max: 300, label: "Diámetro inferior" },
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
  "shade.collarHeightMm": { min: 6, max: 40, label: "Altura del tramo recto" },
  "thread.majorDiameterMm": { min: 80, max: 200, label: "Diámetro de la rosca" },
  "thread.pitchMm": { min: 3, max: 8, label: "Paso de la rosca" },
  "thread.starts": { min: 1, max: 4, integer: true, label: "Entradas de la rosca" },
  "thread.engagementMm": { min: 8, max: 30, label: "Longitud roscada" },
  "thread.clearanceMm": { min: 0.2, max: 0.8, label: "Holgura de la rosca" },
  "thread.coreWallMm": { min: 2, max: 8, label: "Espesor del cuello" },
  "insert.heightPct": { min: 30, max: 95, label: "Altura del inserto" },
  "insert.thicknessMm": { min: 0.4, max: 3, label: "Espesor del inserto" },
  "insert.clearanceMm": { min: 0.3, max: 2, label: "Holgura de montaje" },
  "insert.minBulbGapMm": { min: 5, max: 40, label: "Separación mínima a la bombilla" },
  "insert.ventNotches": { min: 0, max: 12, integer: true, label: "Muescas de ventilación" },
  "base.ventSlots": { min: 0, max: 12, integer: true, label: "Ventanas de ventilación de la base" },
  "holder.bodyDiameterMm": { min: 20, max: 80, label: "Diámetro del portalámparas" },
  "holder.heightMm": { min: 20, max: 120, label: "Altura del portalámparas" },
  "holder.fixingDiameterMm": { min: 3, max: 20, label: "Diámetro de la espiga o del tornillo" },
  "holder.fixingLengthMm": { min: 4, max: 40, label: "Largo de la espiga o del tornillo bajo la cara de apoyo" },
  "holder.nutAcrossFlatsMm": { min: 5, max: 30, label: "Tuerca (entre caras)" },
  "holder.nutThicknessMm": { min: 2, max: 15, label: "Espesor de la tuerca" },
  "holder.screwSpacingMm": { min: 20, max: 70, label: "Separación entre tornillos" },
  "bulb.diameterMm": { min: 30, max: 120, label: "Diámetro de la bombilla" },
  "bulb.heightAboveHolderMm": { min: 40, max: 200, label: "Alto de la bombilla sobre el portalámparas" },
  "cable.diameterMm": { min: 3, max: 12, label: "Diámetro del cable" },
} as const satisfies Record<string, FieldLimit>;

export type LampLimitKey = keyof typeof LAMP_LIMITS;

/** Constantes geométricas fijas del sistema de encastre (no son parámetros del usuario). */
export const LAMP_GEOMETRY = {
  /** Profundidad de la ranura de la base donde apoya el borde inferior del inserto. */
  grooveDepthMm: 3,
  /** Profundidad del asiento del portalámparas en la cara superior del piso de la base. */
  holderSeatDepthMm: 2,
  /** Holgura radial (por lado) del asiento respecto del faldón del portalámparas. */
  holderFitClearanceMm: 0.5,
  /** Holgura radial extra de los agujeros de espiga/tornillo y del alojamiento hexagonal de la tuerca. */
  fixingHoleClearanceMm: 0.3,
  nutPocketClearanceMm: 0.3,
  /** La punta de la espiga queda este margen por encima de la mesa. */
  fixingTipMarginMm: 1.5,
  /** Espesor de material entre el apoyo del portalámparas y el techo del alojamiento de la tuerca (mín./máx.). */
  fixingWebMinMm: 2.5,
  fixingWebMaxMm: 6,

  // ---- Rosca de la interfaz pantalla–base
  /** Profundidad del filete como fracción del paso (flancos a 45°: el tramo axial de cada flanco = la profundidad). */
  threadDepthFrac: 0.32,
  /** Entrada del filete (rampa de profundidad) y salida, en múltiplos de la profundidad. */
  threadRampInDepths: 2,
  threadRampOutDepths: 1,
  /** La hembra se extiende este tramo más allá del filete macho. */
  threadFemaleRunoutMm: 1.5,
  /** Avellanado de entrada de la hembra (45°). */
  threadEntryChamferMm: 1.5,
  /** Filas por paso en la malla del macho y capas por paso en la hembra. */
  threadRowsPerPitch: 16,
  threadFemaleLayersPerPitch: 16,
  femaleSegments: 144,
  /** Tramo liso del cuello expuesto entre la cara superior de la base y la transición. */
  shadeBaseGapMm: 3,
  /** Pendiente de la transición cuello -> pantalla (respecto de la vertical). */
  flareDeg: 45,
  flareMinMm: 3,
  flareWarnMm: 40,

  // ---- Base
  baseOuterWallMm: 10,
  baseMinOuterWallMm: 6,
  /** Techo de material sobre las ventanas de ventilación (sostiene el tope de la rosca). */
  baseLedgeRoofMm: 5,
  ventSlotHeightMm: 6,
  ventSlotWidthMm: 14,
  /** Anclaje del precinto: ancho del fleje, espesor del fleje. */
  tieStrapWidthMm: 4.4,
  tieStrapThicknessMm: 1.8,

  // ---- Collar roscado independiente (modo vaso)
  socketWallMm: 2.4,
  /** Holgura radial entre el diámetro EXTERIOR de la pantalla y el pozo del collar (sin nervios). */
  socketClearanceMm: 0.4,
  socketFloorWidthMm: 3,
  socketRibs: 6,
  socketRibHeightMm: 0.6,
  socketRibArcDeg: 10,
  socketLeadInMm: 0.8,

  tabLengthMm: 7,
  tabThicknessMm: 2.4,
  tabArcMm: 18,
  /** Altura libre de las muescas de ventilación sobre la cubierta de la base. */
  notchWindowMm: 6,
  /** Piso GEOMÉTRICO anti-contacto entre inserto/pantalla y la bombilla. No es una distancia térmicamente segura. */
  bulbGapFloorMm: 5,
  /** Distancia mínima del borde superior del inserto al de la pantalla. */
  insertTopMarginMm: 4,
  /** Pendiente máxima (grados respecto de la vertical) para declarar la pantalla compatible con modo vaso. */
  vaseMaxOverhangDeg: 45,
  /** Pendiente a partir de la cual la geometría se considera degenerada para impresión (bloquea). */
  hardMaxTiltDeg: 70,
  /** Triángulos máximos de la parte decorativa de la pantalla (presupuesto de malla; el cuello roscado suma aparte). */
  maxShadeTriangles: 110_000,
} as const;
