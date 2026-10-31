import type { LampBaseDef, LampBulbDef, LampCableDef, LampDefinition, LampHolderDef, LampInsertDef, LampShadeDef } from "@/lib/maker/lamps/types";

/**
 * Valores iniciales. Las medidas del portalámparas y de la bombilla son MARCADORES DE POSICIÓN (`holder.measured =
 * false`): no corresponden a ningún componente verificado. Hay que medir el portalámparas real antes de imprimir.
 */
export const DEFAULT_SHADE: LampShadeDef = {
  family: "spiral",
  heightMm: 200,
  bottomDiameterMm: 130,
  topDiameterMm: 150,
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

export const DEFAULT_INSERT: LampInsertDef = {
  enabled: true,
  diameterMm: null,
  heightPct: 85,
  thicknessMm: 0.8,
  clearanceMm: 0.8,
  minBulbGapMm: 12,
  tabs: true,
  ventNotches: 6,
  previewColor: "#e5483b",
};

export const DEFAULT_BASE: LampBaseDef = {
  diameterMm: null,
  heightMm: 36,
  ventGapMm: 3,
};

export const DEFAULT_HOLDER: LampHolderDef = {
  measured: false,
  bodyDiameterMm: 45,
  heightMm: 55,
  threadDiameterMm: 10,
  nutRecessDiameterMm: 24,
  nutRecessDepthMm: 9,
};

export const DEFAULT_BULB: LampBulbDef = { diameterMm: 60, heightAboveHolderMm: 85 };
export const DEFAULT_CABLE: LampCableDef = { diameterMm: 7 };

export const DEFAULT_LAMP: LampDefinition = {
  version: 1,
  shade: DEFAULT_SHADE,
  insert: DEFAULT_INSERT,
  base: DEFAULT_BASE,
  holder: DEFAULT_HOLDER,
  bulb: DEFAULT_BULB,
  cable: DEFAULT_CABLE,
};

const FAMILIES = new Set(["wavy", "spiral", "organic"]);
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
  const i = isRecord(root.insert) ? root.insert : {};
  const b = isRecord(root.base) ? root.base : {};
  const h = isRecord(root.holder) ? root.holder : {};
  const bu = isRecord(root.bulb) ? root.bulb : {};
  const c = isRecord(root.cable) ? root.cable : {};
  return {
    version: 1,
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
    insert: {
      enabled: bool(i.enabled, DEFAULT_INSERT.enabled),
      diameterMm: numOrNull(i.diameterMm, DEFAULT_INSERT.diameterMm),
      heightPct: num(i.heightPct, DEFAULT_INSERT.heightPct),
      thicknessMm: num(i.thicknessMm, DEFAULT_INSERT.thicknessMm),
      clearanceMm: num(i.clearanceMm, DEFAULT_INSERT.clearanceMm),
      minBulbGapMm: num(i.minBulbGapMm, DEFAULT_INSERT.minBulbGapMm),
      tabs: bool(i.tabs, DEFAULT_INSERT.tabs),
      ventNotches: num(i.ventNotches, DEFAULT_INSERT.ventNotches),
      previewColor: color(i.previewColor, DEFAULT_INSERT.previewColor),
    },
    base: {
      diameterMm: numOrNull(b.diameterMm, DEFAULT_BASE.diameterMm),
      heightMm: num(b.heightMm, DEFAULT_BASE.heightMm),
      ventGapMm: num(b.ventGapMm, DEFAULT_BASE.ventGapMm),
    },
    holder: {
      measured: bool(h.measured, DEFAULT_HOLDER.measured),
      bodyDiameterMm: num(h.bodyDiameterMm, DEFAULT_HOLDER.bodyDiameterMm),
      heightMm: num(h.heightMm, DEFAULT_HOLDER.heightMm),
      threadDiameterMm: num(h.threadDiameterMm, DEFAULT_HOLDER.threadDiameterMm),
      nutRecessDiameterMm: num(h.nutRecessDiameterMm, DEFAULT_HOLDER.nutRecessDiameterMm),
      nutRecessDepthMm: num(h.nutRecessDepthMm, DEFAULT_HOLDER.nutRecessDepthMm),
    },
    bulb: {
      diameterMm: num(bu.diameterMm, DEFAULT_BULB.diameterMm),
      heightAboveHolderMm: num(bu.heightAboveHolderMm, DEFAULT_BULB.heightAboveHolderMm),
    },
    cable: { diameterMm: num(c.diameterMm, DEFAULT_CABLE.diameterMm) },
  };
}
