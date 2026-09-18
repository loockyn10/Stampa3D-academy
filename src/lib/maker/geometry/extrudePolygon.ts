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
  /** Paredes laterales entre z0 y z1. Default true; false = solo tapa(s), sin volumen propio (ver createLetterGeometry.ts, repisa del núcleo erosionado). */
  sides?: boolean;
  /**
   * Invierte el winding (y por lo tanto la normal) de las paredes
   * laterales, sin tocar la clasificación outer/holes usada para las
   * tapas. Sirve cuando el mismo conjunto de contornos se reutiliza para
   * generar una pared cuyo material queda del lado OPUESTO al que
   * asumiría por su propia forma (ver "núcleo erosionado" en
   * createLetterGeometry.ts: como región, su material natural es su
   * propio interior, pero para la letra soldada el material real está
   * afuera de él).
   */
  flipSides?: boolean;
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
 *
 * `sides: false` genera solo tapa(s), sin paredes laterales propias: sirve
 * para agregar una superficie plana (p.ej. la repisa del núcleo erosionado
 * en createLetterGeometry.ts) que se suelda por coordenadas compartidas con
 * las paredes laterales de otra pieza, sin volumen ni caras extra.
 */
export function extrudeContourGroups(groups: ContourGroup[], z0: number, z1: number, options: ExtrudeOptions = {}): ExtrudedMeshData {
  const { capStart = true, capEnd = true, sides = true, flipSides = false } = options;
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
    const outer = ensureOrientation(group.outer, false).map(snapToGrid);
    const holes = group.holes.map((hole) => ensureOrientation(hole, true).map(snapToGrid));
    // earcut conecta cada hueco con el contorno exterior eligiendo un
    // "puente" con su propia heurística interna; cuando varios vértices
    // quedan exactamente alineados (mismo X o Y — frecuente en polígonos
    // que salen de un offset con tramos rectos, tanto de fuentes como de
    // Clipper; no es específico de ninguna letra), esa heurística puede
    // elegir un puente cuyo borde interno no encuentra su contraparte
    // (malla no-manifold) o cuyo triángulo resultante tiene área ~0
    // (triángulo degenerado). Se aplica acá un jitter determinístico
    // ínfimo (muy por debajo de cualquier tolerancia de impresión) a los
    // puntos reales, antes de triangular Y de generar las paredes
    // laterales, para que ambas partes usen exactamente las mismas
    // coordenadas y ninguna quede exactamente colineal por accidente.
    const rings: Point2D[][] = [outer, ...holes].map(jitterRing);

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

    if (sides) {
      for (const ring of rings) {
        const m = ring.length;
        for (let i = 0; i < m; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[(i + 1) % m];
          const p1: [number, number, number] = [x1, y1, z0];
          const p2: [number, number, number] = [x2, y2, z1];
          const p3: [number, number, number] = [x2, y2, z0];
          const p4: [number, number, number] = [x1, y1, z1];
          if (flipSides) {
            pushTriangle(p1, p3, p2);
            pushTriangle(p1, p2, p4);
          } else {
            pushTriangle(p1, p2, p3);
            pushTriangle(p1, p4, p2);
          }
        }
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

// Misma grilla que CLIPPER_SCALE en offsets.ts (0.0001 mm). Las salidas de
// Clipper ya quedan exactamente sobre esta grilla (trabaja con enteros
// internamente); los contornos que vienen directo de la fuente, no — para
// que un mismo borde físico (p.ej. el contorno exterior, que no cambia de
// forma en ningún punto de la pieza) dé EXACTAMENTE las mismas coordenadas
// venga de donde venga, se redondean acá antes de aplicar jitter. Sin este
// paso, dos copias del mismo borde con una diferencia de ~0.00001-0.00005mm
// pueden caer en celdas de grilla distintas después del jitter,
// dejando la letra como shells separados en vez de un único sólido
// soldado (ver createLetterGeometry.ts).
const COORDINATE_GRID = 10000;

function snapToGrid([x, y]: Point2D): Point2D {
  return [Math.round(x * COORDINATE_GRID) / COORDINATE_GRID, Math.round(y * COORDINATE_GRID) / COORDINATE_GRID];
}

// Jitter determinístico (no aleatorio: mismo punto de entrada -> mismo
// resultado siempre, incluso entre llamadas separadas como fondo/pared)
// muy por debajo de cualquier precisión de impresión 3D relevante.
const TRIANGULATION_JITTER_MM = 1e-4;

function hash01(x: number, y: number, salt: number): number {
  const h = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

function jitterRing(ring: Point2D[]): Point2D[] {
  return ring.map(([x, y]) => [
    x + (hash01(x, y, 1) - 0.5) * TRIANGULATION_JITTER_MM,
    y + (hash01(x, y, 2) - 0.5) * TRIANGULATION_JITTER_MM,
  ]);
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
