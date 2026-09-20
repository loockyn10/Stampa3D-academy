/** Utilidades de recorridos planos (x = radial, z = vertical) y sus marcos de barrido. */
export type P2 = readonly [number, number];

const len = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Redondea cada esquina interior de una polilínea con una curva cuadrática de radio `radius` (acotado a la mitad de cada tramo). */
export function roundedPolyline(pts: P2[], radius: number, arcSteps = 8): P2[] {
  if (pts.length < 3) return pts.slice();
  const out: P2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const r = Math.min(radius, len(a, b) / 2, len(b, c) / 2);
    const da = len(a, b), dc = len(b, c);
    const p0: P2 = [b[0] + ((a[0] - b[0]) * r) / da, b[1] + ((a[1] - b[1]) * r) / da];
    const p2: P2 = [b[0] + ((c[0] - b[0]) * r) / dc, b[1] + ((c[1] - b[1]) * r) / dc];
    for (let s = 0; s <= arcSteps; s++) {
      const t = s / arcSteps, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function cubicBezier(p0: P2, p1: P2, p2: P2, p3: P2, n = 48): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    out.push([w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0], w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1]]);
  }
  return out;
}

export function polylineLength(pts: P2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += len(pts[i - 1], pts[i]);
  return l;
}

/** Remuestrea a paso uniforme por longitud de arco, incluyendo SIEMPRE los dos extremos. */
export function resamplePolyline(pts: P2[], stepMm: number): P2[] {
  const total = polylineLength(pts);
  const n = Math.max(6, Math.ceil(total / stepMm));
  const out: P2[] = [pts[0]];
  let seg = 1, acc = 0;
  for (let k = 1; k < n; k++) {
    const target = (total * k) / n;
    while (seg < pts.length - 1 && acc + len(pts[seg - 1], pts[seg]) < target) {
      acc += len(pts[seg - 1], pts[seg]);
      seg++;
    }
    const l = len(pts[seg - 1], pts[seg]) || 1;
    const t = (target - acc) / l;
    out.push([pts[seg - 1][0] + (pts[seg][0] - pts[seg - 1][0]) * t, pts[seg - 1][1] + (pts[seg][1] - pts[seg - 1][1]) * t]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export type V3 = [number, number, number];

/** Marco del barrido en un punto: Y = (0,1,0) fijo, T = tangente en el plano XZ, N = T girada 90° en ese plano. */
export interface PathFrame {
  c: V3;
  t: V3;
  n: V3;
  y: V3;
  /** Longitud de arco desde el inicio. */
  s: number;
}

/** Marcos a lo largo de un recorrido plano en el plano XZ (y = 0). El marco es exacto: sin torsión (el recorrido es plano). */
export function pathFrames(pts: P2[]): PathFrame[] {
  const frames: PathFrame[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += len(pts[i - 1], pts[i]);
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l;
    frames.push({ c: [pts[i][0], 0, pts[i][1]], t: [tx, 0, tz], n: [-tz, 0, tx], y: [0, 1, 0], s });
  }
  return frames;
}
