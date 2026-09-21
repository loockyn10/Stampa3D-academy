import type { MakerFontId } from "@/lib/maker/types";
import type { MugDecoration, MugDecorationMode, MugDecorationSource, MugMedallionDef, MugRasterDetection, MugTextAlign } from "@/lib/maker/mugs/types";

export const MAX_DECORATIONS = 10;
/** Pared mínima que un grabado debe respetar (mm). */
export const ENGRAVE_SAFETY_MM = 1;
export const MAX_TEXT_LINES = 4;
export const MAX_TEXT_LENGTH = 80;

export const DEFAULT_MEDALLION: MugMedallionDef = { shape: "oval", baseDepthMm: 1.5, paddingMm: 3, cornerRadiusMm: 6 };

const FONT_IDS: readonly MakerFontId[] = ["montserrat-regular", "montserrat-bold"];
/** Enums de decoración expuestos al planificador de IA (fuente única con `normalizeDecorations`). */
export const MUG_FONT_IDS = FONT_IDS;
export const MUG_DECORATION_MODES: readonly MugDecorationMode[] = ["emboss", "engrave", "medallion"];
export const MUG_TEXT_ALIGNS: readonly MugTextAlign[] = ["left", "center", "right"];
export const MUG_MEDALLION_SHAPES: readonly MugMedallionDef["shape"][] = ["oval", "circle", "rounded-rect"];

/** Profundidad por defecto: relieve 1.5 mm, grabado 1.0 mm, arte de medallón 1.0 mm. */
export function defaultDepth(mode: MugDecorationMode): number {
  return mode === "emboss" ? 1.5 : 1;
}

export function newDecorationId(): string {
  return `dec-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** Decoración nueva con valores razonables, centrada a media altura del jarro, al frente. */
export function createDecoration(source: MugDecorationSource, heightMm: number, patch: Partial<MugDecoration> = {}): MugDecoration {
  const mode: MugDecorationMode = patch.mode ?? "emboss";
  const label = source.kind === "text" ? "Texto" : source.kind === "svg" ? "SVG" : source.kind === "raster" ? "Imagen" : "Medallón";
  return {
    id: newDecorationId(),
    name: source.kind === "text" && source.text.trim() ? source.text.split("\n")[0].slice(0, 24) : label,
    enabled: true,
    source,
    mode,
    position: { angleDeg: 0, centerZMm: Math.round(heightMm / 2) },
    size: { widthMm: source.kind === "text" ? 60 : 40, heightMm: 20, lockAspectRatio: true },
    rotationDeg: 0,
    depthMm: defaultDepth(mode),
    edgeBevelMm: 0.4,
    medallion: { ...DEFAULT_MEDALLION },
    ...patch,
  };
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);

function normalizeSource(raw: unknown): MugDecorationSource {
  const s = rec(raw);
  if (s.kind === "text") {
    return {
      kind: "text",
      text: str(s.text, "").slice(0, 400),
      fontId: FONT_IDS.includes(s.fontId as MakerFontId) ? (s.fontId as MakerFontId) : "montserrat-bold",
      align: MUG_TEXT_ALIGNS.includes(s.align as MugTextAlign) ? (s.align as MugTextAlign) : "center",
    };
  }
  if (s.kind === "svg") return { kind: "svg", assetId: str(s.assetId, ""), fileName: str(s.fileName, "diseno.svg") };
  if (s.kind === "raster") {
    return {
      kind: "raster",
      assetId: str(s.assetId, ""),
      fileName: str(s.fileName, "imagen.png"),
      format: s.format === "jpg" ? "jpg" : "png",
      detection: (["auto", "alpha", "luminance"] as MugRasterDetection[]).includes(s.detection as MugRasterDetection) ? (s.detection as MugRasterDetection) : "auto",
      threshold: s.threshold === null || s.threshold === undefined ? null : num(s.threshold, 128),
      invert: s.invert === true,
    };
  }
  return { kind: "none" };
}

/**
 * Lectura tolerante de `decorations[]` (proyecto viejo, definición parcial o —a futuro— propuesta de IA): campos
 * faltantes -> defaults, enums desconocidos -> default, se descartan entradas no-objeto y se recorta a MAX_DECORATIONS.
 * NO acota rangos físicos: eso es `validateMug`.
 */
export function normalizeDecorations(raw: unknown): MugDecoration[] {
  if (!Array.isArray(raw)) return [];
  const out: MugDecoration[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, MAX_DECORATIONS)) {
    if (!item || typeof item !== "object") continue;
    const d = rec(item);
    const mode = MUG_DECORATION_MODES.includes(d.mode as MugDecorationMode) ? (d.mode as MugDecorationMode) : "emboss";
    const position = rec(d.position), size = rec(d.size), med = rec(d.medallion);
    let id = str(d.id, "") || newDecorationId();
    if (seen.has(id)) id = newDecorationId();
    seen.add(id);
    const shape = MUG_MEDALLION_SHAPES.includes(med.shape as MugMedallionDef["shape"]) ? (med.shape as MugMedallionDef["shape"]) : DEFAULT_MEDALLION.shape;
    out.push({
      id,
      name: str(d.name, "Decoración").slice(0, 60),
      enabled: d.enabled !== false,
      source: normalizeSource(d.source),
      mode,
      position: { angleDeg: num(position.angleDeg, 0), centerZMm: num(position.centerZMm, 75) },
      size: { widthMm: num(size.widthMm, 40), heightMm: num(size.heightMm, 20), lockAspectRatio: size.lockAspectRatio !== false },
      rotationDeg: num(d.rotationDeg, 0),
      depthMm: num(d.depthMm, defaultDepth(mode)),
      edgeBevelMm: num(d.edgeBevelMm, 0.4),
      medallion: {
        shape,
        baseDepthMm: num(med.baseDepthMm, DEFAULT_MEDALLION.baseDepthMm),
        paddingMm: num(med.paddingMm, DEFAULT_MEDALLION.paddingMm),
        cornerRadiusMm: num(med.cornerRadiusMm, DEFAULT_MEDALLION.cornerRadiusMm),
      },
    });
  }
  return out;
}

/** Ids de assets referenciados por las decoraciones (habilitadas o no: el proyecto los conserva). */
export function referencedAssetIds(decorations: MugDecoration[]): string[] {
  const ids = new Set<string>();
  for (const d of decorations) if ((d.source.kind === "svg" || d.source.kind === "raster") && d.source.assetId) ids.add(d.source.assetId);
  return [...ids];
}
