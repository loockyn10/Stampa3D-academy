// NeonSegment: identidad física estable por recorrido, capa de metadata PURA sobre
// NeonPath[] (Sección 1-2 del pedido de Instalación 0.3). No depende de Clipper ni de
// createChannelGeometry.ts: se calcula ANTES de cualquier buffer/unión, así que agregar
// o reconciliar segmentos nunca reprocesa la geometría fusionada del canal U.
//
// NeonPath sigue representando el RECORRIDO (2D, points+closed). NeonSegment es la
// identidad de una pieza/recorrido eléctrico-físico concreto: un id estable dentro de
// una misma corrida (`N1..Nn`, posicional — mismo esquema que `LetterInstance.id` de
// Carteles), endpoints con tangente saliente para paths abiertos, y un punto de
// conexión/corte sugerido (`connectionAnchorT`) para loops cerrados.
import type { Point2D } from "@/lib/maker/types";
import type { NeonPath } from "@/lib/maker/neon/types";
import { neonPathLength } from "@/lib/maker/neon/metrics/pathLength";

/** Extremo de un segmento abierto: punto + tangente unitaria SALIENTE (apunta hacia afuera del recorrido, más allá de la punta). */
export interface NeonSegmentEndpoint {
  point: Point2D;
  tangent: Point2D;
}

export interface NeonSegmentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface NeonSegment {
  /** "N1".."Nn" — posicional dentro de la corrida actual (índice en el NeonPath[] de entrada). */
  id: string;
  /** Índice en el NeonPath[] que este segmento envuelve (hoy siempre 1:1). */
  pathIndex: number;
  closed: boolean;
  /** Misma referencia que NeonPath.points (no se copia). */
  points: Point2D[];
  lengthMm: number;
  bounds: NeonSegmentBounds;
  /** Solo abiertos. */
  start: NeonSegmentEndpoint | null;
  end: NeonSegmentEndpoint | null;
  /** Solo cerrados: fracción de longitud de arco [0,1) del punto de corte/conexión sugerido. */
  connectionAnchorT: number | null;
}

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Vector unitario de `to`→`from` extendido (apunta desde `to` pasando por `from`, "hacia afuera"). Fallback [1,0] si es degenerado. */
function outwardUnit(from: Point2D, to: Point2D): Point2D {
  const dx = from[0] - to[0];
  const dy = from[1] - to[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [1, 0];
  return [dx / len, dy / len];
}

function computeBounds(points: Point2D[]): NeonSegmentBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

function buildEndpoint(points: Point2D[], which: "start" | "end"): NeonSegmentEndpoint {
  if (points.length === 0) return { point: [0, 0], tangent: [1, 0] };
  if (which === "start") {
    const p0 = points[0];
    const p1 = points.length > 1 ? points[1] : p0;
    return { point: p0, tangent: outwardUnit(p0, p1) };
  }
  const pn = points[points.length - 1];
  const pPrev = points.length > 1 ? points[points.length - 2] : pn;
  return { point: pn, tangent: outwardUnit(pn, pPrev) };
}

/** Ángulo de giro en `b` entre `a->b` y `b->c` (0 = recto, hasta PI = reversa). Degenerado (segmento nulo) cuenta como giro cerrado (PI): nunca se elige como corte. */
function turningAngle(a: Point2D, b: Point2D, c: Point2D): number {
  const v1x = b[0] - a[0], v1y = b[1] - a[1];
  const v2x = c[0] - b[0], v2y = c[1] - b[1];
  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);
  if (len1 < 1e-9 || len2 < 1e-9) return Math.PI;
  const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/**
 * Elige determinísticamente el punto de corte/conexión sugerido para un loop cerrado:
 * el vértice más "recto" (menor ángulo de giro local). Cortar en el tramo más recto dejá
 * más margen de material a los dos lados que cortar en una esquina viva — mismo criterio
 * que luego evita curvas cerradas para clips/pass-through (Etapas 3/6). Empate → primer
 * índice (recorrido en orden), nunca aleatorio.
 */
function chooseConnectionAnchorT(points: Point2D[], totalLengthMm: number): number {
  const n = points.length;
  if (n < 3 || totalLengthMm <= 0) return 0;
  const cumulative: number[] = [0];
  for (let i = 1; i < n; i++) cumulative.push(cumulative[i - 1] + dist(points[i - 1], points[i]));
  let bestIndex = 0;
  let bestAngle = Infinity;
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
    const angle = turningAngle(a, b, c);
    if (angle < bestAngle - 1e-9) {
      bestAngle = angle;
      bestIndex = i;
    }
  }
  return cumulative[bestIndex] / totalLengthMm;
}

function buildSegment(path: NeonPath, pathIndex: number): NeonSegment {
  const id = `N${pathIndex + 1}`;
  const points = path.points;
  const lengthMm = neonPathLength(path);
  const bounds = computeBounds(points);
  if (path.closed) {
    return {
      id,
      pathIndex,
      closed: true,
      points,
      lengthMm,
      bounds,
      start: null,
      end: null,
      connectionAnchorT: chooseConnectionAnchorT(points, lengthMm),
    };
  }
  return {
    id,
    pathIndex,
    closed: false,
    points,
    lengthMm,
    bounds,
    start: buildEndpoint(points, "start"),
    end: buildEndpoint(points, "end"),
    connectionAnchorT: null,
  };
}

/**
 * NeonPath[] -> NeonSegment[]. Un carácter puede aportar varios NeonPath (p.ej. "A" =
 * lados + travesaño): ya llegan como entradas separadas de `paths` (textToNeonPaths /
 * svgToNeonPaths ya los separan por trazo), así que esta función es un wrapper casi 1:1,
 * sin lógica nueva de separación de trazos.
 */
export function buildNeonSegments(paths: NeonPath[]): NeonSegment[] {
  return paths.map((path, index) => buildSegment(path, index));
}
