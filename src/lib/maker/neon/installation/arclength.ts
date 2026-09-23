// Caminador de longitud de arco sobre un NeonPath/NeonSegment. Usado por el
// planificador de cableado (punto de conexión de un loop cerrado), la geometría de
// pass-through (Etapa 3) y la separación de clips (Etapa 6). Es matemática de recorrido
// pura (sin Clipper, sin el motor de canal): la ubicación de features vive en 1D
// (longitud de arco), no en el sistema de zonas 2D de Carteles — Neon es fundamentalmente
// un recorrido, no una cavidad 2D.
import type { Point2D } from "@/lib/maker/types";

interface ArcSegment {
  a: Point2D;
  b: Point2D;
  /** Longitud de arco acumulada (mm) al llegar a `a` / `b`. */
  start: number;
  end: number;
}

export interface ArclengthTable {
  points: Point2D[];
  closed: boolean;
  segments: ArcSegment[];
  /** Longitud total (mm); en un path cerrado incluye el segmento de cierre. */
  totalMm: number;
}

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function buildArclengthTable(points: Point2D[], closed: boolean): ArclengthTable {
  const segments: ArcSegment[] = [];
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = dist(points[i], points[i + 1]);
    segments.push({ a: points[i], b: points[i + 1], start: acc, end: acc + len });
    acc += len;
  }
  if (closed && points.length > 1) {
    const len = dist(points[points.length - 1], points[0]);
    segments.push({ a: points[points.length - 1], b: points[0], start: acc, end: acc + len });
    acc += len;
  }
  return { points, closed, segments, totalMm: acc };
}

function unit(a: Point2D, b: Point2D): Point2D {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return len < 1e-9 ? [1, 0] : [dx / len, dy / len];
}

/**
 * Punto + tangente unitaria (dirección de avance) a longitud de arco `t` mm desde
 * `points[0]`. Envuelve (módulo `totalMm`) si `closed`; clampa a `[0, totalMm]` si
 * abierto. `t` fuera de rango nunca lanza.
 */
export function pointAtT(table: ArclengthTable, t: number): { point: Point2D; tangent: Point2D } {
  const { points, closed, segments, totalMm } = table;
  if (points.length === 0) return { point: [0, 0], tangent: [1, 0] };
  if (points.length === 1 || segments.length === 0) return { point: points[0], tangent: [1, 0] };
  let s: number;
  if (closed) {
    if (totalMm <= 1e-9) return { point: points[0], tangent: [1, 0] };
    s = ((t % totalMm) + totalMm) % totalMm;
  } else {
    s = Math.max(0, Math.min(totalMm, t));
  }
  for (const seg of segments) {
    if (s <= seg.end + 1e-9 || seg === segments[segments.length - 1]) {
      const len = seg.end - seg.start;
      const localT = len > 1e-9 ? Math.max(0, Math.min(1, (s - seg.start) / len)) : 0;
      const point: Point2D = [seg.a[0] + (seg.b[0] - seg.a[0]) * localT, seg.a[1] + (seg.b[1] - seg.a[1]) * localT];
      return { point, tangent: unit(seg.a, seg.b) };
    }
  }
  const last = segments[segments.length - 1];
  return { point: last.b, tangent: unit(last.a, last.b) };
}

/** Fracción [0,1) de longitud de arco correspondiente a `t` mm (envolviendo si closed). */
export function tToFraction(table: ArclengthTable, t: number): number {
  if (table.totalMm <= 1e-9) return 0;
  const s = table.closed ? ((t % table.totalMm) + table.totalMm) % table.totalMm : Math.max(0, Math.min(table.totalMm, t));
  return s / table.totalMm;
}

export interface Interval {
  t0: number;
  t1: number;
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.t0 <= b.t1 && b.t0 <= a.t1;
}

/** Si `want` no se superpone a ninguno de `reserved`, lo agrega y devuelve true; si se superpone, no modifica `reserved` y devuelve false. */
export function reserveInterval(reserved: Interval[], want: Interval): boolean {
  for (const r of reserved) {
    if (intervalsOverlap(r, want)) return false;
  }
  reserved.push(want);
  return true;
}
