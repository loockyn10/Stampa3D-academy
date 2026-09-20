import { DEFAULT_LETTER_SIGN_PARAMS } from "@/lib/maker/defaults";
import { DEFAULT_PNG_OPTIONS, type PngImportOptions, type PngSmoothing } from "@/lib/maker/import/types";
import { applyPresetSettings, extractPresetSettings, type PresetSettings } from "@/lib/maker/presets/presetSettings";
import type { BackCutout, LetterSignParams, MakerFontId } from "@/lib/maker/types";

/**
 * PROJECT = trabajo concreto (diseño + configuración) para retomarlo luego.
 * Guarda el ORIGEN (texto, o referencia a un SVG/PNG en Storage privado) y
 * la receta; NUNCA los contornos ya generados ni el binario del archivo:
 * al abrir se re-procesa con el motor vigente. Ver docs/STAMPA_MAKER.md
 * sección 19.
 */
export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_STORAGE_BUCKET = "maker-projects";

export type ProjectSourceType = "text" | "svg" | "png";

export interface ProjectTextSource {
  text: string;
  fontId: MakerFontId;
  heightMm: number;
}

/** Referencia a un archivo en Storage (path DENTRO del bucket, sin el nombre del bucket). Nunca contiene el contenido. */
export interface ProjectFileSource {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  heightMm: number;
  sizeBytes: number;
  pngOptions?: PngImportOptions;
}

export type ProjectSourceData = ProjectTextSource | ProjectFileSource;

export interface ProjectFileMeta {
  kind: "svg" | "png";
  fileName: string;
  sizeBytes: number;
}

/** Estado de trabajo que define un proyecto (sin cámara, vista ni estado transitorio). */
export interface ProjectWorkState {
  params: LetterSignParams;
  sourceMode: "text" | "file";
  designHeightMm: number;
  pngOptions: PngImportOptions;
  fileMeta: ProjectFileMeta | null;
}

export interface ProjectPayload {
  source_type: ProjectSourceType;
  source_data: ProjectSourceData;
  /** Receta de fabricación + recortes traseros (posicionales: solo viajan en el proyecto, nunca en un preset). */
  settings: PresetSettings & { backCutouts: BackCutout[] };
  preset_id: string | null;
  schema_version: number;
}

/** Fila persistida (tolerante: cualquier campo del JSON puede faltar o venir de otra versión). */
export interface ProjectRow {
  source_type: string;
  source_data: unknown;
  settings: unknown;
  preset_id?: string | null;
  schema_version?: number | null;
}

export interface LoadedProject {
  params: LetterSignParams;
  sourceMode: "text" | "file";
  designHeightMm: number;
  pngOptions: PngImportOptions;
  /** Referencia al archivo a descargar (solo proyectos SVG/PNG). */
  fileRef: ProjectFileSource | null;
  presetId: string | null;
}

export class ProjectDataError extends Error {}

export const MIME_BY_KIND: Record<"svg" | "png" | "jpg", string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg" };

/** `{user_id}/{project_id}/source.svg|png` dentro del bucket privado (la primera carpeta es el dueño: la policy de Storage la exige). */
export function projectSourcePath(userId: string, projectId: string, kind: "svg" | "png" | "jpg"): string {
  return `${userId}/${projectId}/source.${kind}`;
}

export function serializeProject(state: ProjectWorkState, opts: { storagePath?: string; presetId?: string | null } = {}): ProjectPayload {
  const settings = { ...extractPresetSettings(state.params), backCutouts: (state.params.backCutouts ?? []).map((c) => ({ ...c })) };
  const presetId = opts.presetId ?? null;
  if (state.sourceMode === "text") {
    return {
      source_type: "text",
      source_data: { text: state.params.text, fontId: state.params.fontId, heightMm: state.params.heightMm },
      settings,
      preset_id: presetId,
      schema_version: PROJECT_SCHEMA_VERSION,
    };
  }
  if (!state.fileMeta) throw new ProjectDataError("Subí un archivo SVG o PNG antes de guardar el proyecto.");
  const source: ProjectFileSource = {
    storagePath: opts.storagePath ?? "",
    originalFilename: state.fileMeta.fileName,
    mimeType: MIME_BY_KIND[state.fileMeta.kind],
    heightMm: state.designHeightMm,
    sizeBytes: state.fileMeta.sizeBytes,
  };
  if (state.fileMeta.kind === "png") source.pngOptions = { ...state.pngOptions };
  return { source_type: state.fileMeta.kind, source_data: source, settings, preset_id: presetId, schema_version: PROJECT_SCHEMA_VERSION };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Lectura tolerante de los recortes traseros persistidos: descarta entradas de tipo desconocido y completa campos faltantes; proyectos anteriores (sin el campo) => []. */
export function normalizeBackCutouts(raw: unknown): BackCutout[] {
  if (!Array.isArray(raw)) return [];
  const out: BackCutout[] = [];
  raw.forEach((item, i) => {
    const r = asRecord(item);
    const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    const base = { id: typeof r.id === "string" && r.id ? r.id : `cutout-${i + 1}`, x: n(r.x, 0), y: n(r.y, 0) };
    if (r.type === "circle") out.push({ ...base, type: "circle", diameterMm: n(r.diameterMm, 5) });
    else if (r.type === "capsule") out.push({ ...base, type: "capsule", widthMm: n(r.widthMm, 10), heightMm: n(r.heightMm, 4), rotationDeg: n(r.rotationDeg, 0) });
    else if (r.type === "keyhole") {
      const neckWidthMm = n(r.neckWidthMm, 4);
      out.push({ ...base, type: "keyhole", headDiameterMm: n(r.headDiameterMm, 10), neckWidthMm, neckLengthMm: n(r.neckLengthMm, 10), tailDiameterMm: n(r.tailDiameterMm, neckWidthMm), rotationDeg: n(r.rotationDeg, 0) });
    }
  });
  return out;
}

function normalizePngOptions(raw: unknown): PngImportOptions {
  const r = asRecord(raw);
  const smoothing = (["low", "medium", "high"] as PngSmoothing[]).includes(r.smoothing as PngSmoothing)
    ? (r.smoothing as PngSmoothing)
    : DEFAULT_PNG_OPTIONS.smoothing;
  return {
    threshold: typeof r.threshold === "number" && r.threshold >= 0 && r.threshold <= 255 ? r.threshold : DEFAULT_PNG_OPTIONS.threshold,
    invert: typeof r.invert === "boolean" ? r.invert : DEFAULT_PNG_OPTIONS.invert,
    smoothing,
  };
}

/** Reconstruye el estado de trabajo desde una fila persistida. Completa con defaults lo que falte. */
export function deserializeProject(row: ProjectRow): LoadedProject {
  const source = asRecord(row.source_data);
  const base: LetterSignParams = {
    ...applyPresetSettings(DEFAULT_LETTER_SIGN_PARAMS, row.settings, row.schema_version),
    backCutouts: normalizeBackCutouts(asRecord(row.settings).backCutouts),
  };
  const presetId = typeof row.preset_id === "string" ? row.preset_id : null;

  if (row.source_type === "svg" || row.source_type === "png") {
    if (typeof source.storagePath !== "string" || !source.storagePath) {
      throw new ProjectDataError("El proyecto no tiene un archivo de origen válido.");
    }
    const kind = row.source_type;
    const heightMm = num(source.heightMm, DEFAULT_LETTER_SIGN_PARAMS.heightMm);
    return {
      params: base,
      sourceMode: "file",
      designHeightMm: heightMm,
      pngOptions: kind === "png" ? normalizePngOptions(source.pngOptions) : { ...DEFAULT_PNG_OPTIONS },
      fileRef: {
        storagePath: source.storagePath,
        originalFilename: typeof source.originalFilename === "string" ? source.originalFilename : `source.${kind}`,
        mimeType: typeof source.mimeType === "string" ? source.mimeType : MIME_BY_KIND[kind],
        heightMm,
        sizeBytes: typeof source.sizeBytes === "number" ? source.sizeBytes : 0,
      },
      presetId,
    };
  }

  const fontId = typeof source.fontId === "string" ? (source.fontId as MakerFontId) : DEFAULT_LETTER_SIGN_PARAMS.fontId;
  return {
    params: {
      ...base,
      text: typeof source.text === "string" ? source.text : DEFAULT_LETTER_SIGN_PARAMS.text,
      fontId,
      heightMm: num(source.heightMm, DEFAULT_LETTER_SIGN_PARAMS.heightMm),
    },
    sourceMode: "text",
    designHeightMm: DEFAULT_LETTER_SIGN_PARAMS.heightMm,
    pngOptions: { ...DEFAULT_PNG_OPTIONS },
    fileRef: null,
    presetId,
  };
}

/**
 * Firma comparable del trabajo actual: cambia si cambia cualquier dato que
 * un guardado persistiría (incluido reemplazar el archivo). No depende del
 * storagePath (que solo existe tras guardar).
 */
export function projectSignature(state: ProjectWorkState, presetId: string | null): string {
  try {
    const payload = serializeProject(state, { presetId });
    return JSON.stringify([payload.source_type, payload.source_data, payload.settings, payload.preset_id]);
  } catch {
    return `unsaveable:${JSON.stringify([state.sourceMode, state.params])}`;
  }
}

export function isProjectDirty(current: ProjectWorkState, currentPresetId: string | null, savedSignature: string | null): boolean {
  return savedSignature === null || projectSignature(current, currentPresetId) !== savedSignature;
}
