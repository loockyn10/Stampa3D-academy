import { REFERENCE_DIFFUSER } from "@/lib/maker/lamps/holder/references";
import { STANDARD_ADHESION, STANDARD_CABLE, STANDARD_HOLDER, STANDARD_INSERT_FIT, STANDARD_THREAD } from "@/lib/maker/lamps/standard";
import type { LampAdhesionDef, LampBaseDef, LampBulbDef, LampCableDef, LampDefinition, LampDoubleWallDef, LampHolderDef, LampInsertDef, LampInsertProfileTop, LampInsertStyle, LampOpenworkDef, LampShadeDef, LampThreadDef } from "@/lib/maker/lamps/types";

/**
 * Valores iniciales. Las medidas del portalámparas y de la bombilla son MARCADORES DE POSICIÓN (`holder.measured =
 * false`): no corresponden a ningún componente verificado. Hay que medir el portalámparas real antes de imprimir.
 * La interfaz roscada (`DEFAULT_THREAD`) es propia de StampaMaker y es la misma para cualquier pantalla.
 */
export const DEFAULT_SHADE: LampShadeDef = {
  family: "spiral",
  heightMm: 180,
  bottomDiameterMm: 120,
  topDiameterMm: 140,
  profile: "barrel",
  profileAmountPct: 30,
  waves: 9,
  amplitudeMm: 6,
  twistDeg: 240,
  verticalFrequency: 0,
  patternIntensityPct: 0,
  organicPct: 0,
  seed: 1,
  wallMm: 1.2,
  collarHeightMm: 12,
};

/**
 * Pantalla calada inicial: diamante clásico. La altura y los diámetros inferior/superior NO están acá: se comparten con la
 * pantalla sólida (`DEFAULT_SHADE`), así alternar entre tipos conserva las dimensiones.
 */
export const DEFAULT_OPENWORK: LampOpenworkDef = {
  pattern: "diamond",
  maxDiameterMm: 140,
  bulgePositionPct: 50,
  curvaturePct: 40,
  waistPct: 0,
  organicPct: 0,
  seed: 1,
  twistDeg: 0,
  stripWidthMm: 4,
  depthMm: 2.4,
  bottomRingMm: 10,
  topRingMm: 8,
  topFinish: "ring",
  variationPct: 0,
  variationCycles: 1,
  divisions: 12,
  inclinationDeg: 55,
  phaseDeg: 0,
  bands: 6,
  turns: 1.5,
  connectors: 0,
  connectorWidthMm: 3,
  diffuserFit: "diameter",
  diffuserDiameterMm: 70,
  diffuserClearanceMm: 1,
  diffuserTopGapMm: 6,
};

/**
 * Pantalla de doble pared inicial. Los diámetros de los extremos de la pared exterior y la altura se comparten con las otras pantallas
 * (`DEFAULT_SHADE`): al elegir «Doble pared» se llevan al mínimo que respeta la separación (`fitDoubleWallEnds`). Valores de partida
 * pensados para la base E27 de referencia: la abertura central deja pasar un difusor de ≈ Ø72 mm.
 */
export const DEFAULT_DOUBLE_WALL_LAMP: LampDoubleWallDef = {
  maxDiameterMm: 170,
  bulgePositionPct: 50,
  curvaturePct: 40,
  flutes: 24,
  fluteAmplitudeMm: 3,
  twistDeg: 0,
  innerBottomDiameterMm: 90,
  innerTopDiameterMm: 90,
  innerWaistPct: 25,
  innerWaistPositionPct: 50,
  innerCurvaturePct: 30,
  innerOrganicPct: 0,
  innerSeed: 1,
  minGapMm: 20,
  wallMm: 1.2,
  floorMm: 2.4,
  roofHeightMm: 24,
  roofCapMm: 2.4,
  topGapMm: 1.2,
  chamber: "closed",
  fabrication: "conventional",
  diffuserFit: "rings",
  diffuserClearanceMm: 1,
};

/**
 * Inserto inicial: familia «ondulado» con amplitud 0 = el cilindro liso abierto Ø65 de la lámpara de referencia (con
 * lengüetas). Los parámetros de las otras familias quedan en sus valores iniciales para que cambiar de estilo parta de
 * valores razonables (`INSERT_STYLE_INITIAL`).
 */
export const DEFAULT_INSERT: LampInsertDef = {
  enabled: true,
  style: "wavy",
  diameterMm: 65.135,
  heightMm: null,
  heightPct: 85,
  thicknessMm: STANDARD_INSERT_FIT.thicknessMm,
  clearanceMm: STANDARD_INSERT_FIT.clearanceMm,
  seatDepthMm: STANDARD_INSERT_FIT.seatDepthMm,
  minBulbGapMm: STANDARD_INSERT_FIT.minBulbGapMm,
  // Los difusores NO llevan lengüetas superiores (siempre false; ver `normalizeLampDefinition` y layout.ts). El campo existe solo por compatibilidad del código SL1.
  tabs: false,
  capThicknessMm: 1.6,
  dropClosureMm: 50,
  dropCurvaturePct: 70,
  dropTipRadiusMm: 10,
  waves: 12,
  amplitudeMm: 0,
  twistDeg: 0,
  verticalFrequency: 0,
  wavyTop: "open",
  profileWidthMm: 67.7,
  profileTopDiameterMm: 24.3,
  profileCurvaturePct: 45,
  profileWaistPct: 45,
  profileWaistPositionPct: 50,
  profileTop: "open",
  previewColor: "#e5483b",
};

/** Parámetros iniciales propios de cada familia: se aplican al elegir el estilo (no tocan color, diámetro, espesor, holgura ni altura). */
export const INSERT_STYLE_INITIAL: Record<LampInsertStyle, Partial<LampInsertDef>> = {
  flat: { capThicknessMm: 1.6, tabs: false },
  drop: { dropClosureMm: 50, dropCurvaturePct: 70, dropTipRadiusMm: 10, tabs: false },
  wavy: { waves: 12, amplitudeMm: 2.5, twistDeg: 90, verticalFrequency: 0, wavyTop: "open", tabs: false },
  // Difusores de perfil: medidas de partida (Ø) y terminación. Ancho = Ø máximo; Ø superior = estrechamiento (Mossglow) o apertura (Tulipán). Sin lengüetas.
  mossglow: { profileWidthMm: 67.7, profileTopDiameterMm: 24.3, profileCurvaturePct: 45, profileTop: "open", tabs: false },
  tulip: { profileTopDiameterMm: 80, profileCurvaturePct: 60, profileTop: "open", tabs: false },
  hourglass: { profileWidthMm: 70, profileWaistPct: 45, profileWaistPositionPct: 50, profileTop: "open", tabs: false },
  bell: { profileWidthMm: 74, profileCurvaturePct: 60, profileTop: "round", tabs: false },
};

export const INSERT_STYLE_LABELS: Record<LampInsertStyle, string> = { flat: "Plano", drop: "Gota", wavy: "Ondulado", mossglow: "Mossglow", tulip: "Tulipán", hourglass: "Reloj de arena", bell: "Campana" };

/** Cambia la familia del inserto conservando el color, el diámetro, el espesor y la altura; la pantalla exterior no se toca. */
export function applyInsertStyle(def: LampDefinition, style: LampInsertStyle): LampDefinition {
  return { ...def, insert: { ...def.insert, ...INSERT_STYLE_INITIAL[style], style } };
}

// Mecánica estándar: los valores probados físicamente viven en `standard.ts` (única fuente); acá solo se toman.
export const DEFAULT_ADHESION: LampAdhesionDef = { ...STANDARD_ADHESION };

export const DEFAULT_THREAD: LampThreadDef = { ...STANDARD_THREAD };

export const DEFAULT_BASE: LampBaseDef = {
  diameterMm: null,
};

export const DEFAULT_HOLDER: LampHolderDef = { ...STANDARD_HOLDER };

/** Marcador de posición del motor (compatibilidad de lectura de diseños anteriores); los diseños nuevos del editor usan `STANDARD_BULB` (standard.ts). */
export const DEFAULT_BULB: LampBulbDef = { diameterMm: 60, heightAboveHolderMm: 85 };
export const DEFAULT_CABLE: LampCableDef = { ...STANDARD_CABLE };

export const DEFAULT_LAMP: LampDefinition = {
  version: 2,
  shadeType: "solid",
  shade: DEFAULT_SHADE,
  openwork: DEFAULT_OPENWORK,
  doubleWall: DEFAULT_DOUBLE_WALL_LAMP,
  thread: DEFAULT_THREAD,
  insert: DEFAULT_INSERT,
  base: DEFAULT_BASE,
  adhesion: DEFAULT_ADHESION,
  holder: DEFAULT_HOLDER,
  bulb: DEFAULT_BULB,
  cable: DEFAULT_CABLE,
};

const FAMILIES = new Set(["wavy", "spiral", "organic"]);
const INSERT_STYLES = new Set(["flat", "drop", "wavy", "mossglow", "tulip", "hourglass", "bell"]);
const PROFILE_TOPS = new Set(["open", "flat", "round", "drop"]);
const PATTERNS = new Set(["diamond", "spiral"]);
const MOUNTS = new Set(["rings", "press", "threadBase2", "threadV6"]);
const PROFILES = new Set(["straight", "barrel", "waist", "bell", "tulip"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function numOrNull(v: unknown, fallback: number | null): number | null {
  if (v === null) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Ø 65 (nominal de la versión anterior) pasa a 65,135 (medido en diffuser.stl); cualquier otro valor se respeta tal cual. */
function standardizeInsertDiameter(v: number | null): number | null {
  return v === 65 ? REFERENCE_DIFFUSER.outerDiameterMm : v;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function color(v: unknown, fallback: string): string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}

/**
 * Lectura tolerante (códigos de diseño importados, versiones futuras): completa lo que falta con los valores por
 * defecto y descarta lo que no tiene el tipo esperado. NO recorta rangos: un valor fuera de rango debe aparecer como
 * error de validación, no corregirse en silencio.
 */
export function normalizeLampDefinition(input: unknown): LampDefinition {
  const root = isRecord(input) ? input : {};
  const s = isRecord(root.shade) ? root.shade : {};
  const o = isRecord(root.openwork) ? root.openwork : {};
  const dw = isRecord(root.doubleWall) ? root.doubleWall : {};
  const i = isRecord(root.insert) ? root.insert : {};
  const t = isRecord(root.thread) ? root.thread : {};
  const b = isRecord(root.base) ? root.base : {};
  const ad = isRecord(root.adhesion) ? root.adhesion : {};
  const h = isRecord(root.holder) ? root.holder : {};
  const bu = isRecord(root.bulb) ? root.bulb : {};
  const c = isRecord(root.cable) ? root.cable : {};
  return {
    version: 2,
    shadeType: root.shadeType === "openwork" ? "openwork" : root.shadeType === "double" ? "double" : "solid",
    doubleWall: {
      maxDiameterMm: num(dw.maxDiameterMm, DEFAULT_DOUBLE_WALL_LAMP.maxDiameterMm),
      bulgePositionPct: num(dw.bulgePositionPct, DEFAULT_DOUBLE_WALL_LAMP.bulgePositionPct),
      curvaturePct: num(dw.curvaturePct, DEFAULT_DOUBLE_WALL_LAMP.curvaturePct),
      flutes: num(dw.flutes, DEFAULT_DOUBLE_WALL_LAMP.flutes),
      fluteAmplitudeMm: num(dw.fluteAmplitudeMm, DEFAULT_DOUBLE_WALL_LAMP.fluteAmplitudeMm),
      twistDeg: num(dw.twistDeg, DEFAULT_DOUBLE_WALL_LAMP.twistDeg),
      innerBottomDiameterMm: num(dw.innerBottomDiameterMm, DEFAULT_DOUBLE_WALL_LAMP.innerBottomDiameterMm),
      innerTopDiameterMm: num(dw.innerTopDiameterMm, DEFAULT_DOUBLE_WALL_LAMP.innerTopDiameterMm),
      innerWaistPct: num(dw.innerWaistPct, DEFAULT_DOUBLE_WALL_LAMP.innerWaistPct),
      innerWaistPositionPct: num(dw.innerWaistPositionPct, DEFAULT_DOUBLE_WALL_LAMP.innerWaistPositionPct),
      innerCurvaturePct: num(dw.innerCurvaturePct, DEFAULT_DOUBLE_WALL_LAMP.innerCurvaturePct),
      innerOrganicPct: num(dw.innerOrganicPct, DEFAULT_DOUBLE_WALL_LAMP.innerOrganicPct),
      innerSeed: num(dw.innerSeed, DEFAULT_DOUBLE_WALL_LAMP.innerSeed),
      minGapMm: num(dw.minGapMm, DEFAULT_DOUBLE_WALL_LAMP.minGapMm),
      wallMm: num(dw.wallMm, DEFAULT_DOUBLE_WALL_LAMP.wallMm),
      floorMm: num(dw.floorMm, DEFAULT_DOUBLE_WALL_LAMP.floorMm),
      roofHeightMm: num(dw.roofHeightMm, DEFAULT_DOUBLE_WALL_LAMP.roofHeightMm),
      roofCapMm: num(dw.roofCapMm, DEFAULT_DOUBLE_WALL_LAMP.roofCapMm),
      topGapMm: num(dw.topGapMm, DEFAULT_DOUBLE_WALL_LAMP.topGapMm),
      chamber: dw.chamber === "open" ? "open" : "closed",
      fabrication: "conventional",
      diffuserFit: dw.diffuserFit === "manual" ? "manual" : "rings",
      diffuserClearanceMm: num(dw.diffuserClearanceMm, DEFAULT_DOUBLE_WALL_LAMP.diffuserClearanceMm),
    },
    openwork: {
      pattern: typeof o.pattern === "string" && PATTERNS.has(o.pattern) ? (o.pattern as LampOpenworkDef["pattern"]) : DEFAULT_OPENWORK.pattern,
      maxDiameterMm: num(o.maxDiameterMm, DEFAULT_OPENWORK.maxDiameterMm),
      bulgePositionPct: num(o.bulgePositionPct, DEFAULT_OPENWORK.bulgePositionPct),
      curvaturePct: num(o.curvaturePct, DEFAULT_OPENWORK.curvaturePct),
      waistPct: num(o.waistPct, DEFAULT_OPENWORK.waistPct),
      organicPct: num(o.organicPct, DEFAULT_OPENWORK.organicPct),
      seed: num(o.seed, DEFAULT_OPENWORK.seed),
      twistDeg: num(o.twistDeg, DEFAULT_OPENWORK.twistDeg),
      stripWidthMm: num(o.stripWidthMm, DEFAULT_OPENWORK.stripWidthMm),
      depthMm: num(o.depthMm, DEFAULT_OPENWORK.depthMm),
      bottomRingMm: num(o.bottomRingMm, DEFAULT_OPENWORK.bottomRingMm),
      topRingMm: num(o.topRingMm, DEFAULT_OPENWORK.topRingMm),
      topFinish: o.topFinish === "open" ? "open" : "ring",
      variationPct: num(o.variationPct, DEFAULT_OPENWORK.variationPct),
      variationCycles: num(o.variationCycles, DEFAULT_OPENWORK.variationCycles),
      divisions: num(o.divisions, DEFAULT_OPENWORK.divisions),
      inclinationDeg: num(o.inclinationDeg, DEFAULT_OPENWORK.inclinationDeg),
      phaseDeg: num(o.phaseDeg, DEFAULT_OPENWORK.phaseDeg),
      bands: num(o.bands, DEFAULT_OPENWORK.bands),
      turns: num(o.turns, DEFAULT_OPENWORK.turns),
      connectors: num(o.connectors, DEFAULT_OPENWORK.connectors),
      connectorWidthMm: num(o.connectorWidthMm, DEFAULT_OPENWORK.connectorWidthMm),
      // los diseños calados anteriores a la V6 no traen `diffuserFit` o traen "rings"/"manual": se leen como eran (según los anillos); solo un diseño sin parte calada parte del modo recomendado
      diffuserFit: o.diffuserFit === "manual" ? "manual" : o.diffuserFit === "diameter" ? "diameter" : isRecord(root.openwork) ? "rings" : DEFAULT_OPENWORK.diffuserFit,
      diffuserDiameterMm: num(o.diffuserDiameterMm, DEFAULT_OPENWORK.diffuserDiameterMm),
      diffuserClearanceMm: num(o.diffuserClearanceMm, DEFAULT_OPENWORK.diffuserClearanceMm),
      diffuserTopGapMm: num(o.diffuserTopGapMm, DEFAULT_OPENWORK.diffuserTopGapMm),
    },
    shade: {
      family: typeof s.family === "string" && FAMILIES.has(s.family) ? (s.family as LampShadeDef["family"]) : DEFAULT_SHADE.family,
      heightMm: num(s.heightMm, DEFAULT_SHADE.heightMm),
      bottomDiameterMm: num(s.bottomDiameterMm, DEFAULT_SHADE.bottomDiameterMm),
      topDiameterMm: num(s.topDiameterMm, DEFAULT_SHADE.topDiameterMm),
      profile: typeof s.profile === "string" && PROFILES.has(s.profile) ? (s.profile as LampShadeDef["profile"]) : DEFAULT_SHADE.profile,
      profileAmountPct: num(s.profileAmountPct, DEFAULT_SHADE.profileAmountPct),
      waves: num(s.waves, DEFAULT_SHADE.waves),
      amplitudeMm: num(s.amplitudeMm, DEFAULT_SHADE.amplitudeMm),
      twistDeg: num(s.twistDeg, DEFAULT_SHADE.twistDeg),
      verticalFrequency: num(s.verticalFrequency, DEFAULT_SHADE.verticalFrequency),
      patternIntensityPct: num(s.patternIntensityPct, DEFAULT_SHADE.patternIntensityPct),
      organicPct: num(s.organicPct, DEFAULT_SHADE.organicPct),
      seed: num(s.seed, DEFAULT_SHADE.seed),
      wallMm: num(s.wallMm, DEFAULT_SHADE.wallMm),
      collarHeightMm: num(s.collarHeightMm, DEFAULT_SHADE.collarHeightMm),
    },
    thread: {
      connection: t.connection === "collar" ? "collar" : "integrated",
      majorDiameterMm: num(t.majorDiameterMm, DEFAULT_THREAD.majorDiameterMm),
      pitchMm: num(t.pitchMm, DEFAULT_THREAD.pitchMm),
      starts: num(t.starts, DEFAULT_THREAD.starts),
      engagementMm: num(t.engagementMm, DEFAULT_THREAD.engagementMm),
      clearanceMm: num(t.clearanceMm, DEFAULT_THREAD.clearanceMm),
      coreWallMm: num(t.coreWallMm, DEFAULT_THREAD.coreWallMm),
    },
    insert: {
      enabled: bool(i.enabled, DEFAULT_INSERT.enabled),
      style: typeof i.style === "string" && INSERT_STYLES.has(i.style) ? (i.style as LampInsertStyle) : DEFAULT_INSERT.style,
      // Estandarización del encastre: los diseños anteriores guardaban el Ø nominal 65 (el de la lámpara de referencia); el difusor de referencia mide 65,135 (diffuser.stl).
      diameterMm: standardizeInsertDiameter(numOrNull(i.diameterMm, DEFAULT_INSERT.diameterMm)),
      heightMm: numOrNull(i.heightMm, DEFAULT_INSERT.heightMm),
      heightPct: num(i.heightPct, DEFAULT_INSERT.heightPct),
      thicknessMm: num(i.thicknessMm, DEFAULT_INSERT.thicknessMm),
      clearanceMm: num(i.clearanceMm, DEFAULT_INSERT.clearanceMm),
      minBulbGapMm: num(i.minBulbGapMm, DEFAULT_INSERT.minBulbGapMm),
      // sin lengüetas, siempre: un diseño anterior que las traía se lee SIN ellas (el encastre inferior no cambia)
      tabs: false,
      seatDepthMm: num(i.seatDepthMm, DEFAULT_INSERT.seatDepthMm),
      capThicknessMm: num(i.capThicknessMm, DEFAULT_INSERT.capThicknessMm),
      dropClosureMm: num(i.dropClosureMm, DEFAULT_INSERT.dropClosureMm),
      dropCurvaturePct: num(i.dropCurvaturePct, DEFAULT_INSERT.dropCurvaturePct),
      dropTipRadiusMm: num(i.dropTipRadiusMm, DEFAULT_INSERT.dropTipRadiusMm),
      waves: num(i.waves, DEFAULT_INSERT.waves),
      amplitudeMm: num(i.amplitudeMm, DEFAULT_INSERT.amplitudeMm),
      twistDeg: num(i.twistDeg, DEFAULT_INSERT.twistDeg),
      verticalFrequency: num(i.verticalFrequency, DEFAULT_INSERT.verticalFrequency),
      wavyTop: i.wavyTop === "flat" ? "flat" : "open",
      // Diseños guardados antes de los difusores de perfil: sin estos campos se leen con sus valores iniciales (el estilo guardado no cambia).
      profileWidthMm: num(i.profileWidthMm, DEFAULT_INSERT.profileWidthMm),
      profileTopDiameterMm: num(i.profileTopDiameterMm, DEFAULT_INSERT.profileTopDiameterMm),
      profileCurvaturePct: num(i.profileCurvaturePct, DEFAULT_INSERT.profileCurvaturePct),
      profileWaistPct: num(i.profileWaistPct, DEFAULT_INSERT.profileWaistPct),
      profileWaistPositionPct: num(i.profileWaistPositionPct, DEFAULT_INSERT.profileWaistPositionPct),
      profileTop: typeof i.profileTop === "string" && PROFILE_TOPS.has(i.profileTop) ? (i.profileTop as LampInsertProfileTop) : DEFAULT_INSERT.profileTop,
      previewColor: color(i.previewColor, DEFAULT_INSERT.previewColor),
    },
    base: {
      diameterMm: numOrNull(b.diameterMm, DEFAULT_BASE.diameterMm),
    },
    adhesion: {
      enabled: bool(ad.enabled, DEFAULT_ADHESION.enabled),
      widthMm: num(ad.widthMm, DEFAULT_ADHESION.widthMm),
      heightMm: num(ad.heightMm, DEFAULT_ADHESION.heightMm),
    },
    holder: {
      mount: typeof h.mount === "string" && MOUNTS.has(h.mount) ? (h.mount as LampHolderDef["mount"]) : DEFAULT_HOLDER.mount,
      pressDepthMm: num(h.pressDepthMm, DEFAULT_HOLDER.pressDepthMm),
      measured: bool(h.measured, DEFAULT_HOLDER.measured),
      boreDiameterMm: num(h.boreDiameterMm, DEFAULT_HOLDER.boreDiameterMm),
      ringsDiameterMm: num(h.ringsDiameterMm, DEFAULT_HOLDER.ringsDiameterMm),
      ringsClearanceMm: num(h.ringsClearanceMm, DEFAULT_HOLDER.ringsClearanceMm),
      ringsRecessDepthMm: num(h.ringsRecessDepthMm, DEFAULT_HOLDER.ringsRecessDepthMm),
      seatHeightMm: num(h.seatHeightMm, DEFAULT_HOLDER.seatHeightMm),
      bodyDiameterMm: num(h.bodyDiameterMm, DEFAULT_HOLDER.bodyDiameterMm),
      heightMm: num(h.heightMm, DEFAULT_HOLDER.heightMm),
    },
    bulb: {
      diameterMm: num(bu.diameterMm, DEFAULT_BULB.diameterMm),
      heightAboveHolderMm: num(bu.heightAboveHolderMm, DEFAULT_BULB.heightAboveHolderMm),
    },
    cable: { diameterMm: num(c.diameterMm, DEFAULT_CABLE.diameterMm), tieAnchor: bool(c.tieAnchor, DEFAULT_CABLE.tieAnchor) },
  };
}
