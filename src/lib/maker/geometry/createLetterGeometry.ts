import type * as opentype from "opentype.js";
import type { ContourGroup, LetterGeometryResult, LetterGeometryWarning, LetterSignParams, Point2D } from "@/lib/maker/types";
import { textToOpentypePath, flattenOpentypePath } from "@/lib/maker/geometry/textToPaths";
import { buildContourHierarchy } from "@/lib/maker/geometry/contourHierarchy";
import { insetContourGroups, differenceContourGroups, clipperPathsArea } from "@/lib/maker/geometry/offsets";
import { extrudeContourGroups } from "@/lib/maker/geometry/extrudePolygon";

/**
 * Pipeline completo: texto + parámetros -> mesh 3D triangulado. El sólido
 * final es la unión de dos piezas totalmente cerradas (fondo + pared), cada
 * una respetando los huecos del glifo como anillo; el counter/cavidad nunca
 * recibe geometría en ningún nivel de Z, así que queda libre en toda la
 * profundidad sin que eso rompa el manifold de ninguna pieza. Ver
 * docs/STAMPA_MAKER.md para el detalle del pipeline.
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
    // El fondo respeta los huecos del glifo (anillo, no disco): así el
    // counter queda completamente libre en toda la profundidad, no solo en
    // el tramo de la pared. Ver docs/STAMPA_MAKER.md.
    fondoGroups.push({ outer: group.outer, holes: group.holes });

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

  // La huella de la pared ya es un anillo delgado (ink shape menos su
  // erosión hacia adentro): taparla en ambos extremos le da espesor real
  // visible en la punta sin cubrir el hueco, porque earcut nunca triangula
  // el interior del hueco (llega como holeIndices, no como área rellena).
  const wallHeight = params.depthMm - params.baseMm;
  const walls = wallHeight > 0
    ? extrudeContourGroups(wallGroups, params.baseMm, params.depthMm, { capStart: true, capEnd: true })
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
