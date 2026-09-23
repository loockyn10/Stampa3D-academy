import { DEFAULT_LETTER_SPACING_PCT, DEFAULT_NEON_FONT_ID, DEFAULT_NEON_PARAMS, DEFAULT_NEON_TEXT } from "@/lib/maker/neon/defaults";
import { NEON_FONTS } from "@/lib/maker/neon/fonts/neonFonts";
import { LETTER_SPACING_MAX_PCT, LETTER_SPACING_MIN_PCT } from "@/lib/maker/neon/paths/textToNeonPaths";
import { DEFAULT_RASTER_SETTINGS, type RasterCleaning, type RasterDetectionMode, type RasterSettings, type RasterSimplify } from "@/lib/maker/neon/raster/types";
import type { NeonFontId, NeonParams, NeonSourceType } from "@/lib/maker/neon/types";
import { MIME_BY_KIND } from "@/lib/maker/projects/projectData";
import {
  DEFAULT_NEON_INSTALLATION_OVERRIDES,
  DEFAULT_NEON_INSTALLATION_RECIPE,
  normalizeNeonInstallationOverrides,
  normalizeNeonInstallationRecipe,
  type NeonInstallationOverrides,
  type NeonInstallationRecipe,
} from "@/lib/maker/neon/installation/types";

/**
 * PROJECT de Neon LED. Igual que en Carteles guarda el ORIGEN (texto, o referencia al archivo en Storage privado) y la
 * receta de conversión/fabricación — NUNCA los NeonPaths ni el skeleton ya calculados: al abrir se descarga el
 * original y se repite el pipeline, así una mejora futura del motor reprocesa proyectos viejos.
 *
 * Reusa la tabla `maker_projects`: los proyectos Neon se distinguen por `source_type` con prefijo "neon-" (así Carteles,
 * que filtra por sus propios tipos, no los ve ni los rompe). Ver supabase/migrations/20260920120000_maker_neon_projects.sql.
 */
export const NEON_PROJECT_SCHEMA_VERSION = 1;

export type NeonProjectSourceType = "neon-text" | "neon-svg" | "neon-png" | "neon-jpg";
export type NeonFileKind = "svg" | "png" | "jpg";

export interface NeonProjectFileMeta {
  kind: NeonFileKind;
  fileName: string;
  sizeBytes: number;
}

/** Estado de trabajo que define un proyecto Neon (sin cámara, vista ni estado transitorio). */
export interface NeonWorkState {
  params: NeonParams;
  sourceType: NeonSourceType;
  text: string;
  fontId: NeonFontId;
  letterSpacingPct: number;
  raster: RasterSettings;
  fileMeta: NeonProjectFileMeta | null;
  /** Instalación 0.3: receta completa (Neon no tiene presets todavía, viaja entera en el proyecto) + overrides por segmento. */
  installationRecipe: NeonInstallationRecipe;
  installationOverrides: NeonInstallationOverrides;
}

export interface NeonProjectPayload {
  source_type: NeonProjectSourceType;
  source_data: object;
  settings: object;
  preset_id: null;
  schema_version: number;
}

export interface NeonFileRef {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  kind: NeonFileKind;
}

export interface LoadedNeonProject {
  params: NeonParams;
  sourceType: NeonSourceType;
  text: string;
  fontId: NeonFontId;
  letterSpacingPct: number;
  raster: RasterSettings;
  fileRef: NeonFileRef | null;
  installationRecipe: NeonInstallationRecipe;
  installationOverrides: NeonInstallationOverrides;
}

export class NeonProjectDataError extends Error {}

const CHANNEL_KEYS = ["neonWidthMm", "clearanceMm", "wallHeightMm", "wallThicknessMm", "floorThicknessMm", "minBendRadiusMm"] as const;

export function serializeNeonProject(state: NeonWorkState, opts: { storagePath?: string } = {}): NeonProjectPayload {
  const settings: Record<string, unknown> = {};
  for (const k of CHANNEL_KEYS) settings[k] = state.params[k];
  // Instalación 0.3: mismo campo jsonb `settings`, anidado (no rompe el whitelist plano de CHANNEL_KEYS ni obliga una migration nueva).
  settings.installation = { recipe: state.installationRecipe, overrides: state.installationOverrides };
  const common = { designHeightMm: state.params.designHeightMm, fontId: state.fontId, letterSpacingPct: state.letterSpacingPct };

  if (state.sourceType === "text") {
    return { source_type: "neon-text", source_data: { text: state.text, ...common }, settings, preset_id: null, schema_version: NEON_PROJECT_SCHEMA_VERSION };
  }
  const meta = state.fileMeta;
  if (!meta || (state.sourceType === "image" ? meta.kind === "svg" : meta.kind !== "svg")) {
    throw new NeonProjectDataError("Subí un archivo antes de guardar el proyecto.");
  }
  const source: Record<string, unknown> = {
    storagePath: opts.storagePath ?? "",
    originalFilename: meta.fileName,
    mimeType: MIME_BY_KIND[meta.kind],
    sizeBytes: meta.sizeBytes,
    ...common,
  };
  // Solo la receta de conversión (no el skeleton): ver el comentario del módulo.
  if (state.sourceType === "image") source.raster = { ...state.raster };
  return {
    source_type: meta.kind === "svg" ? "neon-svg" : meta.kind === "png" ? "neon-png" : "neon-jpg",
    source_data: source,
    settings,
    preset_id: null,
    schema_version: NEON_PROJECT_SCHEMA_VERSION,
  };
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function numIn(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

/** Lectura tolerante: cualquier campo puede faltar o venir de otra versión; se completa con defaults y se acota. */
export function normalizeRasterSettings(raw: unknown): RasterSettings {
  const r = rec(raw);
  const D = DEFAULT_RASTER_SETTINGS;
  const mode = (["auto", "alpha", "luminance"] as RasterDetectionMode[]).includes(r.detectionMode as RasterDetectionMode) ? (r.detectionMode as RasterDetectionMode) : D.detectionMode;
  const simplify = (["low", "medium", "high"] as RasterSimplify[]).includes(r.simplify as RasterSimplify) ? (r.simplify as RasterSimplify) : D.simplify;
  const cleaning = ([0, 1, 2, 3] as RasterCleaning[]).includes(r.cleaning as RasterCleaning) ? (r.cleaning as RasterCleaning) : D.cleaning;
  return {
    detectionMode: mode,
    alphaThreshold: numIn(r.alphaThreshold, 0, 255, D.alphaThreshold),
    threshold: r.threshold === null ? null : numIn(r.threshold, 0, 255, -1) === -1 ? D.threshold : (r.threshold as number),
    invert: typeof r.invert === "boolean" ? r.invert : D.invert,
    contrast: numIn(r.contrast, -100, 100, D.contrast),
    cleaning,
    pruneMm: numIn(r.pruneMm, 0, 100, D.pruneMm),
    simplify,
    smoothing: numIn(r.smoothing, 0, 100, D.smoothing),
  };
}

export function deserializeNeonProject(row: { source_type: string; source_data: unknown; settings: unknown }): LoadedNeonProject {
  const src = rec(row.source_data);
  const set = rec(row.settings);
  const D = DEFAULT_NEON_PARAMS;
  const params: NeonParams = {
    designHeightMm: numIn(src.designHeightMm, 10, 2000, D.designHeightMm),
    neonWidthMm: numIn(set.neonWidthMm, 2, 30, D.neonWidthMm),
    clearanceMm: numIn(set.clearanceMm, 0, 3, D.clearanceMm),
    wallHeightMm: numIn(set.wallHeightMm, 1, 50, D.wallHeightMm),
    wallThicknessMm: numIn(set.wallThicknessMm, 0.4, 10, D.wallThicknessMm),
    floorThicknessMm: numIn(set.floorThicknessMm, 0.4, 10, D.floorThicknessMm),
    minBendRadiusMm: numIn(set.minBendRadiusMm, 1, 500, D.minBendRadiusMm),
  };
  const fontId = NEON_FONTS.some((f) => f.id === src.fontId) ? (src.fontId as NeonFontId) : DEFAULT_NEON_FONT_ID;
  const letterSpacingPct = numIn(src.letterSpacingPct, LETTER_SPACING_MIN_PCT, LETTER_SPACING_MAX_PCT, DEFAULT_LETTER_SPACING_PCT);
  const installationRaw = rec(set.installation);
  const installationRecipe = "recipe" in installationRaw ? normalizeNeonInstallationRecipe(installationRaw.recipe) : DEFAULT_NEON_INSTALLATION_RECIPE;
  const installationOverrides = "overrides" in installationRaw ? normalizeNeonInstallationOverrides(installationRaw.overrides) : DEFAULT_NEON_INSTALLATION_OVERRIDES;
  const base = { params, fontId, letterSpacingPct, raster: normalizeRasterSettings(src.raster), installationRecipe, installationOverrides };

  if (row.source_type === "neon-text") {
    return { ...base, sourceType: "text", text: typeof src.text === "string" ? src.text : DEFAULT_NEON_TEXT, fileRef: null };
  }
  const kind: NeonFileKind | null = row.source_type === "neon-svg" ? "svg" : row.source_type === "neon-png" ? "png" : row.source_type === "neon-jpg" ? "jpg" : null;
  if (!kind) throw new NeonProjectDataError("El proyecto no es de Neon LED.");
  if (typeof src.storagePath !== "string" || !src.storagePath) throw new NeonProjectDataError("El proyecto no tiene un archivo de origen válido.");
  return {
    ...base,
    sourceType: kind === "svg" ? "svg" : "image",
    text: DEFAULT_NEON_TEXT,
    fileRef: {
      storagePath: src.storagePath,
      originalFilename: typeof src.originalFilename === "string" ? src.originalFilename : `source.${kind}`,
      mimeType: typeof src.mimeType === "string" ? src.mimeType : MIME_BY_KIND[kind],
      sizeBytes: typeof src.sizeBytes === "number" ? src.sizeBytes : 0,
      kind,
    },
  };
}

/** Firma comparable del trabajo (detecta cambios sin guardar). No depende del storagePath. */
export function neonProjectSignature(state: NeonWorkState): string {
  try {
    const p = serializeNeonProject(state);
    return JSON.stringify([p.source_type, p.source_data, p.settings]);
  } catch {
    return `unsaveable:${JSON.stringify([state.sourceType, state.params, state.text])}`;
  }
}
