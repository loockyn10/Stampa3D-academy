import { addTri, addVertex, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * Punto del perfil 2D (radio, z). `mw` (0–1) es cuánto le afectan los modificadores radiales (facetas, ranuras,
 * bandas): 1 en la pared exterior, 0 en el interior y en el piso.
 */
export interface ProfilePoint {
  r: number;
  z: number;
  mw?: number;
}

export interface RevolveOptions {
  /** Cantidad de segmentos angulares. */
  segments: number;
  /** Radio final del vértice (fila `i`, ángulo `theta`). Por defecto, el radio del perfil. */
  radiusAt?: (p: ProfilePoint, theta: number, i: number) => number;
  /** true = no generar el cuadrilátero entre las filas i,i+1 y las columnas j,j+1 (hueco para la unión del asa). */
  skipQuad?: (i: number, j: number) => boolean;
}

export interface RevolveResult {
  /** Índice de vértice de la fila `i`, columna `j` (j se toma módulo `segments`). */
  vertex: (i: number, j: number) => number;
  segments: number;
  rows: number;
}

/**
 * Revoluciona un perfil ABIERTO que empieza y termina en el eje (r = 0) alrededor de Z, en sentido antihorario visto
 * desde +Z. Recorrido esperado: piso exterior -> pared exterior hacia arriba -> borde -> pared interior hacia abajo ->
 * piso interior. Con ese orden las normales salen hacia afuera del material. Los puntos sobre el eje colapsan en un
 * solo vértice (polo) y sus triángulos se abanican sin degenerados. Devuelve el mapa de vértices para que otras
 * piezas (el asa) se peguen a la MISMA malla.
 */
export function revolveProfile(mesh: IndexedMesh, profile: ProfilePoint[], opts: RevolveOptions): RevolveResult {
  const seg = Math.max(3, Math.round(opts.segments));
  const rows = profile.length;
  const grid: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const p = profile[i];
    if (p.r < 1e-9) {
      const v = addVertex(mesh, 0, 0, p.z);
      grid.push(new Array<number>(seg).fill(v));
      continue;
    }
    const row: number[] = [];
    for (let j = 0; j < seg; j++) {
      const theta = (2 * Math.PI * j) / seg;
      const r = opts.radiusAt ? opts.radiusAt(p, theta, i) : p.r;
      row.push(addVertex(mesh, r * Math.cos(theta), r * Math.sin(theta), p.z));
    }
    grid.push(row);
  }
  const vertex = (i: number, j: number) => grid[i][((j % seg) + seg) % seg];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < seg; j++) {
      if (opts.skipQuad?.(i, j)) continue;
      const a = vertex(i, j), b = vertex(i, j + 1), c = vertex(i + 1, j + 1), d = vertex(i + 1, j);
      // Normal = (b - a) x (d - a): con el perfil creciendo en +z apunta a +radio (afuera).
      addTri(mesh, a, b, c);
      addTri(mesh, a, c, d);
    }
  }
  return { vertex, segments: seg, rows };
}
