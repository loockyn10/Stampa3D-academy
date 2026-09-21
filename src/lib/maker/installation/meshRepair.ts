import type { ExtrudedMeshData } from "@/lib/maker/geometry/extrudePolygon";

/**
 * Reparación puntual de triángulos degenerados COLINEALES (área 0): aparecen cuando
 * un lazo tiene vértices en T (necesarios para soldar sin aristas de borde) y earcut
 * cierra la tapa con un triángulo de tres puntos alineados. Un triángulo (a, b, c) con
 * b sobre el segmento a-c se elimina y el triángulo vecino que comparte la arista
 * a-c se divide en dos a través de b: la malla queda cerrada y sin triángulos de área 0.
 * Sin degenerados devuelve la MISMA malla (no toca los cuerpos sin instalación).
 */

type Vec = [number, number, number];
interface Tri {
  v: [Vec, Vec, Vec];
  n: Vec;
  removed: boolean;
}

/** Altura mínima (mm) bajo la cual un triángulo se considera colineal: cubre el redondeo a float32 del STL (~3e-5 mm a 500 mm de la base). */
const SLIVER_HEIGHT_MM = 5e-4;
const key = (p: Vec) => `${p[0].toFixed(6)},${p[1].toFixed(6)},${p[2].toFixed(6)}`;
const edgeKey = (a: Vec, b: Vec) => `${key(a)}|${key(b)}`;

/** Altura del triángulo sobre su arista más larga (2·área / arista más larga). */
function height(t: [Vec, Vec, Vec]): number {
  const [a, b, c] = t;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
  const twiceArea = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
  const longest = Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]));
  return longest > 0 ? twiceArea / longest : 0;
}

export function repairCollinearTriangles(mesh: ExtrudedMeshData): ExtrudedMeshData {
  const count = mesh.positions.length / 9;
  const tris: Tri[] = [];
  const degenerate: number[] = [];
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const v: [Vec, Vec, Vec] = [
      [mesh.positions[o], mesh.positions[o + 1], mesh.positions[o + 2]],
      [mesh.positions[o + 3], mesh.positions[o + 4], mesh.positions[o + 5]],
      [mesh.positions[o + 6], mesh.positions[o + 7], mesh.positions[o + 8]],
    ];
    tris.push({ v, n: [mesh.normals[o], mesh.normals[o + 1], mesh.normals[o + 2]], removed: false });
    if (height(v) < SLIVER_HEIGHT_MM) degenerate.push(t);
  }
  if (degenerate.length === 0) return mesh;

  const edges = new Map<string, number>();
  const addEdges = (id: number) => {
    const { v } = tris[id];
    for (let e = 0; e < 3; e++) edges.set(edgeKey(v[e], v[(e + 1) % 3]), id);
  };
  tris.forEach((_, id) => addEdges(id));

  for (let qi = 0; qi < degenerate.length && qi < 10000; qi++) {
    const id = degenerate[qi];
    const tri = tris[id];
    if (tri.removed) continue;
    // Arista más larga (a -> c) y el vértice intermedio b.
    let best = 0, bestLen = -1;
    for (let e = 0; e < 3; e++) {
      const p = tri.v[e], q = tri.v[(e + 1) % 3];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (len > bestLen) { bestLen = len; best = e; }
    }
    const a = tri.v[best], c = tri.v[(best + 1) % 3], b = tri.v[(best + 2) % 3];
    const neighborId = edges.get(edgeKey(c, a));
    if (neighborId === undefined || neighborId === id || tris[neighborId].removed) continue;
    const nb = tris[neighborId];
    // El vecino contiene la arista c -> a; su tercer vértice es d.
    let d: Vec | null = null;
    for (let e = 0; e < 3; e++) if (key(nb.v[e]) === key(c) && key(nb.v[(e + 1) % 3]) === key(a)) d = nb.v[(e + 2) % 3];
    if (!d) continue;
    tri.removed = true;
    nb.removed = true;
    const t1: Tri = { v: [c, b, d], n: nb.n, removed: false };
    const t2: Tri = { v: [b, a, d], n: nb.n, removed: false };
    tris.push(t1, t2);
    addEdges(tris.length - 2);
    addEdges(tris.length - 1);
    if (height(t1.v) < SLIVER_HEIGHT_MM) degenerate.push(tris.length - 2);
    if (height(t2.v) < SLIVER_HEIGHT_MM) degenerate.push(tris.length - 1);
  }

  const positions: number[] = [];
  const normals: number[] = [];
  for (const t of tris) {
    if (t.removed) continue;
    for (const p of t.v) { positions.push(p[0], p[1], p[2]); normals.push(t.n[0], t.n[1], t.n[2]); }
  }
  return { positions, normals };
}
