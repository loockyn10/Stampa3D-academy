import type { PartKind, TriangleSoupData } from "@/lib/maker/types";

/**
 * Orientación de IMPRESIÓN recomendada por tipo de pieza: fuente ÚNICA para la
 * Vista Cama (printBed/bedLayout.ts) y la exportación STL (exporters/parts.ts).
 * No toca la geometría fuente ni el Model View (que siguen en la orientación
 * "armada"): es una transformación que se aplica al imprimir/exportar.
 *
 * Política (ver docs/STAMPA_MAKER.md sección 22):
 *  - body: identidad. Apoya sobre su base (Z=0) y la cavidad mira hacia arriba.
 *  - lid: 180° en Y. La cara visible queda contra la cama y el labio interior
 *    (si existe) hacia arriba, sin voladizos.
 *  - mask: 180° en Y. La cara plana perforada apoya en la cama y el faldón sube.
 *  - diffuser / channelDiffuser: identidad. Son placas planas; cualquiera de
 *    sus caras puede apoyar.
 * Agregar un PartKind nuevo obliga (por el tipo `Record`) a decidir su
 * orientación acá.
 */
export interface PrintTransform {
  rotationXDeg: number;
  rotationYDeg: number;
  rotationZDeg: number;
}

const NONE: PrintTransform = { rotationXDeg: 0, rotationYDeg: 0, rotationZDeg: 0 };
const FLIP_Y: PrintTransform = { rotationXDeg: 0, rotationYDeg: 180, rotationZDeg: 0 };

export const PRINT_TRANSFORM_BY_KIND: Record<PartKind, PrintTransform> = {
  body: NONE,
  lid: FLIP_Y,
  mask: FLIP_Y,
  diffuser: NONE,
  channelDiffuser: NONE,
};

export function getPrintTransform(kind: PartKind): PrintTransform {
  return PRINT_TRANSFORM_BY_KIND[kind];
}

export type Matrix3 = [[number, number, number], [number, number, number], [number, number, number]];

function trig(deg: number): { c: number; s: number } {
  const rad = (deg * Math.PI) / 180;
  const snap = (v: number) => (Math.abs(v) < 1e-12 ? 0 : Math.abs(v - 1) < 1e-12 ? 1 : Math.abs(v + 1) < 1e-12 ? -1 : v);
  return { c: snap(Math.cos(rad)), s: snap(Math.sin(rad)) };
}

function mul(a: Matrix3, b: Matrix3): Matrix3 {
  const out: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i][j] += a[i][k] * b[k][j];
  return out;
}

/** Matriz de rotación 3x3 de un PrintTransform (se aplica X, luego Y, luego Z). */
export function printRotationMatrix(t: PrintTransform): Matrix3 {
  const x = trig(t.rotationXDeg);
  const y = trig(t.rotationYDeg);
  const z = trig(t.rotationZDeg);
  const rx: Matrix3 = [[1, 0, 0], [0, x.c, -x.s], [0, x.s, x.c]];
  const ry: Matrix3 = [[y.c, 0, y.s], [0, 1, 0], [-y.s, 0, y.c]];
  const rz: Matrix3 = [[z.c, -z.s, 0], [z.s, z.c, 0], [0, 0, 1]];
  return mul(rz, mul(ry, rx));
}

export function isIdentityTransform(t: PrintTransform): boolean {
  return t.rotationXDeg === 0 && t.rotationYDeg === 0 && t.rotationZDeg === 0;
}

export interface Bounds3 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export function meshBounds(positions: Float32Array): Bounds3 {
  const b: Bounds3 = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

/** Bounds de una caja tras aplicar la rotación `m` (alrededor del origen). */
export function rotatedBounds(b: Bounds3, m: Matrix3): Bounds3 {
  const out: Bounds3 = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const x of [b.minX, b.maxX]) {
    for (const y of [b.minY, b.maxY]) {
      for (const z of [b.minZ, b.maxZ]) {
        const px = m[0][0] * x + m[0][1] * y + m[0][2] * z;
        const py = m[1][0] * x + m[1][1] * y + m[1][2] * z;
        const pz = m[2][0] * x + m[2][1] * y + m[2][2] * z;
        out.minX = Math.min(out.minX, px); out.maxX = Math.max(out.maxX, px);
        out.minY = Math.min(out.minY, py); out.maxY = Math.max(out.maxY, py);
        out.minZ = Math.min(out.minZ, pz); out.maxZ = Math.max(out.maxZ, pz);
      }
    }
  }
  return out;
}

/**
 * Malla lista para imprimir/exportar: aplica el PrintTransform del tipo de
 * pieza rotando alrededor del centro XY de su caja (la pieza queda donde
 * estaba en el plano) y la apoya en Z=0 (`minZ = 0`, nunca Z negativo). Con
 * orientación identidad devuelve la MISMA malla sin tocarla (el cuerpo se
 * exporta byte a byte como siempre).
 */
export function orientMeshForPrint(mesh: TriangleSoupData, kind: PartKind): TriangleSoupData {
  const transform = getPrintTransform(kind);
  if (isIdentityTransform(transform) || mesh.triangleCount === 0) return mesh;

  const m = printRotationMatrix(transform);
  const src = meshBounds(mesh.positions);
  const cx = (src.minX + src.maxX) / 2;
  const cy = (src.minY + src.maxY) / 2;
  const rotated = rotatedBounds({ ...src, minX: -(src.maxX - src.minX) / 2, maxX: (src.maxX - src.minX) / 2, minY: -(src.maxY - src.minY) / 2, maxY: (src.maxY - src.minY) / 2 }, m);
  // rotatedBounds sobre la caja centrada en XY da el mínimo Z resultante (y el
  // recentrado XY se hace restando el centro antes de rotar y sumándolo después).
  const minZ = rotated.minZ;

  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i] - cx, y = mesh.positions[i + 1] - cy, z = mesh.positions[i + 2];
    positions[i] = m[0][0] * x + m[0][1] * y + m[0][2] * z + cx;
    positions[i + 1] = m[1][0] * x + m[1][1] * y + m[1][2] * z + cy;
    positions[i + 2] = m[2][0] * x + m[2][1] * y + m[2][2] * z - minZ;
    const nx = mesh.normals[i], ny = mesh.normals[i + 1], nz = mesh.normals[i + 2];
    normals[i] = m[0][0] * nx + m[0][1] * ny + m[0][2] * nz;
    normals[i + 1] = m[1][0] * nx + m[1][1] * ny + m[1][2] * nz;
    normals[i + 2] = m[2][0] * nx + m[2][1] * ny + m[2][2] * nz;
  }
  return { positions, normals, triangleCount: mesh.triangleCount };
}
