// Planificador de cableado Neon (Secciones 4-5, 9-12 del pedido de Instalación 0.3).
//
// Corrección conceptual respecto del modelo de Carteles: Carteles cablea N letras como
// N redes eléctricas PARALELAS independientes (cada letra empalma IN+/LED+/OUT+ en un
// nodo común). Neon es distinto: es UNA sola tira LED flexible continua, cortada en
// N segmentos físicos. Dentro de un segmento no hay empalme en T — las mismas dos vías
// de cobre de la tira corren IN->OUT en serie física — y el jumper entre dos segmentos
// extiende esas mismas dos vías. El resultado sigue siendo la misma condición de
// aceptación (exactamente un bus + y un bus -, nunca en corto), pero el modelo de
// terminales es más simple: 2 por segmento (IN/OUT), no 6.
//
// El orden y la orientación (IN/OUT por extremo) se resuelven con un planificador
// nearest-neighbor + 2-opt acotado sobre los extremos de cada segmento (cada segmento
// abierto aporta 2 orientaciones posibles = invertible; uno cerrado aporta 1, en su
// `connectionAnchorT`). Es determinístico y busca un resultado razonable, NO óptimo
// (no hace falta TSP perfecto).
import type { Point2D } from "@/lib/maker/types";
import type { NeonSegment } from "@/lib/maker/neon/installation/segments";
import { buildArclengthTable, pointAtT } from "@/lib/maker/neon/installation/arclength";
import { UnionFind } from "@/lib/maker/unionFind";

export interface NeonSegmentWiring {
  segmentId: string;
  /** Posición 0-based en el orden físico/eléctrico. */
  order: number;
  isFirst: boolean;
  isLast: boolean;
  /** El primer segmento recibe la alimentación. */
  hasPowerIn: boolean;
  /** Todos menos el último tienen salida hacia el siguiente. */
  hasOut: boolean;
  /** true si IN/OUT quedaron invertidos respecto de la orientación natural del NeonPath (start=IN/end=OUT). Sin efecto en segmentos cerrados. */
  inverted: boolean;
}

export interface NeonJumper {
  fromSegmentId: string;
  toSegmentId: string;
  fromPoint: Point2D;
  toPoint: Point2D;
  /** Distancia recta entre los puntos de conexión (mm). */
  distanceMm: number;
  /** distanceMm + margen de servicio (mm). */
  lengthMm: number;
}

export interface NeonWiringPlan {
  /** Ids de segmento en orden físico/eléctrico. */
  order: string[];
  segments: NeonSegmentWiring[];
  jumpers: NeonJumper[];
  /** Suma de lengthMm de todos los jumpers. */
  totalCableMm: number;
}

interface TourNode {
  segmentId: string;
  inverted: boolean;
}

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function segmentIdNumber(id: string): number {
  const m = /^N(\d+)$/.exec(id);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

function compareSegmentIds(a: string, b: string): number {
  const byNumber = segmentIdNumber(a) - segmentIdNumber(b);
  if (byNumber !== 0) return byNumber;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Punto de entrada/salida de un segmento según su orientación. Un segmento cerrado usa su `connectionAnchorT` como único punto (entra y sale ahí). */
function terminalPoints(segment: NeonSegment, inverted: boolean): { entry: Point2D; exit: Point2D } {
  if (segment.closed) {
    const table = buildArclengthTable(segment.points, true);
    const anchorMm = (segment.connectionAnchorT ?? 0) * table.totalMm;
    const { point } = pointAtT(table, anchorMm);
    return { entry: point, exit: point };
  }
  const start = segment.start!.point;
  const end = segment.end!.point;
  return inverted ? { entry: end, exit: start } : { entry: start, exit: end };
}

/** Candidatos (id, orientación) restantes ordenados por distancia al punto de salida actual; empate -> no invertido, luego id numérico. */
function pickNearest(byId: Map<string, NeonSegment>, remaining: Set<string>, currentExit: Point2D): TourNode {
  const candidates: (TourNode & { d: number })[] = [];
  for (const id of remaining) {
    const seg = byId.get(id)!;
    const options = seg.closed ? [false] : [false, true];
    for (const inverted of options) {
      const { entry } = terminalPoints(seg, inverted);
      candidates.push({ segmentId: id, inverted, d: dist(currentExit, entry) });
    }
  }
  candidates.sort((a, b) => {
    if (Math.abs(a.d - b.d) > 1e-9) return a.d - b.d;
    if (a.inverted !== b.inverted) return a.inverted ? 1 : -1;
    return compareSegmentIds(a.segmentId, b.segmentId);
  });
  const { d: _d, ...best } = candidates[0];
  return best;
}

/** Construcción nearest-neighbor: arranca en el segmento de menor id (orientación natural), agrega en cada paso el candidato (id, orientación) más cercano al punto de salida actual. */
function buildInitialTour(byId: Map<string, NeonSegment>, segments: NeonSegment[]): TourNode[] {
  const remaining = new Set(segments.map((s) => s.id));
  const startId = [...remaining].sort(compareSegmentIds)[0];
  remaining.delete(startId);
  const tour: TourNode[] = [{ segmentId: startId, inverted: false }];
  let currentExit = terminalPoints(byId.get(startId)!, false).exit;
  while (remaining.size > 0) {
    const next = pickNearest(byId, remaining, currentExit);
    remaining.delete(next.segmentId);
    tour.push(next);
    currentExit = terminalPoints(byId.get(next.segmentId)!, next.inverted).exit;
  }
  return tour;
}

function tourCost(byId: Map<string, NeonSegment>, tour: TourNode[]): number {
  let total = 0;
  for (let k = 0; k < tour.length - 1; k++) {
    const exit = terminalPoints(byId.get(tour[k].segmentId)!, tour[k].inverted).exit;
    const entry = terminalPoints(byId.get(tour[k + 1].segmentId)!, tour[k + 1].inverted).entry;
    total += dist(exit, entry);
  }
  return total;
}

/** Reversa tour[i..j] (inclusive); los segmentos abiertos interiores invierten su orientación (recorrer el sub-tramo al revés cambia cuál extremo queda de entrada/salida). Los cerrados no cambian (entrada=salida). */
function reverseRange(byId: Map<string, NeonSegment>, tour: TourNode[], i: number, j: number): TourNode[] {
  const next = tour.slice();
  const reversed = tour
    .slice(i, j + 1)
    .reverse()
    .map((node) => (byId.get(node.segmentId)!.closed ? node : { ...node, inverted: !node.inverted }));
  next.splice(i, reversed.length, ...reversed);
  return next;
}

/**
 * 2-opt acotado, first-improvement, determinístico: recorre pares (i,j) en orden fijo,
 * aplica la primera reversión que reduce el costo total y reinicia el barrido. Acotado a
 * min(200, N²) evaluaciones de par para mantenerse barato incluso en entradas patológicas
 * — no promete el óptimo, solo un resultado razonable y estable.
 */
function applyTwoOpt(byId: Map<string, NeonSegment>, initialTour: TourNode[]): TourNode[] {
  const n = initialTour.length;
  if (n < 3) return initialTour;
  const budget = Math.min(200, n * n);
  let current = initialTour;
  let currentCost = tourCost(byId, current);
  let checks = 0;
  let improved = true;
  while (improved && checks < budget) {
    improved = false;
    for (let i = 0; i < n - 1 && !improved && checks < budget; i++) {
      for (let j = i + 1; j < n && checks < budget; j++) {
        checks++;
        const candidate = reverseRange(byId, current, i, j);
        const cost = tourCost(byId, candidate);
        if (cost < currentCost - 1e-9) {
          current = candidate;
          currentCost = cost;
          improved = true;
          break;
        }
      }
    }
  }
  return current;
}

function buildPlanFromTour(byId: Map<string, NeonSegment>, tour: TourNode[], serviceMarginMm: number): NeonWiringPlan {
  const order = tour.map((node) => node.segmentId);
  const segments: NeonSegmentWiring[] = tour.map((node, index) => ({
    segmentId: node.segmentId,
    order: index,
    isFirst: index === 0,
    isLast: index === tour.length - 1,
    hasPowerIn: index === 0,
    hasOut: index !== tour.length - 1,
    inverted: node.inverted,
  }));
  const jumpers: NeonJumper[] = [];
  for (let k = 0; k < tour.length - 1; k++) {
    const fromSeg = byId.get(tour[k].segmentId)!;
    const toSeg = byId.get(tour[k + 1].segmentId)!;
    const fromPoint = terminalPoints(fromSeg, tour[k].inverted).exit;
    const toPoint = terminalPoints(toSeg, tour[k + 1].inverted).entry;
    const distanceMm = dist(fromPoint, toPoint);
    jumpers.push({ fromSegmentId: fromSeg.id, toSegmentId: toSeg.id, fromPoint, toPoint, distanceMm, lengthMm: distanceMm + serviceMarginMm });
  }
  const totalCableMm = jumpers.reduce((sum, j) => sum + j.lengthMm, 0);
  return { order, segments, jumpers, totalCableMm };
}

/** NeonSegment[] -> NeonWiringPlan: orden + orientación (nearest-neighbor + 2-opt) + jumpers + cable total. */
export function planNeonWiring(segments: NeonSegment[], serviceMarginMm: number): NeonWiringPlan {
  if (segments.length === 0) return { order: [], segments: [], jumpers: [], totalCableMm: 0 };
  const byId = new Map(segments.map((s) => [s.id, s]));
  if (segments.length === 1) {
    return buildPlanFromTour(byId, [{ segmentId: segments[0].id, inverted: false }], serviceMarginMm);
  }
  const initial = buildInitialTour(byId, segments);
  const optimized = applyTwoOpt(byId, initial);
  return buildPlanFromTour(byId, optimized, serviceMarginMm);
}

/**
 * Arma un plan directamente a partir de un ORDEN + conjunto de INVERSIONES ya
 * decididos (manual, editor de Etapa 8) — sin correr nearest-neighbor/2-opt. Ids fuera
 * de `segments` en `order` se ignoran (reconciliación ya resuelta por el llamador).
 */
export function buildManualWiringPlan(segments: NeonSegment[], order: readonly string[], invertedIds: ReadonlySet<string>, serviceMarginMm: number): NeonWiringPlan {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const tour: TourNode[] = order.filter((id) => byId.has(id)).map((id) => ({ segmentId: id, inverted: invertedIds.has(id) && !byId.get(id)!.closed }));
  return buildPlanFromTour(byId, tour, serviceMarginMm);
}

/** Invierte IN/OUT de un segmento abierto a mano, conservando el orden del plan, y recalcula jumpers/cable total. No-op en segmentos cerrados (no tienen IN/OUT que invertir). */
export function invertSegmentOrientation(segments: NeonSegment[], plan: NeonWiringPlan, segmentId: string, serviceMarginMm: number): NeonWiringPlan {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const target = byId.get(segmentId);
  if (!target || target.closed) return plan;
  const tour: TourNode[] = plan.order.map((id) => {
    const wiring = plan.segments.find((s) => s.segmentId === id)!;
    return { segmentId: id, inverted: id === segmentId ? !wiring.inverted : wiring.inverted };
  });
  return buildPlanFromTour(byId, tour, serviceMarginMm);
}

/**
 * Verificación de buses (unión-búsqueda): dentro de cada segmento, IN y OUT de la misma
 * polaridad son la MISMA vía física (une IN+~OUT+ y IN-~OUT-); cada jumper extiende esa
 * vía al siguiente segmento. Un cableado válido da exactamente un bus + y un bus -, nunca
 * en corto — condición que el planificador siempre satisface por construcción (cadena
 * simple, sin bifurcaciones); esta verificación queda como resguardo defensivo, en
 * particular para el editor manual (Etapa 8).
 */
export function computeNeonBuses(plan: NeonWiringPlan): { plus: string[]; minus: string[]; shorted: boolean } {
  const uf = new UnionFind<string>();
  for (const wiring of plan.segments) {
    uf.union(`${wiring.segmentId}.IN+`, `${wiring.segmentId}.OUT+`);
    uf.union(`${wiring.segmentId}.IN-`, `${wiring.segmentId}.OUT-`);
  }
  for (const jumper of plan.jumpers) {
    uf.union(`${jumper.fromSegmentId}.OUT+`, `${jumper.toSegmentId}.IN+`);
    uf.union(`${jumper.fromSegmentId}.OUT-`, `${jumper.toSegmentId}.IN-`);
  }
  const plusRoots = new Set(plan.segments.map((w) => uf.find(`${w.segmentId}.IN+`)));
  const minusRoots = new Set(plan.segments.map((w) => uf.find(`${w.segmentId}.IN-`)));
  const shorted = [...plusRoots].some((r) => minusRoots.has(r));
  return { plus: [...plusRoots], minus: [...minusRoots], shorted };
}
