// Puentes traseros (Secciones 20-26 del pedido de Instalación 0.3): red MÍNIMA (MST)
// que conecta las huellas exteriores de los segmentos en islas físicas separadas, para
// que el conjunto sea UN solo objeto imprimible/manipulable. El puente vive al nivel
// del FLOOR (mismo rango Z que el piso, nunca cierra el canal ni toca la cavidad) y es
// un concepto MECÁNICO, distinto del jumper ELÉCTRICO del cableado (Sección 26: pueden
// coincidir visualmente, pero son modelos separados — este módulo no sabe nada de
// NeonWiringPlan).
//
// Decisión de espesor (V1): el puente ocupa el MISMO rango Z que el piso (0..zFloor),
// nunca más grueso — satisface por construcción la preferencia del pedido
// ("bridgeThickness igual o menor que floorThickness") sin necesitar una tercera banda
// Z independiente (que exigiría soldar un escalón parcial en el borde exterior, más
// riesgo de malla no-manifold para un beneficio marginal). `bridgeWidthMm` sigue siendo
// configurable (Sección 22).
import type * as ClipperLib from "clipper-lib";
import type { ContourGroup, Point2D } from "@/lib/maker/types";
import {
  clipperPathsArea,
  contourGroupsToRawPaths,
  intersectRawPaths,
  outsetContourGroups,
  pointsToRawPath,
  regroupClipperSolution,
} from "@/lib/maker/geometry/offsets";
import { capsulePolygon } from "@/lib/maker/geometry/backCutouts";
import { bufferNeonPaths } from "@/lib/maker/neon/geometry/bufferPath";
import { channelOuterWidth } from "@/lib/maker/neon/defaults";
import type { NeonChannelParams, NeonIssue } from "@/lib/maker/neon/types";
import type { NeonSegment } from "@/lib/maker/neon/installation/segments";
import { buildArclengthTable, pointAtT } from "@/lib/maker/neon/installation/arclength";
import { UnionFind } from "@/lib/maker/unionFind";

export interface BridgeEdge {
  fromSegmentId: string;
  toSegmentId: string;
  a: Point2D;
  b: Point2D;
  distanceMm: number;
}

export interface BridgeSettings {
  widthMm: number;
  /** Umbral (mm) por encima del cual se avisa "esta unión puede quedar visible" — no bloquea. */
  maxLengthBeforeWarningMm: number;
}

function segmentIdNumber(id: string): number {
  const m = /^N(\d+)$/.exec(id);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

function compareSegmentIds(a: string, b: string): number {
  const byNumber = segmentIdNumber(a) - segmentIdNumber(b);
  return byNumber !== 0 ? byNumber : a < b ? -1 : a > b ? 1 : 0;
}

function rotate(points: Point2D[], rotationDeg: number, tx: number, ty: number): Point2D[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return points.map(([x, y]) => [x * c - y * s + tx, x * s + y * c + ty] as Point2D);
}

/** Huella exterior de UN segmento, desechable: solo para planificar puentes (distancia entre islas), nunca toca el buffer fusionado real del canal. */
export function segmentOuterFootprint(segment: NeonSegment, channelParams: NeonChannelParams): ContourGroup[] {
  const outerRadius = channelOuterWidth(channelParams) / 2;
  try {
    const raw = bufferNeonPaths([{ points: segment.points, closed: segment.closed }], outerRadius);
    return regroupClipperSolution(raw);
  } catch {
    return [];
  }
}

/** Par de puntos más cercano entre dos huellas exteriores (solo anillos `outer`: el hueco interior de un loop nunca es el punto más cercano a algo externo). */
export function nearestPointPair(footprintA: ContourGroup[], footprintB: ContourGroup[]): { a: Point2D; b: Point2D; distanceMm: number } {
  let best = { a: [0, 0] as Point2D, b: [0, 0] as Point2D, distanceMm: Infinity };
  for (const ga of footprintA) {
    for (const pa of ga.outer) {
      for (const gb of footprintB) {
        for (const pb of gb.outer) {
          const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
          if (d < best.distanceMm) best = { a: pa, b: pb, distanceMm: d };
        }
      }
    }
  }
  return best;
}

/**
 * MST puro (Kruskal, comparte `UnionFind` con la verificación de buses del cableado):
 * grafo completo nodo=segmento, costo=distancia mínima entre huellas exteriores.
 * Determinístico (orden de segmentos fijo, desempate por id). No valida geometría
 * (longitud/cruce con cavidad) — eso es `planBridges`, más abajo.
 */
export function buildBridgeMST(segments: NeonSegment[], footprints: Map<string, ContourGroup[]>): BridgeEdge[] {
  if (segments.length < 2) return [];
  const ids = segments.map((s) => s.id).sort(compareSegmentIds);
  const edges: BridgeEdge[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const fa = footprints.get(ids[i]);
      const fb = footprints.get(ids[j]);
      if (!fa || !fb || fa.length === 0 || fb.length === 0) continue;
      const { a, b, distanceMm } = nearestPointPair(fa, fb);
      edges.push({ fromSegmentId: ids[i], toSegmentId: ids[j], a, b, distanceMm });
    }
  }
  edges.sort((x, y) => {
    if (Math.abs(x.distanceMm - y.distanceMm) > 1e-9) return x.distanceMm - y.distanceMm;
    if (x.fromSegmentId !== y.fromSegmentId) return x.fromSegmentId < y.fromSegmentId ? -1 : 1;
    return x.toSegmentId < y.toSegmentId ? -1 : 1;
  });
  const uf = new UnionFind<string>();
  const mst: BridgeEdge[] = [];
  for (const edge of edges) {
    if (uf.connected(edge.fromSegmentId, edge.toSegmentId)) continue;
    uf.union(edge.fromSegmentId, edge.toSegmentId);
    mst.push(edge);
  }
  return mst;
}

/** Componentes conectados a nivel del GRAFO de segmentos (no de la malla 3D): cada segmento es su propio componente salvo que un `BridgeEdge` los una. Útil para "N-1 puentes -> 1 componente" y "modo apagado preserva el conteo original". */
export function componentsOf(segments: NeonSegment[], edges: BridgeEdge[]): string[][] {
  const uf = new UnionFind<string>();
  for (const s of segments) uf.find(s.id);
  for (const e of edges) uf.union(e.fromSegmentId, e.toSegmentId);
  const groups = new Map<string, string[]>();
  for (const s of segments) {
    const root = uf.find(s.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(s.id);
  }
  return [...groups.values()];
}

/**
 * Margen de solape (mm) más allá de cada punto de conexión: `edge.a`/`edge.b` son los
 * puntos MÁS CERCANOS de dos huellas ya separadas, es decir puntos de SU PROPIO borde
 * — un puente cuya cápsula termine justo ahí solo los TOCA tangencialmente (un único
 * punto de contacto), lo que puede dejar a Clipper una unión "pellizcada" en ese punto
 * (borde no-manifold al extruir). Extender la cápsula un poco más allá de cada punto,
 * hacia adentro de la huella correspondiente, garantiza superposición real de área.
 */
const BRIDGE_OVERLAP_MM = 1;

/** Cápsula 2D del puente entre `edge.a` y `edge.b`, ancho `widthMm`, eje largo alineado con a->b (mismo truco de orientación que `passThrough.ts`: capsulePolygon() no siempre pone su eje largo en X). Se extiende `BRIDGE_OVERLAP_MM` más allá de cada punto para solapar de verdad con las huellas que conecta, no solo tocarlas. */
export function bridgeFootprintPolygon(edge: BridgeEdge, widthMm: number): Point2D[] {
  const dx = edge.b[0] - edge.a[0];
  const dy = edge.b[1] - edge.a[1];
  const rawLength = Math.hypot(dx, dy);
  const [ux, uy] = rawLength > 1e-9 ? [dx / rawLength, dy / rawLength] : [1, 0];
  const a: Point2D = [edge.a[0] - ux * BRIDGE_OVERLAP_MM, edge.a[1] - uy * BRIDGE_OVERLAP_MM];
  const b: Point2D = [edge.b[0] + ux * BRIDGE_OVERLAP_MM, edge.b[1] + uy * BRIDGE_OVERLAP_MM];
  const length = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), 1e-6);
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const axisAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const rotationDeg = length >= widthMm ? axisAngleDeg : axisAngleDeg - 90;
  return rotate(capsulePolygon(length, widthMm), rotationDeg, mx, my);
}

/**
 * Modelo separado (Sección 15 del pedido de corrección de puentes): el grafo MST decide
 * qué PARES de componentes deben conectarse (`BridgeConnection` — conceptual, no es un
 * tipo separado: cada `BridgeEdge` primario ya identifica el par por
 * `fromSegmentId`/`toSegmentId`); el planificador de refuerzo decide cuántos
 * `BridgeInstance` físicos usa cada relación. Un mismo par puede tener 2, 3 o más
 * instancias — nunca limitado a la única arista que el MST le asignó.
 */
export type BridgeInstanceKind = "primary" | "reinforcement" | "manual";

export interface BridgeInstance extends BridgeEdge {
  /** Estable dentro de una corrida: identifica la instancia para edición/eliminación manual. */
  id: string;
  kind: BridgeInstanceKind;
  footprint: Point2D[];
}

export interface BridgePlanResult {
  /** Puentes aceptados (footprint ya incluido), todos kind:"primary" — la red MÍNIMA (Sección 16: modo Mínima). */
  bridges: BridgeInstance[];
  warnings: NeonIssue[];
}

const CAVITY_OVERLAP_TOLERANCE_MM2 = 1e-3;
/** Margen (mm) más allá del cual un puente puede rozar un pass-through sin pisarlo (Sección 24). */
const BRIDGE_PASS_THROUGH_MARGIN_MM = 1;

/** ¿El footprint de un puente candidato cruza la cavidad de algún segmento, o pisa (con margen) algún pass-through ya perforado? (Secciones 24-25). */
function bridgeCollides(footprint: Point2D[], cavityRaw: ClipperLib.Paths, passThroughRawExpanded: ClipperLib.Paths): boolean {
  const raw = pointsToRawPath(footprint);
  if (cavityRaw.length > 0) {
    const overlapArea = Math.abs(clipperPathsArea(intersectRawPaths([raw], cavityRaw)));
    if (overlapArea > CAVITY_OVERLAP_TOLERANCE_MM2) return true;
  }
  if (passThroughRawExpanded.length > 0) {
    const overlapArea = Math.abs(clipperPathsArea(intersectRawPaths([raw], passThroughRawExpanded)));
    if (overlapArea > CAVITY_OVERLAP_TOLERANCE_MM2) return true;
  }
  return false;
}

/** Expande cada pass-through footprint `marginMm` para dejar aire alrededor (Sección 24: "footprint + margen"). */
function expandPassThroughFootprints(passThroughFootprints: Point2D[][], marginMm: number): ClipperLib.Paths {
  if (passThroughFootprints.length === 0) return [];
  const groups = passThroughFootprints.map((polygon) => ({ outer: polygon, holes: [] }));
  return outsetContourGroups(groups, marginMm);
}

/**
 * Kruskal's con validación geométrica en línea: recorre los candidatos por distancia
 * ascendente y acepta el primero que una dos componentes distintas Y no cruce la
 * cavidad de NINGÚN segmento ni pise un pass-through (Sección 25: "rechazo + siguiente
 * mejor par"). Un puente largo no se rechaza, solo avisa (`NEON_BRIDGE_TOO_LONG`). Esta
 * es la red MÍNIMA (modo "Mínima", Sección 16) — N-1 puentes para N componentes: garantiza
 * CONECTIVIDAD, no rigidez (eso es trabajo de `planReinforcementBridges`).
 */
export function planBridges(
  segments: NeonSegment[],
  channelParams: NeonChannelParams,
  settings: BridgeSettings,
  cavityGroups: ContourGroup[],
  passThroughFootprints: Point2D[][] = [],
): BridgePlanResult {
  const warnings: NeonIssue[] = [];
  if (segments.length < 2) return { bridges: [], warnings };

  const footprints = new Map(segments.map((s) => [s.id, segmentOuterFootprint(s, channelParams)]));
  const ids = segments.map((s) => s.id).sort(compareSegmentIds);
  const candidates: BridgeEdge[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const fa = footprints.get(ids[i])!;
      const fb = footprints.get(ids[j])!;
      if (fa.length === 0 || fb.length === 0) continue;
      const { a, b, distanceMm } = nearestPointPair(fa, fb);
      candidates.push({ fromSegmentId: ids[i], toSegmentId: ids[j], a, b, distanceMm });
    }
  }
  candidates.sort((x, y) => {
    if (Math.abs(x.distanceMm - y.distanceMm) > 1e-9) return x.distanceMm - y.distanceMm;
    if (x.fromSegmentId !== y.fromSegmentId) return x.fromSegmentId < y.fromSegmentId ? -1 : 1;
    return x.toSegmentId < y.toSegmentId ? -1 : 1;
  });

  const cavityRaw = contourGroupsToRawPaths(cavityGroups);
  const passThroughRaw = expandPassThroughFootprints(passThroughFootprints, BRIDGE_PASS_THROUGH_MARGIN_MM);
  const uf = new UnionFind<string>();
  const bridges: BridgeInstance[] = [];
  let nextId = 1;
  for (const edge of candidates) {
    if (uf.connected(edge.fromSegmentId, edge.toSegmentId)) continue;
    const footprint = bridgeFootprintPolygon(edge, settings.widthMm);
    if (bridgeCollides(footprint, cavityRaw, passThroughRaw)) {
      warnings.push({
        code: "NEON_BRIDGE_CROSSES_CAVITY",
        message: `El puente entre ${edge.fromSegmentId} y ${edge.toSegmentId} cruzaría la cavidad del canal o un pass-through; se buscó otra unión.`,
      });
      continue;
    }
    uf.union(edge.fromSegmentId, edge.toSegmentId);
    bridges.push({ ...edge, id: `mst-${nextId++}`, kind: "primary", footprint });
    if (edge.distanceMm > settings.maxLengthBeforeWarningMm) {
      warnings.push({
        code: "NEON_BRIDGE_TOO_LONG",
        message: `La unión entre ${edge.fromSegmentId} y ${edge.toSegmentId} (${edge.distanceMm.toFixed(1)} mm) es larga y puede quedar visible.`,
      });
    }
  }
  return { bridges, warnings };
}

// ---------------------------------------------------------------------------------
// Refuerzo (Secciones 15-27 del pedido de corrección de puentes): agrega BridgeInstance
// adicionales sobre las relaciones que el MST ya decidió conectar — nunca inventa pares
// nuevos (V1, ver limitaciones). Deriva la cantidad de "available adjacency + design
// size + reinforcement setting" (Sección 25), nunca de un conteo fijo tipo "foto 1 = 4".
// ---------------------------------------------------------------------------------

export type NeonReinforcementLevel = "low" | "medium" | "high";

const REINFORCEMENT_LEVEL_FACTOR: Record<NeonReinforcementLevel, number> = { low: 0.5, medium: 1, high: 1.75 };
/** Separación objetivo (mm) entre refuerzos a lo largo de la zona de adyacencia — junto con el nivel, deriva CUÁNTOS refuerzos caben (Sección 25). */
const REINFORCEMENT_SPACING_TARGET_MM = 50;
/** Ventana (mm) más allá de la distancia mínima entre dos huellas dentro de la cual un par de puntos todavía cuenta como "adyacente" (Sección 21: candidatos de puente). */
const REINFORCEMENT_ADJACENCY_MARGIN_MM = 40;

/** Separación espacial mínima (mm) entre dos puentes cualesquiera (Sección 22): deriva del ancho — más ancho, más lugar para que dos puentes no se toquen ni se vean amontonados (`|||`). */
export function minBridgeSeparationMm(widthMm: number): number {
  return Math.max(20, widthMm * 4);
}

/** Cada cuántos mm se muestrea el recorrido de un segmento para generar candidatos de refuerzo (Sección 21). */
const CANDIDATE_SAMPLE_STEP_MM = 15;

/**
 * Puntos sobre el CENTRO del recorrido de un segmento, a intervalos regulares de
 * longitud de arco (reusa `arclength.ts`, mismo mecanismo que `clipPlacement.ts`) — a
 * diferencia de muestrear los vértices de la huella exterior ya bufferizada, esto da una
 * densidad de candidatos CONTROLADA e independiente de la teselación de Clipper: un
 * tramo recto largo solo tiene 2 vértices reales en su huella (las puntas), lo que
 * dejaría "amontonados" los candidatos de refuerzo en los extremos en vez de distribuidos
 * a lo largo de la adyacencia real.
 */
function sampleCenterline(segment: NeonSegment): Point2D[] {
  const table = buildArclengthTable(segment.points, segment.closed);
  if (table.totalMm <= 1e-6) return [segment.points[0]];
  const points: Point2D[] = [];
  for (let t = 0; t <= table.totalMm + 1e-6; t += CANDIDATE_SAMPLE_STEP_MM) {
    points.push(pointAtT(table, Math.min(t, table.totalMm)).point);
  }
  return points;
}

/**
 * Candidatos de refuerzo entre dos segmentos: para cada par de puntos muestreados sobre
 * SUS centros, el punto de conexión real se desplaza `outerRadiusMm` hacia el otro
 * segmento (aproxima el borde de la huella exterior sin tener que recalcularla por
 * candidato). Ordenados por distancia ascendente (Sección 21).
 */
function collectCandidatePairs(segFrom: NeonSegment, segTo: NeonSegment, outerRadiusMm: number): { a: Point2D; b: Point2D; d: number }[] {
  const samplesFrom = sampleCenterline(segFrom);
  const samplesTo = sampleCenterline(segTo);
  const pairs: { a: Point2D; b: Point2D; d: number }[] = [];
  for (const pa of samplesFrom) {
    for (const pb of samplesTo) {
      const centerDist = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
      if (centerDist < 1e-6) continue;
      const ux = (pb[0] - pa[0]) / centerDist;
      const uy = (pb[1] - pa[1]) / centerDist;
      const a: Point2D = [pa[0] + ux * outerRadiusMm, pa[1] + uy * outerRadiusMm];
      const b: Point2D = [pb[0] - ux * outerRadiusMm, pb[1] - uy * outerRadiusMm];
      pairs.push({ a, b, d: Math.hypot(a[0] - b[0], a[1] - b[1]) });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  return pairs;
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export interface ReinforcementSettings {
  widthMm: number;
  level: NeonReinforcementLevel;
}

export interface ReinforcementPlanResult {
  bridges: BridgeInstance[];
  warnings: NeonIssue[];
}

/**
 * Agrega refuerzos SOLO sobre las relaciones que el MST (`primaryBridges`) ya conectó
 * (V1 — Sección 20, no inventa pares nuevos: ver limitaciones). Por cada arista primaria:
 * candidatos ordenados por distancia dentro de la ventana de adyacencia, se aceptan
 * greedy los que (a) no cruzan cavidad/pass-through y (b) quedan a `minBridgeSeparationMm`
 * de CUALQUIER puente ya elegido (primario o de refuerzo, de cualquier par — Sección 22:
 * separación espacial global, no solo dentro del mismo par) — así los candidatos
 * demasiado próximos al último elegido quedan suprimidos (Sección 21) y el resultado
 * queda distribuido en vez de amontonado. La cantidad deseada se deriva de
 * `min(lengthMm de los dos segmentos) / spacingObjetivo * factorDeNivel` (Sección 25); si
 * la geometría no ofrece suficientes candidatos válidos y separados, se coloca lo que se
 * pueda y se avisa cuántos quedaron sin colocar (Sección 27).
 */
export function planReinforcementBridges(
  segments: NeonSegment[],
  channelParams: NeonChannelParams,
  settings: ReinforcementSettings,
  cavityGroups: ContourGroup[],
  passThroughFootprints: Point2D[][],
  primaryBridges: BridgeInstance[],
): ReinforcementPlanResult {
  const warnings: NeonIssue[] = [];
  if (primaryBridges.length === 0) return { bridges: [], warnings };

  const segmentsById = new Map(segments.map((s) => [s.id, s]));
  const cavityRaw = contourGroupsToRawPaths(cavityGroups);
  const passThroughRaw = expandPassThroughFootprints(passThroughFootprints, BRIDGE_PASS_THROUGH_MARGIN_MM);
  const minSeparation = minBridgeSeparationMm(settings.widthMm);
  const outerRadiusMm = channelOuterWidth(channelParams) / 2;
  const chosenMidpoints: Point2D[] = primaryBridges.map((b) => midpoint(b.a, b.b));

  const bridges: BridgeInstance[] = [];
  let nextId = 1;
  for (const primary of [...primaryBridges].sort((x, y) => compareSegmentIds(x.fromSegmentId, y.fromSegmentId) || compareSegmentIds(x.toSegmentId, y.toSegmentId))) {
    const segFrom = segmentsById.get(primary.fromSegmentId);
    const segTo = segmentsById.get(primary.toSegmentId);
    if (!segFrom || !segTo) continue;

    const adjacencyExtentMm = Math.min(segFrom.lengthMm, segTo.lengthMm);
    const desiredExtra = Math.max(1, Math.round((adjacencyExtentMm / REINFORCEMENT_SPACING_TARGET_MM) * REINFORCEMENT_LEVEL_FACTOR[settings.level]));

    const candidates = collectCandidatePairs(segFrom, segTo, outerRadiusMm).filter((c) => c.d <= primary.distanceMm + REINFORCEMENT_ADJACENCY_MARGIN_MM);
    let placed = 0;
    for (const candidate of candidates) {
      if (placed >= desiredExtra) break;
      const mid = midpoint(candidate.a, candidate.b);
      if (chosenMidpoints.some((m) => Math.hypot(m[0] - mid[0], m[1] - mid[1]) < minSeparation)) continue;
      const edge: BridgeEdge = { fromSegmentId: primary.fromSegmentId, toSegmentId: primary.toSegmentId, a: candidate.a, b: candidate.b, distanceMm: candidate.d };
      const footprint = bridgeFootprintPolygon(edge, settings.widthMm);
      if (bridgeCollides(footprint, cavityRaw, passThroughRaw)) continue;
      bridges.push({ ...edge, id: `reinforce-${nextId++}`, kind: "reinforcement", footprint });
      chosenMidpoints.push(mid);
      placed++;
    }
    if (placed < desiredExtra) {
      warnings.push({
        code: "NEON_BRIDGE_REINFORCEMENT_PARTIAL",
        message: `Solo se pudieron colocar ${placed} de ${desiredExtra} refuerzos entre ${primary.fromSegmentId} y ${primary.toSegmentId}.`,
      });
    }
  }
  return { bridges, warnings };
}

// ---------------------------------------------------------------------------------
// Puentes manuales (modo Personalizada, Secciones 16, 28-29): el usuario elige el par y
// los dos puntos; se valida que cada extremo apoye sobre el floor material real de su
// segmento antes de aceptarlo — nunca un endpoint flotando.
// ---------------------------------------------------------------------------------

const MANUAL_BRIDGE_TOUCH_TOLERANCE_MM = 3;

/** ¿`point` cae sobre (o muy cerca de) la huella exterior real de `segment`? Evita endpoints flotando (Sección 29). */
function touchesSegmentFootprint(point: Point2D, footprint: ContourGroup[], toleranceMm: number): boolean {
  if (footprint.length === 0) return false;
  const probe = capsulePolygon(toleranceMm * 2, toleranceMm * 2).map(([x, y]) => [x + point[0], y + point[1]] as Point2D);
  const raw = contourGroupsToRawPaths(footprint);
  return Math.abs(clipperPathsArea(intersectRawPaths([pointsToRawPath(probe)], raw))) > CAVITY_OVERLAP_TOLERANCE_MM2;
}

export interface ManualBridgeInput {
  id: string;
  fromSegmentId: string;
  toSegmentId: string;
  a: Point2D;
  b: Point2D;
}

export interface ManualBridgeResult {
  valid: BridgeInstance[];
  /** Uno por instancia inválida — bloquean el export (Sección 29: "Bloquear export si bridge manual no toca ambos bodies"). */
  errors: NeonIssue[];
}

/** Valida y construye las instancias manuales (Sección 29): cada extremo debe tocar el floor material de SU segmento; sin cruzar cavidad ni pass-through. */
export function buildManualBridgeInstances(
  manualBridges: ManualBridgeInput[],
  segments: NeonSegment[],
  channelParams: NeonChannelParams,
  cavityGroups: ContourGroup[],
  passThroughFootprints: Point2D[][],
  widthMm: number,
): ManualBridgeResult {
  const segmentsById = new Map(segments.map((s) => [s.id, s]));
  const footprints = new Map(segments.map((s) => [s.id, segmentOuterFootprint(s, channelParams)]));
  const cavityRaw = contourGroupsToRawPaths(cavityGroups);
  const passThroughRaw = expandPassThroughFootprints(passThroughFootprints, BRIDGE_PASS_THROUGH_MARGIN_MM);
  const valid: BridgeInstance[] = [];
  const errors: NeonIssue[] = [];
  for (const mb of manualBridges) {
    const segFrom = segmentsById.get(mb.fromSegmentId);
    const segTo = segmentsById.get(mb.toSegmentId);
    const fa = segFrom ? footprints.get(mb.fromSegmentId) : undefined;
    const fb = segTo ? footprints.get(mb.toSegmentId) : undefined;
    if (!segFrom || !segTo || !fa || !fb) {
      errors.push({ code: "NEON_BRIDGE_MANUAL_INVALID", message: `El puente manual "${mb.id}" referencia un segmento que ya no existe.` });
      continue;
    }
    const touchesA = touchesSegmentFootprint(mb.a, fa, MANUAL_BRIDGE_TOUCH_TOLERANCE_MM);
    const touchesB = touchesSegmentFootprint(mb.b, fb, MANUAL_BRIDGE_TOUCH_TOLERANCE_MM);
    if (!touchesA || !touchesB) {
      errors.push({
        code: "NEON_BRIDGE_MANUAL_INVALID",
        message: `El puente manual entre ${mb.fromSegmentId} y ${mb.toSegmentId} no apoya sobre ambos segmentos: moveé sus extremos sobre el material.`,
      });
      continue;
    }
    const edge: BridgeEdge = { fromSegmentId: mb.fromSegmentId, toSegmentId: mb.toSegmentId, a: mb.a, b: mb.b, distanceMm: Math.hypot(mb.a[0] - mb.b[0], mb.a[1] - mb.b[1]) };
    const footprint = bridgeFootprintPolygon(edge, widthMm);
    if (bridgeCollides(footprint, cavityRaw, passThroughRaw)) {
      errors.push({
        code: "NEON_BRIDGE_MANUAL_INVALID",
        message: `El puente manual entre ${mb.fromSegmentId} y ${mb.toSegmentId} cruza la cavidad del canal o un pass-through.`,
      });
      continue;
    }
    valid.push({ ...edge, id: mb.id, kind: "manual", footprint });
  }
  return { valid, errors };
}
