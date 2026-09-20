import type { Point2D } from "@/lib/maker/types";

/**
 * Grafo del skeleton. Nodos = extremos libres (grado 1) y bifurcaciones (grado >= 3, con los píxeles de
 * bifurcación adyacentes fundidos en un solo nodo). Aristas = cadenas de píxeles de grado 2 entre nodos,
 * como polilíneas en coordenadas de píxel (centro del píxel). Un loop sin nodos (una "O") se guarda aparte
 * como polilínea cerrada. Puro: no depende de la UI ni del DOM.
 */
export interface SkNode {
  id: number;
  x: number;
  y: number;
}

export interface SkEdge {
  id: number;
  /** ids de nodo. a === b => lazo que sale y vuelve al mismo nodo. */
  a: number;
  b: number;
  /** Incluye la posición de ambos nodos en los extremos. */
  pts: Point2D[];
}

export interface SkGraph {
  nodes: Map<number, SkNode>;
  edges: Map<number, SkEdge>;
  /** Lazos puros (componentes sin ningún nodo). Sin repetir el primer punto al final. */
  loops: Point2D[][];
  /** Píxeles aislados (componentes de 1 solo píxel): se descartan, no forman recorrido. */
  isolatedPixels: number;
  nextId: number;
}

const OFFS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
];

export function polylineLength(pts: readonly Point2D[], closed = false): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 2) len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return len;
}

/** Construye el grafo con 8-conectividad. Los extremos y bifurcaciones salen de contar vecinos de cada píxel. */
export function buildSkeletonGraph(skel: Uint8Array, width: number, height: number): SkGraph {
  const n = width * height;
  const deg = new Uint8Array(n);
  const neighborsOf = (p: number): number[] => {
    const x = p % width, y = (p - x) / width;
    const out: number[] = [];
    for (const [dx, dy] of OFFS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const q = ny * width + nx;
      if (skel[q]) out.push(q);
    }
    return out;
  };
  for (let p = 0; p < n; p++) if (skel[p]) deg[p] = neighborsOf(p).length;

  const isNode = new Uint8Array(n);
  let isolated = 0;
  for (let p = 0; p < n; p++) {
    if (!skel[p]) continue;
    if (deg[p] === 0) isolated++;
    else if (deg[p] !== 2) isNode[p] = 1;
  }

  // Nodos: componentes 8-conexas de píxeles nodo.
  const label = new Int32Array(n).fill(-1);
  const graph: SkGraph = { nodes: new Map(), edges: new Map(), loops: [], isolatedPixels: isolated, nextId: 0 };
  const clusters: number[][] = [];
  for (let p = 0; p < n; p++) {
    if (!isNode[p] || label[p] !== -1) continue;
    const id = graph.nextId++;
    const members: number[] = [];
    const stack = [p];
    label[p] = id;
    while (stack.length) {
      const q = stack.pop() as number;
      members.push(q);
      for (const r of neighborsOf(q)) {
        if (isNode[r] && label[r] === -1) {
          label[r] = id;
          stack.push(r);
        }
      }
    }
    let sx = 0, sy = 0;
    for (const q of members) {
      sx += (q % width) + 0.5;
      sy += Math.floor(q / width) + 0.5;
    }
    graph.nodes.set(id, { id, x: sx / members.length, y: sy / members.length });
    clusters[id] = members;
  }

  const visited = new Uint8Array(n);
  const center = (q: number): Point2D => [(q % width) + 0.5, Math.floor(q / width) + 0.5];

  for (const [id, node] of graph.nodes) {
    for (const p of clusters[id]) {
      for (const q0 of neighborsOf(p)) {
        if (label[q0] === id || isNode[q0] || visited[q0]) continue;
        // Recorre la cadena de grado 2 hasta otro nodo (o el mismo).
        const chain: Point2D[] = [];
        let prev = p, cur = q0, endId = -1;
        for (;;) {
          visited[cur] = 1;
          chain.push(center(cur));
          const next = neighborsOf(cur).filter((r) => r !== prev);
          // grado 2 => exactamente un vecino distinto del anterior
          const r = next[0];
          if (r === undefined) break; // no debería ocurrir (grado 2)
          if (isNode[r]) {
            endId = label[r];
            break;
          }
          prev = cur;
          cur = r;
        }
        if (endId === -1) continue;
        const b = graph.nodes.get(endId) as SkNode;
        const eid = graph.nextId++;
        graph.edges.set(eid, { id: eid, a: id, b: endId, pts: [[node.x, node.y], ...chain, [b.x, b.y]] });
      }
    }
  }

  // Un píxel de grado 2 pegado a dos píxeles del MISMO nodo genera un mini-lazo espurio (1-2 px): ruido del adelgazamiento.
  for (const e of [...graph.edges.values()]) {
    if (e.a === e.b && polylineLength(e.pts) < 4) graph.edges.delete(e.id);
  }

  // Lazos puros: píxeles de grado 2 que ninguna cadena visitó.
  for (let p = 0; p < n; p++) {
    if (!skel[p] || isNode[p] || visited[p] || deg[p] !== 2) continue;
    const loop: Point2D[] = [];
    let cur = p;
    for (;;) {
      visited[cur] = 1;
      loop.push(center(cur));
      const next = neighborsOf(cur).find((r) => !visited[r] && !isNode[r]);
      if (next === undefined) break;
      cur = next;
    }
    if (loop.length >= 3) graph.loops.push(loop);
  }
  return graph;
}

export function nodeDegree(graph: SkGraph, nodeId: number): number {
  let d = 0;
  for (const e of graph.edges.values()) {
    if (e.a === nodeId) d++;
    if (e.b === nodeId) d++;
  }
  return d;
}

function edgesOf(graph: SkGraph, nodeId: number): SkEdge[] {
  const out: SkEdge[] = [];
  for (const e of graph.edges.values()) if (e.a === nodeId || e.b === nodeId) out.push(e);
  return out;
}

function reversed(pts: Point2D[]): Point2D[] {
  return [...pts].reverse();
}

/**
 * Contrae los nodos de grado 2: une sus dos aristas en una (o cierra un lazo si es la misma arista). Deja el grafo
 * solo con extremos (1) y bifurcaciones (>=3). También borra nodos sin aristas.
 */
export function contractDegreeTwo(graph: SkGraph): void {
  let again = true;
  while (again) {
    again = false;
    for (const node of [...graph.nodes.values()]) {
      const incident = edgesOf(graph, node.id);
      const d = incident.reduce((s, e) => s + (e.a === node.id ? 1 : 0) + (e.b === node.id ? 1 : 0), 0);
      if (d === 0) {
        graph.nodes.delete(node.id);
        again = true;
        continue;
      }
      if (d !== 2) continue;
      if (incident.length === 1) {
        // lazo sobre este único nodo => lazo puro
        const e = incident[0];
        graph.loops.push(e.pts.slice(0, -1));
        graph.edges.delete(e.id);
        graph.nodes.delete(node.id);
        again = true;
        continue;
      }
      const [e1, e2] = incident;
      // e1 termina en el nodo, e2 empieza en el nodo
      const p1 = e1.b === node.id ? e1.pts : reversed(e1.pts);
      const a1 = e1.b === node.id ? e1.a : e1.b;
      const p2 = e2.a === node.id ? e2.pts : reversed(e2.pts);
      const b2 = e2.a === node.id ? e2.b : e2.a;
      graph.edges.delete(e1.id);
      graph.edges.delete(e2.id);
      graph.nodes.delete(node.id);
      const eid = graph.nextId++;
      graph.edges.set(eid, { id: eid, a: a1, b: b2, pts: [...p1, ...p2.slice(1)] });
      again = true;
    }
  }
}

/**
 * Une extremos libres que quedaron casi coincidentes (huecos de 1-3 px del umbral/adelgazamiento) con una arista
 * recta. No une nada más lejos que `tolPx`. Un extremo solo se usa una vez. Dos extremos de la MISMA cadena solo
 * se unen si la cadena es claramente más larga que el hueco (cierra un lazo, no un garabato).
 */
export function bridgeCloseEndpoints(graph: SkGraph, tolPx: number): number {
  const leaves = [...graph.nodes.values()].filter((nd) => nodeDegree(graph, nd.id) === 1);
  const cands: { a: SkNode; b: SkNode; d: number }[] = [];
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const d = Math.hypot(leaves[i].x - leaves[j].x, leaves[i].y - leaves[j].y);
      if (d <= tolPx) cands.push({ a: leaves[i], b: leaves[j], d });
    }
  }
  cands.sort((p, q) => p.d - q.d || p.a.id - q.a.id || p.b.id - q.b.id);
  const used = new Set<number>();
  let bridged = 0;
  for (const c of cands) {
    if (used.has(c.a.id) || used.has(c.b.id)) continue;
    const ea = edgesOf(graph, c.a.id)[0], eb = edgesOf(graph, c.b.id)[0];
    if (ea.id === eb.id && polylineLength(ea.pts) < 6 * tolPx) continue;
    used.add(c.a.id);
    used.add(c.b.id);
    const eid = graph.nextId++;
    graph.edges.set(eid, { id: eid, a: c.a.id, b: c.b.id, pts: [[c.a.x, c.a.y], [c.b.x, c.b.y]] });
    bridged++;
  }
  if (bridged) contractDegreeTwo(graph);
  return bridged;
}

export interface GraphSummary {
  endpoints: number;
  junctions: number;
  edges: number;
  /** Lazos puros (sin nodos), como una "O". */
  loops: number;
  /** Ciclos independientes (número ciclomático): aristas − nodos + componentes, más los lazos puros. Un "8" tiene 2. */
  cycles: number;
}

export function summarizeGraph(graph: SkGraph): GraphSummary {
  let endpoints = 0, junctions = 0;
  for (const nd of graph.nodes.values()) {
    const d = nodeDegree(graph, nd.id);
    if (d === 1) endpoints++;
    else if (d >= 3) junctions++;
  }
  // Componentes conexas del grafo (union-find sobre nodos) para el número ciclomático.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    parent.set(x, r);
    return r;
  };
  for (const id of graph.nodes.keys()) parent.set(id, id);
  for (const e of graph.edges.values()) {
    if (parent.has(e.a) && parent.has(e.b)) parent.set(find(e.a), find(e.b));
  }
  const components = new Set([...graph.nodes.keys()].map(find)).size;
  const cycles = Math.max(0, graph.edges.size - graph.nodes.size + components) + graph.loops.length;
  return { endpoints, junctions, edges: graph.edges.size, loops: graph.loops.length, cycles };
}
