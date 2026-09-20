import type { MugBodyStyle, MugDefinition, MugHandleDef, MugHandleStyle, MugMode, MugRimStyle } from "@/lib/maker/mugs/types";

/** Valores iniciales (configuración, no restricciones). */
export const DEFAULT_MUG: MugDefinition = {
  mode: "printed",
  heightMm: 150,
  topDiameterMm: 90,
  bottomDiameterMm: 82,
  wallThicknessMm: 2.4,
  bottomThicknessMm: 4,
  bodyStyle: "conical",
  bodyBulgePct: 50,
  rim: "simple",
  base: "normal",
  surface: { style: "smooth", sides: 8 },
  grooves: { enabled: false, count: 12, depthMm: 1.5 },
  bands: { enabled: false, count: 3, heightMm: 6, reliefMm: 1.5 },
  handle: { enabled: true, style: "classic", auto: true, heightMm: 90, projectionMm: 42, thicknessMm: 9, sectionWidthMm: 13, verticalPositionPct: 55 },
  insert: { heightMm: 140, topDiameterMm: 80, bottomDiameterMm: 75, clearanceMm: 0.4 },
  decorations: [],
};

/** Altura, proyección y posición sugeridas para un jarro de este tamaño (lo que usa el asa cuando `auto` = true). */
export function deriveHandleDefaults(heightMm: number, maxDiameterMm: number): Pick<MugHandleDef, "heightMm" | "projectionMm" | "verticalPositionPct" | "thicknessMm" | "sectionWidthMm"> {
  const round = (v: number) => Math.round(v * 2) / 2;
  return {
    heightMm: round(Math.min(heightMm * 0.6, 110)),
    projectionMm: round(Math.min(Math.max(maxDiameterMm * 0.46, 25), 60)),
    verticalPositionPct: 55,
    thicknessMm: 9,
    sectionWidthMm: 13,
  };
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

const MODES: readonly MugMode[] = ["printed", "insert-shell"];
const BODIES: readonly MugBodyStyle[] = ["straight", "conical", "barrel", "bulged"];
const RIMS: readonly MugRimStyle[] = ["simple", "thick", "rounded"];
const HANDLES: readonly MugHandleStyle[] = ["classic", "square", "angular"];

/**
 * Lectura tolerante de una definición venida de afuera (proyecto guardado, o —a futuro— una propuesta de IA):
 * campos faltantes -> defaults, tipos incorrectos -> default, enums desconocidos -> default. NO acota rangos
 * físicos: eso es trabajo de `validateMug`, que muestra el mensaje al usuario en vez de corregir en silencio.
 */
export function normalizeMugDefinition(raw: unknown): MugDefinition {
  const r = rec(raw), D = DEFAULT_MUG;
  const surface = rec(r.surface), grooves = rec(r.grooves), bands = rec(r.bands), handle = rec(r.handle), insert = rec(r.insert);
  return {
    mode: oneOf(r.mode, MODES, D.mode),
    heightMm: num(r.heightMm, D.heightMm),
    topDiameterMm: num(r.topDiameterMm, D.topDiameterMm),
    bottomDiameterMm: num(r.bottomDiameterMm, D.bottomDiameterMm),
    wallThicknessMm: num(r.wallThicknessMm, D.wallThicknessMm),
    bottomThicknessMm: num(r.bottomThicknessMm, D.bottomThicknessMm),
    bodyStyle: oneOf(r.bodyStyle, BODIES, D.bodyStyle),
    bodyBulgePct: num(r.bodyBulgePct, D.bodyBulgePct),
    rim: oneOf(r.rim, RIMS, D.rim),
    base: oneOf(r.base, ["normal", "reinforced"] as const, D.base),
    surface: { style: oneOf(surface.style, ["smooth", "faceted"] as const, D.surface.style), sides: Math.round(num(surface.sides, D.surface.sides)) },
    grooves: { enabled: bool(grooves.enabled, D.grooves.enabled), count: Math.round(num(grooves.count, D.grooves.count)), depthMm: num(grooves.depthMm, D.grooves.depthMm) },
    bands: { enabled: bool(bands.enabled, D.bands.enabled), count: Math.round(num(bands.count, D.bands.count)), heightMm: num(bands.heightMm, D.bands.heightMm), reliefMm: num(bands.reliefMm, D.bands.reliefMm) },
    handle: {
      enabled: bool(handle.enabled, D.handle.enabled),
      style: oneOf(handle.style, HANDLES, D.handle.style),
      auto: bool(handle.auto, D.handle.auto),
      heightMm: num(handle.heightMm, D.handle.heightMm),
      projectionMm: num(handle.projectionMm, D.handle.projectionMm),
      thicknessMm: num(handle.thicknessMm, D.handle.thicknessMm),
      sectionWidthMm: num(handle.sectionWidthMm, D.handle.sectionWidthMm),
      verticalPositionPct: num(handle.verticalPositionPct, D.handle.verticalPositionPct),
    },
    insert: {
      heightMm: num(insert.heightMm, D.insert.heightMm),
      topDiameterMm: num(insert.topDiameterMm, D.insert.topDiameterMm),
      bottomDiameterMm: num(insert.bottomDiameterMm, D.insert.bottomDiameterMm),
      clearanceMm: num(insert.clearanceMm, D.insert.clearanceMm),
    },
    decorations: [],
  };
}
