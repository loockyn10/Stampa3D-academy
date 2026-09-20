import type { Point2D } from "@/lib/maker/types";
import type { RasterSimplify } from "@/lib/maker/neon/raster/types";
import type { RawPath } from "@/lib/maker/neon/raster/traceSkeletonPaths";

/** Tolerancia de Ramer–Douglas–Peucker en px de trabajo. Baja/media/alta. */
export const SIMPLIFY_EPSILON_PX: Record<RasterSimplify, number> = { low: 0.6, medium: 1.3, high: 2.6 };

function distToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** RDP iterativo (sin recursión: los recorridos pueden tener miles de puntos). Conserva siempre el primero y el último. */
export function rdp(pts: readonly Point2D[], eps: number): Point2D[] {
  const n = pts.length;
  if (n <= 2 || eps <= 0) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > eps) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Simplifica un recorrido. Los extremos (extremos libres y bifurcaciones) se conservan exactamente, así que los paths que
 * se tocaban siguen tocándose. Un cerrado se parte en su punto más lejano al primero (dos mitades) para no perder el lazo.
 */
export function simplifyRawPath(path: RawPath, eps: number): RawPath {
  if (!path.closed) return { pts: rdp(path.pts, eps), closed: false };
  const pts = path.pts;
  let far = 0, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp([...pts.slice(far), pts[0]], eps);
  const merged = [...a, ...b.slice(1, -1)];
  return { pts: merged.length >= 3 ? merged : pts, closed: true };
}

export function simplifyRawPaths(paths: RawPath[], level: RasterSimplify): RawPath[] {
  const eps = SIMPLIFY_EPSILON_PX[level];
  return paths.map((p) => simplifyRawPath(p, eps));
}
