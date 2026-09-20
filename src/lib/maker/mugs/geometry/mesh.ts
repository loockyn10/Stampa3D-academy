import type { TriangleSoupData } from "@/lib/maker/types";

/** Malla indexada: vértices compartidos, así que un vértice de unión pertenece a las dos superficies (sin costura). */
export interface IndexedMesh {
  positions: number[];
  tris: number[];
}

export function newMesh(): IndexedMesh {
  return { positions: [], tris: [] };
}

export function addVertex(m: IndexedMesh, x: number, y: number, z: number): number {
  m.positions.push(x, y, z);
  return m.positions.length / 3 - 1;
}

/** Ignora triángulos con índices repetidos (polos de revolución). */
export function addTri(m: IndexedMesh, a: number, b: number, c: number): void {
  if (a === b || b === c || a === c) return;
  m.tris.push(a, b, c);
}

export function translateMesh(m: IndexedMesh, dx: number, dy: number, dz: number): void {
  for (let i = 0; i < m.positions.length; i += 3) {
    m.positions[i] += dx;
    m.positions[i + 1] += dy;
    m.positions[i + 2] += dz;
  }
}

export function indexedBounds(m: IndexedMesh) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < m.positions.length; i += 3) {
    const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

/** Volumen con signo (teorema de la divergencia). Positivo = normales hacia afuera. */
export function signedVolume(m: IndexedMesh): number {
  const p = m.positions;
  let v = 0;
  for (let i = 0; i < m.tris.length; i += 3) {
    const a = m.tris[i] * 3, b = m.tris[i + 1] * 3, c = m.tris[i + 2] * 3;
    v +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  return v;
}

export interface MeshReport {
  vertexCount: number;
  triangleCount: number;
  nonFinite: number;
  degenerate: number;
  /** Aristas usadas por un solo triángulo (agujeros). */
  boundaryEdges: number;
  /** Aristas usadas por más de 2 triángulos. */
  nonManifoldEdges: number;
  /** Aristas repetidas en el mismo sentido (normales incoherentes). */
  inconsistentEdges: number;
  volume: number;
}

/** Chequeo topológico: cerrada + manifold + orientada. Un STL válido tiene todos los contadores en 0 y volumen > 0. */
export function analyzeMesh(m: IndexedMesh): MeshReport {
  const p = m.positions;
  let nonFinite = 0;
  for (const v of p) if (!Number.isFinite(v)) nonFinite++;
  let degenerate = 0;
  const directed = new Map<number, number>();
  const n = p.length / 3;
  const bump = (a: number, b: number) => {
    const k = a * n + b;
    directed.set(k, (directed.get(k) ?? 0) + 1);
  };
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
  for (const [k, count] of directed) {
    const a = Math.floor(k / n), b = k % n;
    const opposite = directed.get(b * n + a) ?? 0;
    if (count > 1) inconsistentEdges++;
    if (opposite === 0) boundaryEdges++;
    if (count + opposite > 2) nonManifoldEdges++;
  }
  return { vertexCount: n, triangleCount: m.tris.length / 3, nonFinite, degenerate, boundaryEdges, nonManifoldEdges, inconsistentEdges, volume: signedVolume(m) };
}

/** Malla indexada -> triangle soup con normales suaves (ángulo de pliegue `creaseDeg`: los bordes marcados quedan duros). */
export function meshToSoup(m: IndexedMesh, creaseDeg = 50): TriangleSoupData {
  const p = m.positions;
  const triCount = m.tris.length / 3;
  const fn = new Float32Array(triCount * 3);
  const fu = new Float32Array(triCount * 3);
  const adj: number[][] = Array.from({ length: p.length / 3 }, () => []);
  for (let t = 0; t < triCount; t++) {
    const a = m.tris[t * 3] * 3, b = m.tris[t * 3 + 1] * 3, c = m.tris[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    fn[t * 3] = nx; fn[t * 3 + 1] = ny; fn[t * 3 + 2] = nz;
    fu[t * 3] = nx / len; fu[t * 3 + 1] = ny / len; fu[t * 3 + 2] = nz / len;
    for (let k = 0; k < 3; k++) adj[m.tris[t * 3 + k]].push(t);
  }
  const cos = Math.cos((creaseDeg * Math.PI) / 180);
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = m.tris[t * 3 + k];
      let sx = 0, sy = 0, sz = 0;
      for (const o of adj[vi]) {
        if (fu[o * 3] * fu[t * 3] + fu[o * 3 + 1] * fu[t * 3 + 1] + fu[o * 3 + 2] * fu[t * 3 + 2] >= cos) {
          sx += fn[o * 3]; sy += fn[o * 3 + 1]; sz += fn[o * 3 + 2];
        }
      }
      const len = Math.hypot(sx, sy, sz) || 1;
      const o = t * 9 + k * 3;
      positions[o] = p[vi * 3]; positions[o + 1] = p[vi * 3 + 1]; positions[o + 2] = p[vi * 3 + 2];
      normals[o] = sx / len; normals[o + 1] = sy / len; normals[o + 2] = sz / len;
    }
  }
  return { positions, normals, triangleCount: triCount };
}
