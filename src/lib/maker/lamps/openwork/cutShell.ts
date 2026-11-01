import { addTri, addVertex, newMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * Anillo del lazo de revolución con un campo de corte opcional. Es el mismo contrato que `ringLoopMesh` (piel exterior hacia
 * arriba, borde, piel interior hacia abajo, borde), pero los anillos que llevan `f` (un valor por columna, en mm) se cortan
 * EXACTAMENTE por f = 0: donde f <= 0 no hay material.
 */
export interface CutRing {
  z: number;
  r: number | ((column: number) => number);
  /** Campo de corte de la fila (positivo = material). Debe ser el MISMO arreglo en el anillo exterior y en el interior de una fila. */
  f?: Float64Array;
  /** Fila de la grilla de corte (para emparejar la piel exterior con la interior). */
  row?: number;
}

const T_MIN = 0.03;

/** Posición t∈[T_MIN, 1−T_MIN] donde el campo lineal entre f1 y f2 (de signos opuestos) vale 0. */
function crossT(f1: number, f2: number): number {
  const d = f1 - f2;
  if (d === 0) return 0.5;
  return Math.min(1 - T_MIN, Math.max(T_MIN, f1 / d));
}

interface PolyVertex {
  id: number;
  /** Arista de corte de la que sale (null = vértice de la grilla). */
  cross: { kind: 0 | 1; p: number; j: number } | null;
}

/**
 * Malla cerrada de un lazo de anillos con aberturas reales. Algoritmo (marching squares sobre la grilla de la superficie):
 *  - una celda con las cuatro esquinas macizas es un cuadrilátero normal;
 *  - una celda cortada se recorta con Sutherland–Hodgman contra f > 0 (polígono convexo, abanico de triángulos);
 *  - los puntos de corte se crean UNA vez por arista de la grilla y piel, así las celdas vecinas comparten vértice
 *    (sin costuras) y la piel exterior y la interior se cortan por las mismas curvas;
 *  - a lo largo de cada curva de corte se levanta una pared que une el vértice exterior con el interior (el flanco de la tira);
 *  - los bordes del lazo (anillos superior e inferior) se recortan en 1D con el mismo criterio.
 * El resultado es una única superficie cerrada, orientada y sin aristas libres por construcción: no hay CSG ni uniones booleanas
 * entre tiras (el campo ya es la unión).
 */
export function cutShellMesh(outer: CutRing[], inner: CutRing[], nTheta: number): IndexedMesh {
  const mesh = newMesh();
  const rings = [...outer, ...inner];
  const L = rings.length;
  const nOuter = outer.length;
  const cosT = new Float64Array(nTheta + 1);
  const sinT = new Float64Array(nTheta + 1);
  for (let j = 0; j <= nTheta; j++) {
    cosT[j] = Math.cos((2 * Math.PI * j) / nTheta);
    sinT[j] = Math.sin((2 * Math.PI * j) / nTheta);
  }
  const radius = (p: number, j: number) => {
    const r = rings[p].r;
    return typeof r === "number" ? r : r(((j % nTheta) + nTheta) % nTheta);
  };

  const nodes = new Int32Array(L * nTheta).fill(-1);
  const node = (p: number, j: number) => {
    const jj = ((j % nTheta) + nTheta) % nTheta;
    const k = p * nTheta + jj;
    if (nodes[k] < 0) {
      const r = radius(p, jj);
      nodes[k] = addVertex(mesh, r * cosT[jj], r * sinT[jj], rings[p].z);
    }
    return nodes[k];
  };
  const fAt = (p: number, j: number) => rings[p].f![((j % nTheta) + nTheta) % nTheta];

  /** Punto de corte de la arista (kind 0: horizontal en el anillo p entre j y j+1; kind 1: vertical entre los anillos p y p+1 en la columna j). */
  const crossings = new Map<number, number>();
  const cross = (kind: 0 | 1, p: number, j: number): number => {
    const jj = ((j % nTheta) + nTheta) % nTheta;
    const key = (p * 2 + kind) * nTheta + jj;
    const hit = crossings.get(key);
    if (hit !== undefined) return hit;
    const p2 = kind === 0 ? p : (p + 1) % L;
    const j2 = kind === 0 ? jj + 1 : jj;
    const a = node(p, jj), b = node(p2, j2);
    const t = crossT(fAt(p, jj), fAt(p2, j2));
    const pos = mesh.positions;
    const id = addVertex(mesh, pos[a * 3] + (pos[b * 3] - pos[a * 3]) * t, pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * t, pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * t);
    crossings.set(key, id);
    return id;
  };

  // Partner de una arista de corte de la piel exterior en la piel interior (misma fila de la grilla).
  const innerOfRow = new Map<number, number>();
  for (let q = 0; q < inner.length; q++) {
    const row = inner[q].row;
    if (row !== undefined) innerOfRow.set(row, nOuter + q);
  }
  const partner = (c: { kind: 0 | 1; p: number; j: number }): { kind: 0 | 1; p: number; j: number } => {
    if (c.kind === 0) return { kind: 0, p: innerOfRow.get(rings[c.p].row!)!, j: c.j };
    // vertical entre las filas i (anillo p) e i+1 (anillo p+1): en la piel interior el anillo de la fila i+1 va primero
    return { kind: 1, p: innerOfRow.get(rings[c.p + 1].row!)!, j: c.j };
  };

  const quad = (p: number, q: number, j: number) => {
    const a = node(p, j), b = node(p, j + 1), c = node(q, j + 1), d = node(q, j);
    addTri(mesh, a, b, c);
    addTri(mesh, a, c, d);
  };

  for (let p = 0; p < L; p++) {
    const q = (p + 1) % L;
    const A = rings[p], B = rings[q];
    const sameSkin = (p < nOuter - 1) || (p >= nOuter && p < L - 1);
    const isCap = !sameSkin; // salto exterior -> interior (borde superior) o interior -> exterior (borde inferior)
    if (!A.f || !B.f) {
      for (let j = 0; j < nTheta; j++) quad(p, q, j);
      continue;
    }

    if (isCap) {
      // Borde recortado en 1D: las dos filas son la misma fila de la grilla.
      for (let j = 0; j < nTheta; j++) {
        const in0 = fAt(p, j) > 0, in1 = fAt(p, j + 1) > 0;
        if (in0 && in1) quad(p, q, j);
        else if (in0) {
          const x = cross(0, p, j), y = cross(0, q, j);
          const a = node(p, j), d = node(q, j);
          addTri(mesh, a, x, y);
          addTri(mesh, a, y, d);
        } else if (in1) {
          const x = cross(0, p, j), y = cross(0, q, j);
          const b = node(p, j + 1), c = node(q, j + 1);
          addTri(mesh, x, b, c);
          addTri(mesh, x, c, y);
        }
      }
      continue;
    }

    const isOuterSkin = p < nOuter;
    for (let j = 0; j < nTheta; j++) {
      const j1 = j + 1;
      const f0 = fAt(p, j), f1 = fAt(p, j1), f2 = fAt(q, j1), f3 = fAt(q, j);
      const i0 = f0 > 0, i1 = f1 > 0, i2 = f2 > 0, i3 = f3 > 0;
      const count = (i0 ? 1 : 0) + (i1 ? 1 : 0) + (i2 ? 1 : 0) + (i3 ? 1 : 0);
      if (count === 0) continue;
      if (count === 4) {
        quad(p, q, j);
        continue;
      }
      // Sutherland–Hodgman sobre [c0, c1, c2, c3] (antihorario en (columna, anillo)).
      const poly: PolyVertex[] = [];
      const corners = [
        { p, j, inside: i0 },
        { p, j: j1, inside: i1 },
        { p: q, j: j1, inside: i2 },
        { p: q, j, inside: i3 },
      ];
      // aristas entre esquinas consecutivas: e0 H(p,j); e1 V(p,j1); e2 H(q,j) [c2->c3]; e3 V(p,j) [c3->c0]
      const edges: { kind: 0 | 1; p: number; j: number }[] = [
        { kind: 0, p, j },
        { kind: 1, p, j: j1 },
        { kind: 0, p: q, j },
        { kind: 1, p, j },
      ];
      for (let k = 0; k < 4; k++) {
        const X = corners[k], Y = corners[(k + 1) % 4];
        if (X.inside) poly.push({ id: node(X.p, X.j), cross: null });
        if (X.inside !== Y.inside) {
          const e = edges[k];
          poly.push({ id: cross(e.kind, e.p, e.j), cross: e });
        }
      }
      for (let k = 1; k + 1 < poly.length; k++) addTri(mesh, poly[0].id, poly[k].id, poly[k + 1].id);

      if (isOuterSkin) {
        // Pared: cada tramo de la curva de corte (dos puntos de corte consecutivos del polígono) se extruye hasta la piel interior.
        for (let k = 0; k < poly.length; k++) {
          const P = poly[k], Q = poly[(k + 1) % poly.length];
          if (!P.cross || !Q.cross) continue;
          const pi = partner(P.cross), qi = partner(Q.cross);
          const Pi = cross(pi.kind, pi.p, pi.j), Qi = cross(qi.kind, qi.p, qi.j);
          addTri(mesh, P.id, Pi, Qi);
          addTri(mesh, P.id, Qi, Q.id);
        }
      }
    }
  }
  return mesh;
}
