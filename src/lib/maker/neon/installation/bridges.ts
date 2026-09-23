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
import type { ContourGroup, Point2D } from "@/lib/maker/types";
import {
  clipperPathsArea,
  contourGroupsToRawPaths,
  intersectRawPaths,
  pointsToRawPath,
  regroupClipperSolution,
} from "@/lib/maker/geometry/offsets";
import { capsulePolygon } from "@/lib/maker/geometry/backCutouts";
import { bufferNeonPaths } from "@/lib/maker/neon/geometry/bufferPath";
import { channelOuterWidth } from "@/lib/maker/neon/defaults";
import type { NeonChannelParams, NeonIssue } from "@/lib/maker/neon/types";
import type { NeonSegment } from "@/lib/maker/neon/installation/segments";
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

export interface BridgePlanResult {
  /** Puentes aceptados (footprint ya incluido). */
  bridges: (BridgeEdge & { footprint: Point2D[] })[];
  warnings: NeonIssue[];
}

const CAVITY_OVERLAP_TOLERANCE_MM2 = 1e-3;

/**
 * Kruskal's con validación geométrica en línea: recorre los candidatos por distancia
 * ascendente y acepta el primero que una dos componentes distintas Y no cruce la
 * cavidad de NINGÚN segmento; si cruza, se descarta y se sigue con el próximo candidato
 * más barato para ese mismo par de componentes (Sección 25: "rechazo + siguiente mejor
 * par"). Un puente largo no se rechaza, solo avisa (`NEON_BRIDGE_TOO_LONG`).
 */
export function planBridges(segments: NeonSegment[], channelParams: NeonChannelParams, settings: BridgeSettings, cavityGroups: ContourGroup[]): BridgePlanResult {
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
  const uf = new UnionFind<string>();
  const bridges: (BridgeEdge & { footprint: Point2D[] })[] = [];
  for (const edge of candidates) {
    if (uf.connected(edge.fromSegmentId, edge.toSegmentId)) continue;
    const footprint = bridgeFootprintPolygon(edge, settings.widthMm);
    const overlapArea = cavityRaw.length > 0 ? Math.abs(clipperPathsArea(intersectRawPaths([pointsToRawPath(footprint)], cavityRaw))) : 0;
    if (overlapArea > CAVITY_OVERLAP_TOLERANCE_MM2) {
      warnings.push({
        code: "NEON_BRIDGE_CROSSES_CAVITY",
        message: `El puente entre ${edge.fromSegmentId} y ${edge.toSegmentId} cruzaría la cavidad del canal; se buscó otra unión.`,
      });
      continue;
    }
    uf.union(edge.fromSegmentId, edge.toSegmentId);
    bridges.push({ ...edge, footprint });
    if (edge.distanceMm > settings.maxLengthBeforeWarningMm) {
      warnings.push({
        code: "NEON_BRIDGE_TOO_LONG",
        message: `La unión entre ${edge.fromSegmentId} y ${edge.toSegmentId} (${edge.distanceMm.toFixed(1)} mm) es larga y puede quedar visible.`,
      });
    }
  }
  return { bridges, warnings };
}
