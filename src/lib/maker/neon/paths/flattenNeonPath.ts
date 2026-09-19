import type { Point2D } from "@/lib/maker/types";
import type { NeonPath } from "@/lib/maker/neon/types";
import { flattenSubPath, type SubPath } from "@/lib/maker/import/svgGeometry";

/** Tolerancia de aplanado de curvas en mm: bien por debajo del ancho de línea de una boquilla de 0.4 mm. */
export const FLATTEN_TOLERANCE_MM = 0.05;
/** Puntos consecutivos más cerca que esto (mm) se fusionan: evitan segmentos degenerados en el offset. */
export const MIN_POINT_SPACING_MM = 0.02;

/** Aplana un subpath (curvas -> segmentos) con tolerancia en las unidades del subpath. Devuelve null si no queda un recorrido utilizable. */
export function flattenSubPathToPoints(sub: SubPath, tolerance: number): Point2D[] {
  return flattenSubPath(sub, tolerance);
}

/** Quita duplicados/casi-duplicados y valida el mínimo de puntos. Un "cerrado" con menos de 3 puntos distintos se degrada a abierto. */
export function cleanNeonPath(points: Point2D[], closed: boolean, minSpacingMm = MIN_POINT_SPACING_MM): NeonPath | null {
  const out: Point2D[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minSpacingMm) out.push(p);
  }
  if (closed) {
    while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < minSpacingMm) out.pop();
    if (out.length < 3) return out.length >= 2 ? { points: out, closed: false } : null;
    return { points: out, closed: true };
  }
  return out.length >= 2 ? { points: out, closed: false } : null;
}

export interface PointBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function pathsBounds(paths: NeonPath[]): PointBounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) {
    for (const [x, y] of path.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * Lleva los paths a mm: escala uniforme `scale`, opcionalmente invirtiendo Y
 * (SVG tiene Y hacia abajo), y traslada para que la caja quede con su esquina
 * mínima en (0, 0). `originY`/`originX` permiten fijar el origen a algo distinto
 * de la caja (p.ej. la línea base del texto).
 */
export function scaleToMm(
  paths: NeonPath[],
  scale: number,
  opts: { flipY: boolean; originX?: number; originY?: number },
): NeonPath[] {
  const src = pathsBounds(paths);
  if (!src) return [];
  const sy = opts.flipY ? -1 : 1;
  // Bounds en el espacio ya transformado, para poder fijar el origen.
  const yA = src.minY * sy, yB = src.maxY * sy;
  const minX = opts.originX ?? src.minX;
  const minY = opts.originY ?? Math.min(yA, yB);
  const scaled: NeonPath[] = [];
  for (const path of paths) {
    const pts = path.points.map(([x, y]) => [(x - minX) * scale, (y * sy - minY) * scale] as Point2D);
    const cleaned = cleanNeonPath(pts, path.closed);
    if (cleaned) scaled.push(cleaned);
  }
  return scaled;
}
