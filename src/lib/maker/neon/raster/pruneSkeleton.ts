import { contractDegreeTwo, nodeDegree, polylineLength, type SkGraph } from "@/lib/maker/neon/raster/skeletonGraph";

export interface PruneOptions {
  /** Radio local del trazo (px) en un punto: una rama terminal más corta que `radiusFactor × radio` en su bifurcación es un abultamiento de esquina, no un trazo. */
  radiusAt?: (x: number, y: number) => number;
  radiusFactor?: number;
}

export interface PruneResult {
  /** Ramas terminales eliminadas. */
  branches: number;
  /** Componentes aisladas (un trazo suelto sin bifurcaciones) descartadas por ser más cortas que el mínimo. */
  isolated: number;
}

/**
 * Poda de espolones. Elimina ÚNICAMENTE ramas terminales cortas: una arista con un extremo libre (grado 1) y el otro
 * en una bifurcación (grado >= 3), de longitud menor que `minLenPx`. Nunca toca lazos, aristas entre dos bifurcaciones
 * (conexiones estructurales), ni ramas largas (el trazo diagonal de una "A", un travesaño real).
 *
 * Se repite de la más corta a la más larga: al caer un espolón la bifurcación puede pasar a grado 2 y fundir sus
 * aristas restantes (contractDegreeTwo), y recién entonces se reevalúa. Un trazo suelto (ambos extremos libres) o un lazo
 * puro más corto que el mínimo se descarta como ruido.
 */
export function pruneSkeleton(graph: SkGraph, minLenPx: number, options: PruneOptions = {}): PruneResult {
  const result: PruneResult = { branches: 0, isolated: 0 };
  if (minLenPx <= 0) return result;
  for (let guard = 0; guard < 10000; guard++) {
    let best: { edgeId: number; leafId: number; len: number } | null = null;
    for (const e of graph.edges.values()) {
      if (e.a === e.b) continue;
      const da = nodeDegree(graph, e.a), db = nodeDegree(graph, e.b);
      const leafId = da === 1 && db >= 3 ? e.a : db === 1 && da >= 3 ? e.b : -1;
      if (leafId === -1) continue;
      const len = polylineLength(e.pts);
      // Umbral efectivo: los mm pedidos, o (si es mayor) ~1.3× el radio del trazo en la bifurcación.
      const junction = graph.nodes.get(leafId === e.a ? e.b : e.a);
      const localMin = options.radiusAt && junction ? Math.max(minLenPx, (options.radiusFactor ?? 1.3) * options.radiusAt(junction.x, junction.y)) : minLenPx;
      if (len < localMin && (best === null || len < best.len || (len === best.len && e.id < best.edgeId))) best = { edgeId: e.id, leafId, len };
    }
    if (!best) break;
    graph.edges.delete(best.edgeId);
    graph.nodes.delete(best.leafId);
    result.branches++;
    contractDegreeTwo(graph);
  }
  // Trazos sueltos y lazos puros diminutos = ruido.
  for (const e of [...graph.edges.values()]) {
    if (e.a !== e.b && nodeDegree(graph, e.a) === 1 && nodeDegree(graph, e.b) === 1 && polylineLength(e.pts) < minLenPx) {
      graph.edges.delete(e.id);
      graph.nodes.delete(e.a);
      graph.nodes.delete(e.b);
      result.isolated++;
    }
  }
  graph.loops = graph.loops.filter((l) => {
    const keep = polylineLength(l, true) >= minLenPx * 2;
    if (!keep) result.isolated++;
    return keep;
  });
  return result;
}
