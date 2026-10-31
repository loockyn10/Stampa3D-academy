import type { IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * Altura (mm) bajo la cual un triángulo es COLINEAL a efectos prácticos (área cero). Es mucho más estricta que la de
 * Carteles (5e-4): acá solo se reparan los triángulos de área nula; las astillas finas pero con área (alturas de
 * ~1e-5 a 5e-4 mm que deja el conformado de vértices) se conservan porque dividir a través de ellas generaba nuevos
 * triángulos nulos.
 */
const SLIVER_HEIGHT_MM = 1e-6;

/**
 * Misma reparación que `repairCollinearTriangles` (instalación de Carteles) pero sobre la malla YA indexada y con
 * aristas numéricas: elimina los triángulos colineales (un vértice sobre la arista de los otros dos) que deja la
 * triangulación de tapas con vértices en T, dividiendo el triángulo vecino a través de ese vértice. La malla sigue
 * cerrada y orientada. Con la rosca hembra (decenas de capas) la versión con claves de texto era el cuello de botella.
 */
export function repairCollinearIndexed(mesh: IndexedMesh): IndexedMesh {
  const p = mesh.positions;
  const n = p.length / 3;
  const tris = mesh.tris.slice();
  const alive: boolean[] = new Array(tris.length / 3).fill(true);
  const edges = new Map<number, number>();
  const key = (a: number, b: number) => a * n + b;
  const register = (t: number) => {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    edges.set(key(a, b), t);
    edges.set(key(b, c), t);
    edges.set(key(c, a), t);
  };
  const unregister = (t: number) => {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    edges.delete(key(a, b));
    edges.delete(key(b, c));
    edges.delete(key(c, a));
  };
  const dist = (a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  const height = (a: number, b: number, c: number) => {
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const wx = p[c * 3] - p[a * 3], wy = p[c * 3 + 1] - p[a * 3 + 1], wz = p[c * 3 + 2] - p[a * 3 + 2];
    const twiceArea = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    const longest = Math.max(dist(a, b), dist(a, c), dist(b, c));
    return longest > 0 ? twiceArea / longest : 0;
  };

  const queue: number[] = [];
  const count0 = tris.length / 3;
  for (let t = 0; t < count0; t++) {
    register(t);
    if (height(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]) < SLIVER_HEIGHT_MM) queue.push(t);
  }
  if (queue.length === 0) return mesh;

  for (let qi = 0; qi < queue.length && qi < 20000; qi++) {
    const t = queue[qi];
    if (!alive[t]) continue;
    const v = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
    // La arista más larga une los extremos; el tercer vértice `m` es el que cae sobre ella.
    const lens = [dist(v[0], v[1]), dist(v[1], v[2]), dist(v[2], v[0])];
    const longest = lens.indexOf(Math.max(...lens));
    const x = v[longest], y = v[(longest + 1) % 3], m = v[(longest + 2) % 3];
    const neighbor = edges.get(key(y, x));
    if (neighbor === undefined || !alive[neighbor] || neighbor === t) continue;
    // El vecino es (y, x, w): se parte a través de m en (y, m, w) y (m, x, w).
    const nv = [tris[neighbor * 3], tris[neighbor * 3 + 1], tris[neighbor * 3 + 2]];
    const at = nv.indexOf(y);
    if (nv[(at + 1) % 3] !== x) continue;
    const w = nv[(at + 2) % 3];
    unregister(t);
    unregister(neighbor);
    alive[t] = false;
    alive[neighbor] = false;
    for (const tri of [[y, m, w], [m, x, w]]) {
      const id = tris.length / 3;
      tris.push(tri[0], tri[1], tri[2]);
      alive.push(true);
      register(id);
    }
  }

  const out: number[] = [];
  for (let t = 0; t < alive.length; t++) if (alive[t]) out.push(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
  mesh.tris = out;
  return mesh;
}
