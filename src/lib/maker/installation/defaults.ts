import type {
  InstallationOverrides,
  InstallationRecipe,
  LedVoltage,
  LetterInstallationOverride,
  PaperFormat,
  RelPoint,
  SignInstallationSettings,
} from "@/lib/maker/installation/types";

export const DEFAULT_INSTALLATION_RECIPE: InstallationRecipe = {
  mounting: {
    type: "none",
    keyhole: { headDiameterMm: 7, neckWidthMm: 4, neckLengthMm: 9, depthMm: 4, edgeMarginMm: 2 },
    standoff: {
      wallSpacingMm: 20,
      bodyDiameterMm: 12,
      pegDiameterMm: 8,
      insertDepthMm: 7,
      clearanceMm: 0.2,
      screwHoleDiameterMm: 3.5,
      screwHeadDiameterMm: 5.8,
      bossWallMm: 2,
      edgeMarginMm: 1,
    },
  },
  wiring: {
    mode: "off",
    direction: "ltr",
    powerEntry: "direct-wire",
    wireDiameterMm: 2,
    wireHoleDiameterMm: 2.8,
    holeCenterSpacingMm: 4.5,
    spliceClip: { enabled: true, diameterMm: 5, lengthMm: 25, spacingMm: 12, clearanceMm: 0.4 },
    serviceMarginMm: 30,
    voltage: null,
    printLabels: true,
  },
  template: { paper: "A4", overlapMm: 10 },
};

export const DEFAULT_INSTALLATION_SETTINGS: SignInstallationSettings = {
  ...DEFAULT_INSTALLATION_RECIPE,
  overrides: {},
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Copia `source` sobre `defaults` conservando SOLO claves conocidas con el mismo tipo (lectura tolerante). */
function mergeKnown<T extends object>(defaults: T, source: unknown): T {
  const out: Record<string, unknown> = {};
  const src = isRecord(source) ? source : {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = src[key];
    if (isRecord(fallback)) out[key] = mergeKnown(fallback, value);
    else if (fallback === null) out[key] = value === null || typeof value === "string" ? value ?? null : null;
    else if (typeof fallback === "number") out[key] = finite(value) ? value : fallback;
    else out[key] = typeof value === typeof fallback ? value : fallback;
  }
  return out as T;
}

const ENUMS = {
  mountingType: ["none", "keyhole", "standoff"],
  wiringMode: ["off", "chained"],
  direction: ["ltr", "rtl"],
  powerEntry: ["direct-wire", "usb-c-5v", "usb-c-pd"],
  paper: ["A4", "Letter", "A3"],
  voltage: ["5V", "12V", "24V", "other"],
} as const;

const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

/** Receta desde JSON persistido (posiblemente antiguo/parcial): completa faltantes y descarta valores inválidos. */
export function normalizeInstallationRecipe(raw: unknown): InstallationRecipe {
  // Migración de proyectos del sprint anterior: `wiring.splice` (alojamientos internos, ya eliminados) pasa a
  // `wiring.spliceClip` (soporte externo) conservando Ø, largo, holgura y el interruptor. Las demás claves antiguas
  // (`portClearanceMm`) se descartan: mergeKnown solo conserva claves conocidas.
  const rawRecord = isRecord(raw) ? raw : {};
  const rawWiring = isRecord(rawRecord.wiring) ? rawRecord.wiring : {};
  const legacy = isRecord(rawWiring.splice) ? rawWiring.splice : null;
  const migrated = legacy && !isRecord(rawWiring.spliceClip) ? { ...rawRecord, wiring: { ...rawWiring, spliceClip: legacy } } : raw;
  const r = mergeKnown(DEFAULT_INSTALLATION_RECIPE, migrated);
  const voltage = isRecord(raw) && isRecord(raw.wiring) ? raw.wiring.voltage : null;
  return {
    mounting: { ...r.mounting, type: oneOf(ENUMS.mountingType, r.mounting.type, "none") },
    wiring: {
      ...r.wiring,
      mode: oneOf(ENUMS.wiringMode, r.wiring.mode, "off"),
      direction: oneOf(ENUMS.direction, r.wiring.direction, "ltr"),
      powerEntry: oneOf(ENUMS.powerEntry, r.wiring.powerEntry, "direct-wire"),
      voltage: (ENUMS.voltage as readonly unknown[]).includes(voltage) ? (voltage as LedVoltage) : null,
    },
    template: { ...r.template, paper: oneOf(ENUMS.paper, r.template.paper, "A4") as PaperFormat },
  };
}

function normalizeRelPoint(raw: unknown): RelPoint | null {
  return isRecord(raw) && finite(raw.x) && finite(raw.y) ? { x: raw.x, y: raw.y } : null;
}

export function normalizeInstallationOverrides(raw: unknown): InstallationOverrides {
  const out: InstallationOverrides = {};
  if (!isRecord(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const o: LetterInstallationOverride = {};
    if (Array.isArray(value.mountPoints)) o.mountPoints = value.mountPoints.map(normalizeRelPoint).filter((p): p is RelPoint => p !== null);
    if (finite(value.mountCount) && value.mountCount >= 1 && value.mountCount <= 12) o.mountCount = Math.round(value.mountCount);
    if (Object.keys(o).length > 0) out[id] = o;
  }
  return out;
}

export function normalizeInstallationSettings(raw: unknown): SignInstallationSettings {
  const src = isRecord(raw) ? raw : {};
  return { ...normalizeInstallationRecipe(src), overrides: normalizeInstallationOverrides(src.overrides) };
}

/** Solo la receta (para presets): sin overrides ni posiciones. */
export function extractInstallationRecipe(settings: InstallationRecipe): InstallationRecipe {
  return { mounting: settings.mounting, wiring: settings.wiring, template: settings.template };
}

/** Configuración efectiva de un proyecto: receta global + overrides por letra (tolerante a params antiguos sin estos campos). */
export function getInstallationSettings(params: { installation?: InstallationRecipe; installationOverrides?: InstallationOverrides }): SignInstallationSettings {
  return { ...(params.installation ?? DEFAULT_INSTALLATION_RECIPE), overrides: params.installationOverrides ?? {} };
}
