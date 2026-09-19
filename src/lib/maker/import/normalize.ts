import * as ClipperLib from "clipper-lib";
import type { ContourGroup, Point2D } from "@/lib/maker/types";
import { DesignImportError, IMPORT_LIMITS, type ImportedDesign, type RawDesign } from "@/lib/maker/import/types";
import { cleanContourGroups, regroupClipperSolution, contourGroupsToRawPaths, pointsToRawPath, clipperPathsArea } from "@/lib/maker/geometry/offsets";

/** Grupos por debajo de esta área (mm²) son ruido numérico, no material imprimible. */
const MIN_GROUP_AREA_MM2 = 0.0025;

/**
 * Etapa 2 (común a SVG y PNG): formas crudas (unidades de la fuente, Y hacia
 * abajo) -> `ContourGroup[]` en mm, Y hacia arriba, con el mínimo en (0,0) y
 * `heightMm` de alto (escala UNIFORME: el aspect ratio nunca se deforma).
 *
 * Es la ÚNICA frontera entre importación y motor Maker: después de esto el
 * motor no sabe si la forma era texto, SVG o PNG.
 *
 * Unión: cada forma se resuelve con su propia regla de relleno (evenodd/
 * nonzero) y después todas se unen (nonzero) — formas solapadas producen UN
 * solo sólido, no shells duplicados. Los counters salen de la jerarquía par/
 * impar de `regroupClipperSolution` (exterior + huecos, nunca sólidos
 * independientes); las islas desconectadas quedan como grupos separados, sin
 * puentes, en sus posiciones relativas originales.
 */
export function normalizeRawDesign(raw: RawDesign, heightMm: number, sourceType: "svg" | "png", fileName: string): ImportedDesign {
  const emptyCode = sourceType === "svg" ? "SVG_EMPTY" : "TRACE_EMPTY";
  const emptyMsg =
    sourceType === "svg"
      ? "El SVG no tiene formas rellenas utilizables."
      : "No se detectó ninguna forma en la imagen. Probá ajustar el umbral, invertir, o usar un PNG con fondo transparente.";

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of raw.shapes) {
    for (const path of s.paths) {
      for (const [x, y] of path) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX)) throw new DesignImportError(emptyCode, emptyMsg);

  const srcHeight = maxY - minY;
  if (!(srcHeight > 1e-9) || !(heightMm > 0)) {
    throw new DesignImportError("COLLAPSED", "La forma no tiene altura (es una línea o un punto): no se puede escalar a un alto en mm.");
  }
  const scale = heightMm / srcHeight;
  const toMm = (p: Point2D): Point2D => [(p[0] - minX) * scale, (maxY - p[1]) * scale];

  const regions: ClipperLib.Paths = [];
  for (const shape of raw.shapes) {
    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(shape.paths.map((p) => pointsToRawPath(p.map(toMm))), ClipperLib.PolyType.ptSubject, true);
    const solution: ClipperLib.Paths = [];
    const fill = shape.fillRule === "evenodd" ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero;
    clipper.Execute(ClipperLib.ClipType.ctUnion, solution, fill, fill);
    regions.push(...solution);
  }

  // Unión final de todas las formas (nonzero): los huecos de una forma
  // (winding opuesto) se conservan, las superposiciones se funden.
  const union = new ClipperLib.Clipper();
  union.AddPaths(regions, ClipperLib.PolyType.ptSubject, true);
  const merged: ClipperLib.Paths = [];
  union.Execute(ClipperLib.ClipType.ctUnion, merged, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  let groups: ContourGroup[] = cleanContourGroups(regroupClipperSolution(merged));
  groups = groups.filter((g) => Math.abs(clipperPathsArea(contourGroupsToRawPaths([g]))) >= MIN_GROUP_AREA_MM2 && g.outer.length >= 3);
  if (groups.length === 0) throw new DesignImportError(emptyCode, emptyMsg);

  // Re-anclar en (0,0) tras la limpieza (la unión/limpieza puede mover el mínimo unos micrones).
  let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
  for (const g of groups) {
    for (const [x, y] of g.outer) {
      if (x < gMinX) gMinX = x;
      if (x > gMaxX) gMaxX = x;
      if (y < gMinY) gMinY = y;
      if (y > gMaxY) gMaxY = y;
    }
  }
  const shift = (ring: Point2D[]): Point2D[] => ring.map(([x, y]) => [x - gMinX, y - gMinY] as Point2D);
  groups = groups.map((g) => ({ outer: shift(g.outer), holes: g.holes.map(shift) }));

  const vertices = groups.reduce((s, g) => s + g.outer.length + g.holes.reduce((a, h) => a + h.length, 0), 0);
  if (vertices > IMPORT_LIMITS.maxVertices) {
    throw new DesignImportError("TOO_COMPLEX", "El diseño es demasiado complejo (demasiados puntos). Usá un archivo más simple o menos detalle.");
  }

  return {
    sourceType,
    fileName,
    contourGroups: groups,
    widthMm: gMaxX - gMinX,
    heightMm: gMaxY - gMinY,
    warnings: raw.warnings,
    pngMode: raw.pngMode,
  };
}
