import { DEFAULT_LETTER_SIGN_PARAMS } from "@/lib/maker/defaults";
import type { LetterSignParams } from "@/lib/maker/types";
import { normalizeInstallationRecipe } from "@/lib/maker/installation/defaults";

/**
 * PRESET = RECETA de fabricación reutilizable (cuerpo, frente, unión,
 * biseles, patrón, holguras...). NO incluye el diseño (texto, fuente, alto,
 * archivo), ni estado de UI (cámara, modelo/explosionada, slider). Ver
 * docs/STAMPA_MAKER.md sección 18.
 */
export const PRESET_SCHEMA_VERSION = 1;

/** Campos de LetterSignParams que pertenecen al DISEÑO (incluye los recortes traseros, posicionales) y por lo tanto nunca viajan en un preset. */
export const DESIGN_PARAM_KEYS = ["text", "fontId", "heightMm", "backCutouts", "installationOverrides"] as const satisfies readonly (keyof LetterSignParams)[];

export type DesignParamKey = (typeof DESIGN_PARAM_KEYS)[number];

/** Receta de fabricación: todo LetterSignParams salvo el diseño. */
export type PresetSettings = Omit<LetterSignParams, DesignParamKey>;

/**
 * Lista EXPLÍCITA (no derivada del state): un campo nuevo en
 * LetterSignParams obliga a decidir si es receta o diseño — el test
 * "cobertura de claves" falla si se olvida.
 */
export const PRESET_SETTING_KEYS = [
  "depthMm",
  "wallMm",
  "baseMm",
  "bodyType",
  "rearExpansionMm",
  "taperStyle",
  "ribsCount",
  "ribProtrusionMm",
  "ribWidthMm",
  "bevelEnabled",
  "bevelDepthMm",
  "bevelInsetMm",
  "grooveEnabled",
  "grooveInsetMm",
  "grooveWidthMm",
  "groovePositionMm",
  "rearBevelEnabled",
  "rearBevelDepthMm",
  "rearBevelInsetMm",
  "frontType",
  "lidMm",
  "lidJoint",
  "insertDepthMm",
  "clearanceMm",
  "lipWallMm",
  "lidBevelEnabled",
  "lidBevelDepthMm",
  "lidBevelInsetMm",
  "maskThicknessMm",
  "maskWallThicknessMm",
  "maskSideDepthMm",
  "maskClearanceMm",
  "diffuserThicknessMm",
  "holeDiameterMm",
  "pitchMm",
  "edgeMarginMm",
  "channelWidthMm",
  "channelDepthMm",
  "channelOffsetMm",
  "diffuserClearanceMm",
  "installation",
] as const satisfies readonly (keyof PresetSettings)[];

/** Valores permitidos de los campos enumerados (lectura tolerante: un valor desconocido cae al default). */
const ENUM_VALUES: Partial<Record<keyof PresetSettings, readonly (string | number)[]>> = {
  bodyType: ["standard", "tapered"],
  taperStyle: ["stepped", "smooth"],
  ribsCount: [0, 1, 2],
  frontType: ["open", "lid", "perforated", "light-channel"],
  lidJoint: ["glue", "interior-lip"],
};

export function defaultPresetSettings(): PresetSettings {
  return extractPresetSettings(DEFAULT_LETTER_SIGN_PARAMS);
}

/** Extrae SOLO la receta de los params actuales (whitelist explícita). */
export function extractPresetSettings(params: LetterSignParams): PresetSettings {
  const out: Record<string, unknown> = {};
  for (const key of PRESET_SETTING_KEYS) out[key] = params[key];
  return out as unknown as PresetSettings;
}

/**
 * Lectura tolerante de un JSON persistido (posiblemente de otra versión):
 * ignora claves desconocidas y completa faltantes/inválidas con el default.
 * v1: sin migraciones de JSON, `schemaVersion` se acepta como informativo.
 */
export function normalizePresetSettings(raw: unknown, schemaVersion?: number | null): PresetSettings {
  void schemaVersion; // v1: sin migraciones de JSON todavía.
  const defaults = defaultPresetSettings() as unknown as Record<string, unknown>;
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const key of PRESET_SETTING_KEYS) {
    if (key === "installation") {
      // Receta de instalación (montaje/cableado/plantilla): objeto anidado, normalización propia (nunca trae posiciones por letra).
      out[key] = normalizeInstallationRecipe(source[key]);
      continue;
    }
    const fallback = defaults[key];
    const value = source[key];
    const sameType = typeof value === typeof fallback && (typeof value !== "number" || Number.isFinite(value));
    const allowed = ENUM_VALUES[key];
    out[key] = sameType && (!allowed || allowed.includes(value as string | number)) ? value : fallback;
  }
  return out as unknown as PresetSettings;
}

/** Aplica una receta sobre los params actuales, conservando el diseño (texto, fuente, alto). */
export function applyPresetSettings(current: LetterSignParams, settings: unknown, schemaVersion?: number | null): LetterSignParams {
  return { ...current, ...normalizePresetSettings(settings, schemaVersion) };
}

/** Params iniciales al entrar a Maker: preset predeterminado del usuario si existe, si no los defaults de Stampa. */
export function resolveInitialParams(defaultPresetSettings: unknown | null | undefined, schemaVersion?: number | null): LetterSignParams {
  if (defaultPresetSettings == null) return { ...DEFAULT_LETTER_SIGN_PARAMS };
  return applyPresetSettings(DEFAULT_LETTER_SIGN_PARAMS, defaultPresetSettings, schemaVersion);
}

export function presetSettingsEqual(a: PresetSettings, b: PresetSettings): boolean {
  return PRESET_SETTING_KEYS.every((key) => (key === "installation" ? JSON.stringify(a[key]) === JSON.stringify(b[key]) : a[key] === b[key]));
}

/** ¿Los params actuales se apartan de la receta del preset cargado? Solo mira campos de receta (cambiar el texto no "modifica" el preset). */
export function isPresetModified(params: LetterSignParams, presetSettings: unknown, schemaVersion?: number | null): boolean {
  return !presetSettingsEqual(extractPresetSettings(params), normalizePresetSettings(presetSettings, schemaVersion));
}
