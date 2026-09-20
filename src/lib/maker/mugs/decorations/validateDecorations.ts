import type { Artwork } from "@/lib/maker/mugs/decorations/artwork";
import { ENGRAVE_SAFETY_MM, MAX_DECORATIONS } from "@/lib/maker/mugs/decorations/decorationDefaults";
import { effectiveSize, semanticToTheta } from "@/lib/maker/mugs/decorations/evaluator";
import type { MugDecoration, MugDefinition, MugIssue } from "@/lib/maker/mugs/types";

/** Margen recomendado desde la boca y desde la base (mm). */
export const SAFE_MARGIN_MM = 5;

export const decorationField = (id: string, prop: string) => `decoration:${id}:${prop}`;

export function bodyHeightOf(def: MugDefinition): number {
  return def.mode === "insert-shell" ? def.bottomThicknessMm + def.insert.heightMm : def.heightMm;
}

const fin = Number.isFinite;

/**
 * Fase 1 (antes de armar el cuerpo): rangos y reglas físicas que no dependen de la geometría resuelta. Todo lo que
 * devuelve BLOQUEA la generación.
 */
export function validateDecorationInputs(def: MugDefinition): MugIssue[] {
  const errors: MugIssue[] = [];
  const decos = def.decorations;
  if (decos.length > MAX_DECORATIONS) errors.push({ code: "DECO_COUNT", message: `Máximo ${MAX_DECORATIONS} decoraciones por jarro.`, field: "decorations" });
  const H = bodyHeightOf(def);
  for (const d of decos) {
    if (!d.enabled) continue;
    const err = (code: string, message: string, prop: string) => errors.push({ code, message: `${d.name}: ${message}`, field: decorationField(d.id, prop) });
    const range = (prop: string, label: string, v: number, min: number, max: number, unit = "mm") => {
      if (!fin(v) || v < min || v > max) err("DECO_RANGE", `${label} debe estar entre ${min} y ${max} ${unit}.`, prop);
    };
    range("widthMm", "El ancho", d.size.widthMm, 3, 300);
    if (d.mode === "medallion" || !d.size.lockAspectRatio) range("heightMm", "El alto", d.size.heightMm, 3, 300);
    range("centerZMm", "La posición vertical", d.position.centerZMm, 0, H);
    range("angleDeg", "El ángulo", d.position.angleDeg, -360, 360, "°");
    range("rotationDeg", "La rotación", d.rotationDeg, -180, 180, "°");
    range("edgeBevelMm", "El suavizado de borde", d.edgeBevelMm, 0, 5);
    if (d.mode === "medallion") {
      range("depthMm", "La altura del arte", d.depthMm, 0, 5);
      range("baseDepthMm", "El espesor de la base", d.medallion.baseDepthMm, 0.2, 4);
      range("paddingMm", "El margen", d.medallion.paddingMm, 0, 100);
      range("cornerRadiusMm", "El radio de esquina", d.medallion.cornerRadiusMm, 0, 100);
      if (fin(d.size.widthMm) && fin(d.medallion.paddingMm) && d.source.kind !== "none" && (d.size.widthMm - 2 * d.medallion.paddingMm < 3 || d.size.heightMm - 2 * d.medallion.paddingMm < 3))
        err("DECO_PADDING", "El margen deja sin lugar al arte dentro del medallón.", "paddingMm");
    } else {
      range("depthMm", d.mode === "emboss" ? "La altura del relieve" : "La profundidad del grabado", d.depthMm, 0.1, 5);
    }
    if (d.mode === "engrave" && fin(d.depthMm) && d.depthMm >= def.wallThicknessMm - ENGRAVE_SAFETY_MM)
      err("ENGRAVE_TOO_DEEP", `El grabado dejaría una pared demasiado fina. Usá una profundidad menor a ${Math.max(0, def.wallThicknessMm - ENGRAVE_SAFETY_MM).toFixed(1)} mm (pared ${def.wallThicknessMm} mm, ${ENGRAVE_SAFETY_MM} mm de margen).`, "depthMm");
    if (d.source.kind === "text" && !d.source.text.trim()) err("DECO_TEXT_EMPTY", "Escribí un texto.", "text");
    if ((d.source.kind === "svg" || d.source.kind === "raster") && !d.source.assetId) err("DECO_NO_FILE", "Falta el archivo.", "source");
    if (d.source.kind === "none" && d.mode !== "medallion") err("DECO_NO_ART", "Elegí un texto, SVG o imagen (solo el medallón puede ir liso).", "source");
  }
  return errors;
}

export interface HandleWindows {
  /** Centros z (mm) de las dos uniones y semi-tamaño de cada ventana (mm). */
  zTop: number;
  zBot: number;
  halfWidthMm: number;
  halfHeightMm: number;
}

export interface PlacementContext {
  heightMm: number;
  outerR: (z: number) => number;
  handle: HandleWindows | null;
  artworkOf?: (d: MugDecoration) => Artwork | null;
}

/**
 * Fase 2 (con el cuerpo resuelto): errores de geometría (más ancha que el contorno) y warnings (margen seguro y
 * solapamiento con el asa). Los warnings nunca bloquean y la geometría no se corrompe si se ignoran.
 */
export function validateDecorationPlacement(def: MugDefinition, ctx: PlacementContext): { errors: MugIssue[]; warnings: MugIssue[] } {
  const errors: MugIssue[] = [], warnings: MugIssue[] = [];
  for (const d of def.decorations) {
    if (!d.enabled) continue;
    const art = ctx.artworkOf?.(d) ?? null;
    const { widthMm, heightMm } = d.mode === "medallion" ? { widthMm: d.size.widthMm, heightMm: d.size.heightMm } : effectiveSize(d, art);
    const phi = (d.rotationDeg * Math.PI) / 180;
    const w = Math.abs(widthMm * Math.cos(phi)) + Math.abs(heightMm * Math.sin(phi));
    const h = Math.abs(widthMm * Math.sin(phi)) + Math.abs(heightMm * Math.cos(phi));
    const zc = d.position.centerZMm;
    const rc = ctx.outerR(Math.min(Math.max(zc, 0), ctx.heightMm));
    if (w > 2 * Math.PI * rc * 0.95)
      errors.push({ code: "DECO_TOO_WIDE", message: `${d.name}: es más ancha que el contorno del jarro a esa altura (${Math.round(2 * Math.PI * rc)} mm). Reducí el ancho.`, field: decorationField(d.id, "widthMm") });
    if (zc + h / 2 > ctx.heightMm - SAFE_MARGIN_MM) warnings.push({ code: "DECO_NEAR_RIM", message: `${d.name}: está a menos de ${SAFE_MARGIN_MM} mm de la boca del jarro.`, field: decorationField(d.id, "centerZMm") });
    if (zc - h / 2 < SAFE_MARGIN_MM) warnings.push({ code: "DECO_NEAR_BASE", message: `${d.name}: está a menos de ${SAFE_MARGIN_MM} mm de la base.`, field: decorationField(d.id, "centerZMm") });
    if (ctx.handle) {
      const theta = semanticToTheta(d.position.angleDeg);
      let dth = theta % (2 * Math.PI);
      if (dth > Math.PI) dth -= 2 * Math.PI;
      else if (dth <= -Math.PI) dth += 2 * Math.PI;
      const across = Math.abs(dth) * rc; // el asa está en theta = 0
      const overlapsX = across < w / 2 + ctx.handle.halfWidthMm;
      const overlapsZ = [ctx.handle.zTop, ctx.handle.zBot].some((z) => Math.abs(z - zc) < h / 2 + ctx.handle!.halfHeightMm);
      if (overlapsX && overlapsZ) warnings.push({ code: "DECO_OVER_HANDLE", message: `${d.name}: parte de la decoración se superpone con la zona del asa.`, field: decorationField(d.id, "angleDeg") });
    }
  }
  return { errors, warnings };
}
