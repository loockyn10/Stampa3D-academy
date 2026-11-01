import { signedVolume, type IndexedMesh, type MeshReport } from "@/lib/maker/mugs/geometry/mesh";

/**
 * Mismo chequeo topológico que `analyzeMesh` (cerrada + manifold + orientada, sin triángulos degenerados) con los mismos
 * contadores y el mismo criterio, pero con una tabla hash de aristas dirigidas en arreglos tipados en vez de un `Map`: las
 * pantallas caladas tienen > 100 mil triángulos y el chequeo con `Map` dominaba el tiempo de cada cambio de parámetro.
 * Una prueba compara los dos resultados sobre mallas reales (deben ser idénticos).
 */
export function analyzeMeshFast(m: IndexedMesh): MeshReport {
  const p = m.positions;
  const nVerts = p.length / 3;
  const nTris = m.tris.length / 3;
  let nonFinite = 0;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) nonFinite++;

  let cap = 1024;
  while (cap < nTris * 3 * 2) cap <<= 1;
  const mask = cap - 1;
  const ea = new Int32Array(cap).fill(-1);
  const eb = new Int32Array(cap);
  const cnt = new Int32Array(cap);
  const slot = (a: number, b: number) => {
    let h = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b)) & mask;
    while (ea[h] !== -1 && (ea[h] !== a || eb[h] !== b)) h = (h + 1) & mask;
    return h;
  };
  const bump = (a: number, b: number) => {
    const h = slot(a, b);
    if (ea[h] === -1) {
      ea[h] = a;
      eb[h] = b;
    }
    cnt[h]++;
  };

  let degenerate = 0;
  for (let i = 0; i < m.tris.length; i += 3) {
    const a = m.tris[i], b = m.tris[i + 1], c = m.tris[i + 2];
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (!(area2 > 1e-9)) degenerate++;
    bump(a, b);
    bump(b, c);
    bump(c, a);
  }

  let boundaryEdges = 0, nonManifoldEdges = 0, inconsistentEdges = 0;
  for (let h = 0; h < cap; h++) {
    if (ea[h] === -1) continue;
    const count = cnt[h];
    const o = slot(eb[h], ea[h]);
    const opposite = ea[o] === -1 ? 0 : cnt[o];
    if (count > 1) inconsistentEdges++;
    if (opposite === 0) boundaryEdges++;
    if (count + opposite > 2) nonManifoldEdges++;
  }
  return { vertexCount: nVerts, triangleCount: nTris, nonFinite, degenerate, boundaryEdges, nonManifoldEdges, inconsistentEdges, volume: signedVolume(m) };
}
