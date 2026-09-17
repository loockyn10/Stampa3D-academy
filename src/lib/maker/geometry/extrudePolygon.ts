import earcut from "earcut";
import type { ContourGroup, Point2D } from "@/lib/maker/types";

export interface ExtrudedMeshData {
  /** xyz por vértice, triángulos sin indexar (cada triángulo repite sus 3 vértices). */
  positions: number[];
  normals: number[];
}

export interface ExtrudeOptions {
  /** Tapa en z0 (mirando hacia -Z). */
  capStart?: boolean;
  /** Tapa en z1 (mirando hacia +Z). */
  capEnd?: boolean;
}

/**
 * Extruye un conjunto de contornos exterior/huecos entre z0 y z1, generando
 * un sólido triangulado (tapas vía earcut + paredes laterales por arista).
 *
 * Las tapas se triangulan con earcut, que normaliza su salida a un winding
 * fijo sin importar el de entrada. Las paredes laterales, en cambio, se
 * generan directamente a partir del orden de puntos de cada contorno, así
 * que necesitan una convención de orientación conocida para dar normales
 * hacia afuera consistentes. Las fuentes (TrueType/CFF) y las salidas de
 * Clipper son cada una internamente consistentes (outer y holes van en
 * sentidos opuestos) pero usan convenciones absolutas opuestas entre sí;
 * por eso acá se normaliza explícitamente antes de extruir, en vez de
 * asumir una convención fija.
 */
export function extrudeContourGroups(groups: ContourGroup[], z0: number, z1: number, options: ExtrudeOptions = {}): ExtrudedMeshData {
  const { capStart = true, capEnd = true } = options;
  const positions: number[] = [];
  const normals: number[] = [];

  const pushTriangle = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    positions.push(...a, ...b, ...c);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let i = 0; i < 3; i++) normals.push(nx, ny, nz);
  };

  for (const group of groups) {
    const outer = ensureOrientation(group.outer, false);
    const holes = group.holes.map((hole) => ensureOrientation(hole, true));
    const rings: Point2D[][] = [outer, ...holes];

    if (capStart || capEnd) {
      const { vertices, holeIndices } = flattenForEarcut(rings);
      const triIdx = earcut(vertices, holeIndices, 2);
      for (let i = 0; i < triIdx.length; i += 3) {
        const ia = triIdx[i], ib = triIdx[i + 1], ic = triIdx[i + 2];
        const a: [number, number] = [vertices[ia * 2], vertices[ia * 2 + 1]];
        const b: [number, number] = [vertices[ib * 2], vertices[ib * 2 + 1]];
        const c: [number, number] = [vertices[ic * 2], vertices[ic * 2 + 1]];
        if (capEnd) {
          pushTriangle([a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1]);
        }
        if (capStart) {
          pushTriangle([a[0], a[1], z0], [c[0], c[1], z0], [b[0], b[1], z0]);
        }
      }
    }

    for (const ring of rings) {
      const m = ring.length;
      for (let i = 0; i < m; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % m];
        pushTriangle([x1, y1, z0], [x2, y2, z1], [x2, y2, z0]);
        pushTriangle([x1, y1, z0], [x1, y1, z1], [x2, y2, z1]);
      }
    }
  }

  return { positions, normals };
}

function signedArea(points: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/** Fuerza el sentido de giro de un contorno: positivo (CCW) o negativo (CW). */
function ensureOrientation(points: Point2D[], wantPositive: boolean): Point2D[] {
  const isPositive = signedArea(points) > 0;
  return isPositive === wantPositive ? points : [...points].reverse();
}

function flattenForEarcut(rings: Point2D[][]): { vertices: number[]; holeIndices: number[] } {
  const vertices: number[] = [];
  const holeIndices: number[] = [];
  rings.forEach((ring, idx) => {
    if (idx > 0) holeIndices.push(vertices.length / 2);
    for (const [x, y] of ring) vertices.push(x, y);
  });
  return { vertices, holeIndices };
}
