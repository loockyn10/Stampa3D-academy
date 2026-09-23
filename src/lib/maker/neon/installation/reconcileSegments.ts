// Reconciliación de NeonSegment ante cambios de fuente (texto/SVG/PNG/fuente/alto,
// Sección 45/59 del pedido). Los ids son posicionales (`segments.ts`) y NO son estables
// por sí solos entre corridas: si el conteo/orden de segmentos cambia, un id viejo puede
// apuntar a un segmento distinto en la corrida nueva. Esta función hace un match
// best-effort por forma/geometría (no por índice) y devuelve SOLO los pares con
// confianza suficiente; todo lo demás se descarta limpio — nunca se remapea un override
// viejo a un segmento equivocado (mismo comportamiento sancionado que la limitación ya
// documentada de `LetterInstance.id` en Carteles).
import type { Point2D } from "@/lib/maker/types";
import type { NeonSegment } from "@/lib/maker/neon/installation/segments";

export interface SegmentMatch {
  prevId: string;
  nextId: string;
  confidence: number;
}

/** Confianza mínima para aceptar un match; por debajo, se prefiere descartar el override antes que aplicarlo mal. */
const MATCH_CONFIDENCE_THRESHOLD = 0.35;

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function centroid(b: NeonSegment["bounds"]): Point2D {
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/** Distancia geométrica entre dos segmentos del mismo tipo (closed): centroides para loops, endpoints (probando ambas orientaciones) para abiertos. Infinity si `closed` no coincide. */
function geometryDistance(a: NeonSegment, b: NeonSegment): number {
  if (a.closed !== b.closed) return Infinity;
  if (a.closed) return dist(centroid(a.bounds), centroid(b.bounds));
  if (!a.start || !a.end || !b.start || !b.end) return Infinity;
  const straight = dist(a.start.point, b.start.point) + dist(a.end.point, b.end.point);
  const flipped = dist(a.start.point, b.end.point) + dist(a.end.point, b.start.point);
  return Math.min(straight, flipped) / 2;
}

/** Puntaje en (0,1]: 1 = coincidencia perfecta, decae con la distancia geométrica y la diferencia de longitud, ambas normalizadas por la ESCALA COMÚN del par (media geométrica de sus longitudes). La media geométrica castiga fuerte un desajuste de escala (un trazo enorme no puede "absorber" la distancia a uno diminuto usando su propio tamaño como vara de medir) — a diferencia de normalizar por el máximo, que dejaría pasar ese caso. */
function matchScore(a: NeonSegment, b: NeonSegment): number {
  if (a.closed !== b.closed) return 0;
  const scale = Math.sqrt(Math.max(a.lengthMm, 1e-6) * Math.max(b.lengthMm, 1e-6));
  const geomDist = geometryDistance(a, b) / scale;
  const lengthDelta = Math.abs(a.lengthMm - b.lengthMm) / scale;
  const penalty = geomDist * 0.7 + lengthDelta * 0.3;
  return 1 / (1 + penalty);
}

/**
 * Empareja `prev` (corrida anterior) con `next` (corrida nueva) por similitud geométrica,
 * no por posición. Greedy por confianza descendente, cada id usado como máximo una vez,
 * desempate determinístico por id (nunca por orden de iteración/float). Devuelve
 * prevId -> nextId solo para los pares que superan el umbral de confianza.
 */
export function reconcileSegments(prev: NeonSegment[], next: NeonSegment[]): Map<string, string> {
  const candidates: SegmentMatch[] = [];
  for (const p of prev) {
    for (const n of next) {
      const confidence = matchScore(p, n);
      if (confidence >= MATCH_CONFIDENCE_THRESHOLD) candidates.push({ prevId: p.id, nextId: n.id, confidence });
    }
  }
  candidates.sort((x, y) => {
    if (y.confidence !== x.confidence) return y.confidence - x.confidence;
    if (x.prevId !== y.prevId) return x.prevId < y.prevId ? -1 : 1;
    return x.nextId < y.nextId ? -1 : 1;
  });
  const usedPrev = new Set<string>();
  const usedNext = new Set<string>();
  const result = new Map<string, string>();
  for (const c of candidates) {
    if (usedPrev.has(c.prevId) || usedNext.has(c.nextId)) continue;
    usedPrev.add(c.prevId);
    usedNext.add(c.nextId);
    result.set(c.prevId, c.nextId);
  }
  return result;
}
