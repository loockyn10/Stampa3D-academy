// Posición automática de clips de pared a lo largo de un NeonSegment (Secciones 35-37
// del pedido de Instalación 0.3): camina por longitud de arco, coloca candidatos cada
// `spacingMm` (+ uno extra cerca de cada extremo), evita zonas reservadas (pass-through,
// unión de puente — pasadas por el llamador como intervalos 1D, este módulo no sabe
// nada de su geometría concreta) y curvas demasiado cerradas (radio local estimado por
// muestreo, mismo criterio que `metrics/curvature.ts`). Si un candidato no es válido,
// busca el próximo mejor cerca antes de descartarlo.
import type { Point2D } from "@/lib/maker/types";
import type { NeonIssue } from "@/lib/maker/neon/types";
import type { NeonSegment } from "@/lib/maker/neon/installation/segments";
import { buildArclengthTable, intervalsOverlap, pointAtT, type Interval } from "@/lib/maker/neon/installation/arclength";

export interface NeonClipPlacementSettings {
  /** Separación objetivo entre clips (mm), sugerida 80-120, default 100. */
  spacingMm: number;
  /** Cuánto del largo del canal ocupa un clip (mm) — su propio intervalo reservado. */
  clipDepthMm: number;
  /** Radio local por debajo del cual se considera "curva cerrada" y se evita. */
  minCurvatureRadiusMm: number;
  /** Margen desde cada extremo del segmento para el primer/último clip. */
  edgeMarginMm: number;
}

export const DEFAULT_CLIP_PLACEMENT_SETTINGS: NeonClipPlacementSettings = {
  spacingMm: 100,
  clipDepthMm: 10,
  minCurvatureRadiusMm: 15,
  edgeMarginMm: 20,
};

const SEARCH_STEP_MM = 2;

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Radio de la circunferencia por 3 puntos; Infinity si son colineales (recta, sin curvatura). */
function circumradius(a: Point2D, b: Point2D, c: Point2D): number {
  const ab = dist(a, b);
  const bc = dist(b, c);
  const ca = dist(c, a);
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (cross < 1e-9) return Infinity;
  return (ab * bc * ca) / (2 * cross);
}

function localRadiusAtT(table: ReturnType<typeof buildArclengthTable>, t: number, probeMm: number): number {
  const before = pointAtT(table, t - probeMm).point;
  const at = pointAtT(table, t).point;
  const after = pointAtT(table, t + probeMm).point;
  return circumradius(before, at, after);
}

function isValidCandidate(table: ReturnType<typeof buildArclengthTable>, t: number, settings: NeonClipPlacementSettings, reserved: Interval[]): boolean {
  const want: Interval = { t0: t - settings.clipDepthMm / 2, t1: t + settings.clipDepthMm / 2 };
  if (reserved.some((r) => intervalsOverlap(r, want))) return false;
  const probe = Math.max(1, settings.minCurvatureRadiusMm * 0.4);
  const radius = localRadiusAtT(table, t, probe);
  return !(Number.isFinite(radius) && radius < settings.minCurvatureRadiusMm);
}

/** Busca el candidato válido más cercano a `target` (probando +-2mm, +-4mm, ...) dentro de `limitMm`; null si no hay ninguno. */
function findValidNear(
  table: ReturnType<typeof buildArclengthTable>,
  target: number,
  settings: NeonClipPlacementSettings,
  reserved: Interval[],
  limitMm: number,
): number | null {
  if (isValidCandidate(table, target, settings, reserved)) return target;
  for (let d = SEARCH_STEP_MM; d <= limitMm; d += SEARCH_STEP_MM) {
    if (isValidCandidate(table, target + d, settings, reserved)) return target + d;
    if (isValidCandidate(table, target - d, settings, reserved)) return target - d;
  }
  return null;
}

function generateTargets(totalMm: number, closed: boolean, settings: NeonClipPlacementSettings): number[] {
  if (closed) {
    const targets: number[] = [];
    for (let t = 0; t < totalMm - 1e-6; t += settings.spacingMm) targets.push(t);
    return targets.length > 0 ? targets : [0];
  }
  const margin = Math.min(settings.edgeMarginMm, Math.max(0, totalMm / 2 - 1e-6));
  if (totalMm <= 2 * margin) return [totalMm / 2];
  const targets: number[] = [];
  for (let t = margin; t <= totalMm - margin + 1e-6; t += settings.spacingMm) targets.push(Math.min(t, totalMm - margin));
  const last = targets[targets.length - 1];
  if (totalMm - margin - last > settings.spacingMm / 2) targets.push(totalMm - margin);
  return targets;
}

export interface NeonClipPlanResult {
  positions: number[];
  issue: NeonIssue | null;
}

/** Posiciones (mm de longitud de arco) de los clips de UN segmento. `reserved` son intervalos a evitar (pass-through, unión de puente), YA con el margen que el llamador quiera. */
export function planClipPositionsForSegment(segment: NeonSegment, settings: NeonClipPlacementSettings, reserved: Interval[] = []): NeonClipPlanResult {
  const table = buildArclengthTable(segment.points, segment.closed);
  if (table.totalMm <= 1e-6) return { positions: [], issue: null };
  const targets = generateTargets(table.totalMm, segment.closed, settings);
  const searchLimit = settings.spacingMm / 2;
  const positions: number[] = [];
  for (const target of targets) {
    const last = positions[positions.length - 1];
    const avoidPrev: Interval[] = last === undefined ? [] : [{ t0: last - settings.clipDepthMm, t1: last + settings.clipDepthMm }];
    const found = findValidNear(table, target, settings, [...reserved, ...avoidPrev], searchLimit);
    if (found !== null) positions.push(found);
  }
  const issue: NeonIssue | null =
    positions.length === 0
      ? { code: "NEON_CLIP_NO_SPACE", message: `No se encontró una posición válida para un clip de pared en el segmento ${segment.id}.` }
      : null;
  return { positions, issue };
}

/** Igual que `planClipPositionsForSegment`, para todos los segmentos. */
export function planClipPositions(
  segments: NeonSegment[],
  settings: NeonClipPlacementSettings,
  reservedBySegment: Map<string, Interval[]> = new Map(),
): { positions: Map<string, number[]>; issues: NeonIssue[] } {
  const positions = new Map<string, number[]>();
  const issues: NeonIssue[] = [];
  for (const segment of segments) {
    const result = planClipPositionsForSegment(segment, settings, reservedBySegment.get(segment.id) ?? []);
    positions.set(segment.id, result.positions);
    if (result.issue) issues.push(result.issue);
  }
  return { positions, issues };
}
