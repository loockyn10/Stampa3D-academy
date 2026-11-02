import type { LampAdhesionDef, LampBaseDef, LampBulbDef, LampCableDef, LampDefinition, LampDoubleWallDef, LampHolderDef, LampInsertDef, LampInsertStyle, LampOpenworkDef, LampShadeDef, LampThreadDef } from "@/lib/maker/lamps/types";

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
  diffuserFit: "rings",
  diffuserClearanceMm: 1,
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
  diameterMm: 65,
  heightMm: null,
  heightPct: 85,
  thicknessMm: 0.8,
  clearanceMm: 0.35,
  seatDepthMm: 10,
  minBulbGapMm: 1,
  tabs: true,
  capThicknessMm: 1.6,
  dropClosureMm: 50,
  dropCurvaturePct: 70,
  dropTipRadiusMm: 10,
  waves: 12,
  amplitudeMm: 0,
  twistDeg: 0,
  verticalFrequency: 0,
  wavyTop: "open",
  previewColor: "#e5483b",
};

/** Parámetros iniciales propios de cada familia: se aplican al elegir el estilo (no tocan color, diámetro, espesor, holgura ni altura). */
export const INSERT_STYLE_INITIAL: Record<LampInsertStyle, Partial<LampInsertDef>> = {
  flat: { capThicknessMm: 1.6, tabs: false },
  drop: { dropClosureMm: 50, dropCurvaturePct: 70, dropTipRadiusMm: 10, tabs: false },
  wavy: { waves: 12, amplitudeMm: 2.5, twistDeg: 90, verticalFrequency: 0, wavyTop: "open", tabs: true },
};

export const INSERT_STYLE_LABELS: Record<LampInsertStyle, string> = { flat: "Plano", drop: "Gota", wavy: "Ondulado" };

/** Cambia la familia del inserto conservando el color, el diámetro, el espesor y la altura; la pantalla exterior no se toca. */
export function applyInsertStyle(def: LampDefinition, style: LampInsertStyle): LampDefinition {
  return { ...def, insert: { ...def.insert, ...INSERT_STYLE_INITIAL[style], style } };
}

export const DEFAULT_ADHESION: LampAdhesionDef = { enabled: true, widthMm: 3, heightMm: 0.4 };

export const DEFAULT_THREAD: LampThreadDef = {
  connection: "integrated",
  majorDiameterMm: 96,
  pitchMm: 5,
  starts: 2,
  engagementMm: 15,
  clearanceMm: 0.4,
  coreWallMm: 3,
};

export const DEFAULT_BASE: LampBaseDef = {
  diameterMm: null,
};

export const DEFAULT_HOLDER: LampHolderDef = {
  measured: false,
  boreDiameterMm: 42,
  ringsDiameterMm: 58,
  ringsClearanceMm: 0.9,
  ringsRecessDepthMm: 5.15,
  seatHeightMm: 31.4,
  bodyDiameterMm: 40,
  heightMm: 55,
};

export const DEFAULT_BULB: LampBulbDef = { diameterMm: 60, heightAboveHolderMm: 85 };
export const DEFAULT_CABLE: LampCableDef = { diameterMm: 7, tieAnchor: true };

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
const INSERT_STYLES = new Set(["flat", "drop", "wavy"]);
const PATTERNS = new Set(["diamond", "spiral"]);
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
      diffuserFit: o.diffuserFit === "manual" ? "manual" : "rings",
      diffuserClearanceMm: num(o.diffuserClearanceMm, DEFAULT_OPENWORK.diffuserClearanceMm),
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
      diameterMm: numOrNull(i.diameterMm, DEFAULT_INSERT.diameterMm),
      heightMm: numOrNull(i.heightMm, DEFAULT_INSERT.heightMm),
      heightPct: num(i.heightPct, DEFAULT_INSERT.heightPct),
      thicknessMm: num(i.thicknessMm, DEFAULT_INSERT.thicknessMm),
      clearanceMm: num(i.clearanceMm, DEFAULT_INSERT.clearanceMm),
      minBulbGapMm: num(i.minBulbGapMm, DEFAULT_INSERT.minBulbGapMm),
      tabs: bool(i.tabs, DEFAULT_INSERT.tabs),
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
