import * as ClipperLib from "clipper-lib";
import type { NeonPath } from "@/lib/maker/neon/types";

// Misma grilla que geometry/offsets.ts (0.0001 mm): Clipper trabaja en enteros.
const CLIPPER_SCALE = 10000;
/** Error máximo de aproximación de los arcos redondos (mm). */
const ARC_TOLERANCE_MM = 0.02;

/**
 * "Buffer" (stroke) de un conjunto de recorridos: la región a distancia <=
 * `radiusMm` de algún recorrido. Un único ClipperOffset con todos los paths, así
 * que Clipper resuelve la unión: canales que se cruzan o se solapan quedan
 * fundidos en una sola región (sin paredes internas duplicadas) y un path que se
 * cruza a sí mismo se une correctamente.
 *
 *  - path ABIERTO: `etOpenRound` -> tapas redondas en los extremos.
 *  - path CERRADO: `etClosedLine` -> anillo alrededor del lazo, sin tapas.
 *  - esquinas: `jtRound` (nunca picos de inglete).
 *
 * Devuelve paths crudos de Clipper (enteros escalados), exterior y huecos
 * mezclados; usar `regroupClipperSolution` para agruparlos.
 */
export function bufferNeonPaths(paths: NeonPath[], radiusMm: number): ClipperLib.Paths {
  if (paths.length === 0 || radiusMm <= 0) return [];
  const offset = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE_MM * CLIPPER_SCALE);
  for (const path of paths) {
    const clipperPath: ClipperLib.Path = path.points.map(([x, y]) => ({ X: Math.round(x * CLIPPER_SCALE), Y: Math.round(y * CLIPPER_SCALE) }));
    offset.AddPath(clipperPath, ClipperLib.JoinType.jtRound, path.closed ? ClipperLib.EndType.etClosedLine : ClipperLib.EndType.etOpenRound);
  }
  const solution: ClipperLib.Paths = [];
  offset.Execute(solution, radiusMm * CLIPPER_SCALE);
  return solution;
}
