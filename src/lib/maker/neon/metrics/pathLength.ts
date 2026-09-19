import { NEON_LENGTH_MARGIN } from "@/lib/maker/neon/defaults";
import type { NeonPath } from "@/lib/maker/neon/types";

/** Longitud (mm) de un centerline. En un path cerrado incluye el segmento de cierre. */
export function neonPathLength(path: NeonPath): number {
  const pts = path.points;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (path.closed && pts.length > 2) {
    total += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  }
  return total;
}

/** Suma de todos los recorridos, ANTES del offset (es lo que consume el Neon Flex). */
export function totalNeonLength(paths: NeonPath[]): number {
  return paths.reduce((sum, p) => sum + neonPathLength(p), 0);
}

/** Longitud a comprar: recorrido + margen fijo del 5 % (todavía no configurable). */
export function recommendedNeonLength(lengthMm: number): number {
  return lengthMm * (1 + NEON_LENGTH_MARGIN);
}
