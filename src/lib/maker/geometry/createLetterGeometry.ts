import type * as opentype from "opentype.js";
import type { ContourGroup, LetterGeometryResult, LetterGeometryWarning, LetterSignParams, Point2D } from "@/lib/maker/types";
import { textToOpentypePath, flattenOpentypePath } from "@/lib/maker/geometry/textToPaths";
import { buildContourHierarchy } from "@/lib/maker/geometry/contourHierarchy";
import { insetContourGroups, differenceContourGroups, clipperPathsArea } from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups } from "@/lib/maker/geometry/extrudePolygon";

/**
 * Pipeline completo: texto + parámetros -> mesh 3D triangulado (fondo cerrado
 * + paredes huecas, frente abierto). Ver /docs para el detalle del pipeline.
 */
export function createLetterGeometry(font: opentype.Font, params: LetterSignParams): LetterGeometryResult {
  const warnings: LetterGeometryWarning[] = [];

  if (!params.text || params.text.trim().length === 0) {
    warnings.push({ code: "EMPTY_TEXT", message: "Escribí un texto para generar el modelo." });
    return emptyResult(warnings);
  }

  const path = textToOpentypePath(font, params.text, params.heightMm);
  const rawContours = flattenOpentypePath(path);

  if (rawContours.length === 0) {
    warnings.push({ code: "NO_GLYPHS", message: "El texto no contiene glifos imprimibles (¿solo espacios?)." });
    return emptyResult(warnings);
  }

  const contourGroups = buildContourHierarchy(rawContours);

  const fondoGroups: ContourGroup[] = [];
  const wallGroups: ContourGroup[] = [];
  let anyFullyEroded = false;

  for (const group of contourGroups) {
    fondoGroups.push({ outer: group.outer, holes: [] });

    const insetPaths = insetContourGroups([group], params.wallMm);
    const insetArea = Math.abs(clipperPathsArea(insetPaths));
    if (insetArea < 1e-4) anyFullyEroded = true;

    wallGroups.push(...differenceContourGroups([group], insetPaths));
  }

  if (anyFullyEroded) {
    warnings.push({
      code: "WALL_TOO_THICK",
      message: "El espesor de pared es demasiado grande para el tamaño del texto: algunos trazos quedaron macizos en vez de huecos.",
    });
  }

  const fondo = extrudeContourGroups(fondoGroups, 0, params.baseMm, { capStart: true, capEnd: true });

  const wallHeight = params.depthMm - params.baseMm;
  const walls = wallHeight > 0
    ? extrudeContourGroups(wallGroups, params.baseMm, params.depthMm, { capStart: true, capEnd: false })
    : { positions: [] as number[], normals: [] as number[] };

  const positions = Float32Array.from([...fondo.positions, ...walls.positions]);
  const normals = Float32Array.from([...fondo.normals, ...walls.normals]);

  return {
    positions,
    normals,
    triangleCount: positions.length / 9,
    boundingBox: computeBoundingBox(rawContours, params.depthMm),
    warnings,
  };
}

function emptyResult(warnings: LetterGeometryWarning[]): LetterGeometryResult {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    triangleCount: 0,
    boundingBox: { width: 0, height: 0, depth: 0 },
    warnings,
  };
}

function computeBoundingBox(contours: Point2D[][], depthMm: number): { width: number; height: number; depth: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const contour of contours) {
    for (const [x, y] of contour) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { width: maxX - minX, height: maxY - minY, depth: depthMm };
}
