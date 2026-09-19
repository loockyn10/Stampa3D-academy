import type { Point2D } from "@/lib/maker/types";
import type { CurvatureReport, NeonPath } from "@/lib/maker/neon/types";

/** Solo se avisa si el radio medido es claramente menor que el configurado (margen para no dar falsos positivos por el aplanado). */
const BELOW_FACTOR = 0.85;

/** Radio de la circunferencia por 3 puntos. Infinity si son colineales. */
function circumradius(a: Point2D, b: Point2D, c: Point2D): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (cross < 1e-9) return Infinity;
  return (ab * bc * ca) / (2 * cross);
}

/** Punto a distancia `s` (longitud de arco) desde el vértice `i`, hacia adelante (dir=1) o atrás (dir=-1). null si el path abierto se termina antes. */
function pointAtArc(pts: Point2D[], i: number, s: number, dir: 1 | -1, closed: boolean): Point2D | null {
  const n = pts.length;
  let remaining = s;
  let idx = i;
  let cur = pts[i];
  const limit = closed ? n * 2 : n;
  for (let step = 0; step < limit; step++) {
    let next = idx + dir;
    if (closed) next = (next + n) % n;
    else if (next < 0 || next >= n) return null;
    const p = pts[next];
    const seg = Math.hypot(p[0] - cur[0], p[1] - cur[1]);
    if (seg >= remaining) {
      const t = seg === 0 ? 0 : remaining / seg;
      return [cur[0] + (p[0] - cur[0]) * t, cur[1] + (p[1] - cur[1]) * t];
    }
    remaining -= seg;
    cur = p;
    idx = next;
  }
  return null;
}

/**
 * Estima el radio de curvatura mínimo del recorrido. En cada vértice se toma la
 * circunferencia que pasa por él y por los puntos a `s` mm de arco hacia atrás
 * y hacia adelante (`s` proporcional al radio mínimo configurado). En un arco
 * suave el resultado es el radio real; en una esquina viva, un radio chico. Es
 * una ESTIMACIÓN por muestreo: no promete precisión submilimétrica.
 */
export function analyzeCurvature(paths: NeonPath[], minBendRadiusMm: number): CurvatureReport {
  const s = Math.max(1, minBendRadiusMm * 0.4);
  let minRadius = Infinity;
  for (const path of paths) {
    const pts = path.points;
    if (pts.length < 3) continue;
    for (let i = 0; i < pts.length; i++) {
      if (!path.closed && (i === 0 || i === pts.length - 1)) continue;
      const before = pointAtArc(pts, i, s, -1, path.closed);
      const after = pointAtArc(pts, i, s, 1, path.closed);
      if (!before || !after) continue;
      const r = circumradius(before, pts[i], after);
      if (r < minRadius) minRadius = r;
    }
  }
  if (!Number.isFinite(minRadius)) return { minRadiusMm: null, belowMinimum: false };
  return { minRadiusMm: minRadius, belowMinimum: minRadius < minBendRadiusMm * BELOW_FACTOR };
}
