import type { Point2D } from "@/lib/maker/types";
import { nodeDegree, polylineLength, type SkGraph } from "@/lib/maker/neon/raster/skeletonGraph";

/** Recorrido en coordenadas de píxel (Y hacia abajo). En un cerrado el último punto NO repite al primero. */
export interface RawPath {
  pts: Point2D[];
  closed: boolean;
}

/**
 * Prolonga cada extremo libre a lo largo de su tangente mientras siga dentro de la máscara. El adelgazamiento retrae
 * los extremos ~medio ancho del trazo; sin esto una barra gruesa saldría más corta que en la imagen. Solo mueve extremos
 * libres (nunca bifurcaciones) y nunca más de `maxPx`.
 */
export function extendEndpoints(graph: SkGraph, mask: Uint8Array, width: number, height: number, maxPx: number): number {
  let extended = 0;
  const inside = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    return xi >= 0 && yi >= 0 && xi < width && yi < height && mask[yi * width + xi] === 1;
  };
  for (const node of graph.nodes.values()) {
    if (nodeDegree(graph, node.id) !== 1) continue;
    const e = [...graph.edges.values()].find((ed) => ed.a === node.id || ed.b === node.id);
    if (!e || e.a === e.b) continue;
    const atStart = e.a === node.id;
    const pts = atStart ? e.pts : [...e.pts].reverse(); // pts[0] = el extremo libre
    // Tangente: hacia afuera, promediada sobre ~5 px de arco para no depender del ruido de un solo píxel.
    let acc = 0, k = 1;
    while (k < pts.length - 1 && acc < 5) {
      acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      k++;
    }
    const dx = pts[0][0] - pts[k][0], dy = pts[0][1] - pts[k][1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len, uy = dy / len;
    let x = pts[0][0], y = pts[0][1], moved = 0;
    const step = 0.5;
    while (moved < maxPx && inside(x + ux * step, y + uy * step)) {
      x += ux * step;
      y += uy * step;
      moved += step;
    }
    if (moved >= 1) {
      pts[0] = [x, y];
      node.x = x;
      node.y = y;
      e.pts = atStart ? pts : pts.reverse();
      extended++;
    }
  }
  return extended;
}

/** Aristas y lazos del grafo -> recorridos. Una arista que vuelve al mismo nodo es un recorrido cerrado. */
export function graphToRawPaths(graph: SkGraph): RawPath[] {
  const out: RawPath[] = [];
  for (const e of graph.edges.values()) {
    if (e.a === e.b) out.push({ pts: e.pts.slice(0, -1), closed: true });
    else out.push({ pts: e.pts.slice(), closed: false });
  }
  for (const l of graph.loops) out.push({ pts: l.slice(), closed: true });
  return out.filter((p) => p.pts.length >= (p.closed ? 3 : 2) && polylineLength(p.pts, p.closed) > 0);
}
