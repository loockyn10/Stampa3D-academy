import type { Point2D } from "@/lib/maker/types";
import type { RawPath } from "@/lib/maker/neon/raster/traceSkeletonPaths";
import { rdp } from "@/lib/maker/neon/raster/simplifyNeonPaths";

/** Separación (px de trabajo) a la que se re-muestrea un recorrido antes de suavizarlo. */
const RESAMPLE_SPACING_PX = 2;
const LAMBDA = 0.5;
const MU = -0.53;
/** Iteraciones Taubin para smoothing = 100. */
const MAX_ITERATIONS = 30;

/** Re-muestrea a paso constante a lo largo del arco (conserva primer y último punto en abiertos). */
export function resamplePolyline(pts: readonly Point2D[], closed: boolean, spacing: number): Point2D[] {
  const src = closed ? [...pts, pts[0]] : pts.slice();
  let total = 0;
  const cum = [0];
  for (let i = 1; i < src.length; i++) {
    total += Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]);
    cum.push(total);
  }
  if (total === 0) return pts.slice();
  const count = Math.max(closed ? 6 : 2, Math.round(total / spacing) + (closed ? 0 : 1));
  const out: Point2D[] = [];
  let seg = 1;
  const n = closed ? count : count - 1;
  for (let k = 0; k < count; k++) {
    const target = closed ? (k / count) * total : (k / n) * total;
    while (seg < src.length - 1 && cum[seg] < target) seg++;
    const t = (target - cum[seg - 1]) / (cum[seg] - cum[seg - 1] || 1);
    out.push([src[seg - 1][0] + (src[seg][0] - src[seg - 1][0]) * t, src[seg - 1][1] + (src[seg][1] - src[seg - 1][1]) * t]);
  }
  if (!closed) out[out.length - 1] = [src[src.length - 1][0], src[src.length - 1][1]];
  return out;
}

function laplacianStep(pts: Point2D[], closed: boolean, factor: number): Point2D[] {
  const n = pts.length;
  const out: Point2D[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      out[i] = pts[i]; // extremos fijos: extremos libres y bifurcaciones no se mueven
      continue;
    }
    const p = pts[(i - 1 + n) % n], q = pts[(i + 1) % n];
    out[i] = [pts[i][0] + factor * ((p[0] + q[0]) / 2 - pts[i][0]), pts[i][1] + factor * ((p[1] + q[1]) / 2 - pts[i][1])];
  }
  return out;
}

/**
 * Suavizado de un recorrido ya trazado (Taubin λ|μ sobre el recorrido re-muestreado). A diferencia de un promedio móvil o
 * Chaikin, alterna un paso de suavizado con uno de expansión: no encoge los círculos ni los lazos. Los extremos de los
 * paths abiertos quedan FIJOS (extremos libres y bifurcaciones), así que dos paths que se tocaban siguen tocándose; los
 * cerrados siguen cerrados. `strength` 0-100 (0 = sin cambios).
 */
export function smoothRawPath(path: RawPath, strength: number): RawPath {
  if (strength <= 0 || path.pts.length < 3) return path;
  const iterations = Math.round((Math.min(100, strength) / 100) * MAX_ITERATIONS);
  if (iterations === 0) return path;
  let pts = resamplePolyline(path.pts, path.closed, RESAMPLE_SPACING_PX);
  if (pts.length < 3) return path;
  for (let i = 0; i < iterations; i++) {
    pts = laplacianStep(pts, path.closed, LAMBDA);
    pts = laplacianStep(pts, path.closed, MU);
  }
  // El re-muestreo denso no hace falta después: se vuelve a aligerar sin tocar la forma visible (0.2 px).
  const light = path.closed ? pts : rdp(pts, 0.2);
  return { pts: light, closed: path.closed };
}

export function smoothRawPaths(paths: RawPath[], strength: number): RawPath[] {
  return paths.map((p) => smoothRawPath(p, strength));
}
