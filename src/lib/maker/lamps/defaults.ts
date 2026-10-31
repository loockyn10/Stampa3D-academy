import type { LampBaseDef, LampBulbDef, LampCableDef, LampDefinition, LampHolderDef, LampInsertDef, LampShadeDef, LampThreadDef } from "@/lib/maker/lamps/types";

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

export const DEFAULT_INSERT: LampInsertDef = {
  enabled: true,
  diameterMm: null,
  heightPct: 85,
  thicknessMm: 0.8,
  clearanceMm: 0.8,
  minBulbGapMm: 8,
  tabs: true,
  ventNotches: 6,
  previewColor: "#e5483b",
};

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
  ventSlots: 6,
};

export const DEFAULT_HOLDER: LampHolderDef = {
  measured: false,
  mount: "stem",
  bodyDiameterMm: 45,
  heightMm: 55,
  fixingDiameterMm: 10,
  fixingLengthMm: 14,
  nutAcrossFlatsMm: 17,
  nutThicknessMm: 8,
  screwSpacingMm: 40,
};

export const DEFAULT_BULB: LampBulbDef = { diameterMm: 60, heightAboveHolderMm: 85 };
export const DEFAULT_CABLE: LampCableDef = { diameterMm: 7, tieAnchor: true };

export const DEFAULT_LAMP: LampDefinition = {
  version: 2,
  shade: DEFAULT_SHADE,
  thread: DEFAULT_THREAD,
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
  const t = isRecord(root.thread) ? root.thread : {};
  const b = isRecord(root.base) ? root.base : {};
  const h = isRecord(root.holder) ? root.holder : {};
  const bu = isRecord(root.bulb) ? root.bulb : {};
  const c = isRecord(root.cable) ? root.cable : {};
  return {
    version: 2,
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
      ventSlots: num(b.ventSlots, DEFAULT_BASE.ventSlots),
    },
    holder: {
      measured: bool(h.measured, DEFAULT_HOLDER.measured),
      mount: h.mount === "screws" ? "screws" : "stem",
      bodyDiameterMm: num(h.bodyDiameterMm, DEFAULT_HOLDER.bodyDiameterMm),
      heightMm: num(h.heightMm, DEFAULT_HOLDER.heightMm),
      // Códigos de la primera versión usaban threadDiameterMm para la espiga.
      fixingDiameterMm: num(h.fixingDiameterMm, num(h.threadDiameterMm, DEFAULT_HOLDER.fixingDiameterMm)),
      fixingLengthMm: num(h.fixingLengthMm, DEFAULT_HOLDER.fixingLengthMm),
      nutAcrossFlatsMm: num(h.nutAcrossFlatsMm, DEFAULT_HOLDER.nutAcrossFlatsMm),
      nutThicknessMm: num(h.nutThicknessMm, DEFAULT_HOLDER.nutThicknessMm),
      screwSpacingMm: num(h.screwSpacingMm, DEFAULT_HOLDER.screwSpacingMm),
    },
    bulb: {
      diameterMm: num(bu.diameterMm, DEFAULT_BULB.diameterMm),
      heightAboveHolderMm: num(bu.heightAboveHolderMm, DEFAULT_BULB.heightAboveHolderMm),
    },
    cable: { diameterMm: num(c.diameterMm, DEFAULT_CABLE.diameterMm), tieAnchor: bool(c.tieAnchor, DEFAULT_CABLE.tieAnchor) },
  };
}
