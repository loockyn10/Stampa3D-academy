import { addTri, addVertex, newMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";
import { createDoubleWallSurfaces, doubleWallZones, planeAngle, type DoubleWallParams, type DoubleWallStrategy } from "@/lib/maker/lamps/doublewall/profiles";

/**
 * Mallador de las dos estrategias. Ambas son un LOFT de una sección horizontal a lo largo de z (sin CSG): en cada fila se
 * calculan los lazos de la sección con la MISMA cantidad de vértices, las caras laterales unen filas consecutivas y las
 * superficies horizontales (tapas, piso y cielorraso de la cámara) se arman con zippers entre pares de lazos. Todo es manifold
 * por construcción (se verifica además con `analyzeMeshFast` en los tests).
 *
 * Sección por zona (de abajo hacia arriba):
 *   PISO  (z < floorMm): material macizo entre la cara exterior de la pared exterior y la cara de la pared interior que mira al
 *                        vacío central (la abertura central NO se tapa).
 *   PAREDES RECTAS:     pared exterior + pared interior separadas por la cámara de aire.
 *   TECHO (roofHeightMm): las dos paredes se inclinan una hacia la otra; la cámara se angosta hasta `topGapMm`.
 *   TAPA (roofCapMm):   rim vertical de altura constante.
 *
 * PROTOTIPO A — "vase-c": sección en C. UN contorno exterior continuo (cara exterior de la pared exterior → flanco de la abertura
 * posterior → cara de la pared interior que mira al vacío central → flanco opuesto) y, sobre el piso, UN hueco (la cámara). La
 * abertura posterior atraviesa todo, incluido el piso. La cámara queda abierta arriba (ranura de `topGapMm`): un cielorraso sería una
 * superficie horizontal que rompe la espiral del modo jarrón.
 *
 * PROTOTIPO B — "conventional": dos anillos cerrados (sin abertura) unidos por el piso y por el techo; la cámara queda CERRADA
 * (cavidad interna con piso plano y cielorraso inclinado/plano de `roofCapMm`). La malla tiene dos superficies conexas (el exterior y
 * la cavidad), pero es UN solo sólido.
 */
export interface DoubleWallBuild {
  mesh: IndexedMesh;
  strategy: DoubleWallStrategy;
  params: DoubleWallParams;
  rows: number;
  /** Alturas de las filas y de los cambios de sección. */
  zRows: number[];
  zones: { floorTop: number; roofStart: number; ceiling: number };
  /** Rangos de triángulos por superficie. */
  groups: Record<string, [number, number][]>;
  /** Acimut (rad) del eje de la abertura (A). */
  axisAngle: number;
}

const TAU = Math.PI * 2;
const SLIT_AZIMUTH = Math.PI; // la abertura "posterior" apunta a −X

export function buildDoubleWall(params: DoubleWallParams, strategy: DoubleWallStrategy): DoubleWallBuild {
  const surf = createDoubleWallSurfaces(params);
  const zones = doubleWallZones(params);
  const mesh = newMesh();
  const vase = strategy === "vase-c";
  const groups: Record<string, [number, number][]> = {};
  const mark = (name: string, from: number) => {
    (groups[name] ??= []).push([from, mesh.tris.length / 3]);
  };
  const vertex = (r: number, theta: number, z: number) => addVertex(mesh, r * Math.cos(theta), r * Math.sin(theta), z);

  // ---- Filas: uniformes + las alturas donde cambia la sección (el piso y el cielorraso deben caer exactamente sobre una fila)
  const H = params.heightMm;
  const uniform = Math.max(2, Math.ceil(H / params.rowMm));
  const zs: number[] = [];
  for (let i = 0; i <= uniform; i++) zs.push((H * i) / uniform);
  for (const z of [zones.floorTop, zones.roofStart, zones.ceiling]) zs.push(z);
  zs.sort((a, b) => a - b);
  const zRows = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 1e-6);
  const rows = zRows.length;
  const rowOf = (z: number) => zRows.findIndex((v) => Math.abs(v - z) < 1e-6);
  const iFloor = rowOf(zones.floorTop);
  const iCeil = rowOf(zones.ceiling);
  const last = rows - 1;

  const mo = params.outer.flutes * params.samplesPerFlute;
  const mi = params.innerSegments;
  const dContour = params.slitMm / 2;
  const dHole = params.slitMm / 2 + params.wallMm;
  const alpha = SLIT_AZIMUTH;

  interface Row {
    co: number[]; // cara exterior de la pared exterior
    ho: number[]; // cara de la pared exterior que mira a la cámara
    ci: number[]; // cara de la pared interior que mira al vacío central
    hi: number[]; // cara de la pared interior que mira a la cámara
  }
  const sections: Row[] = zRows.map((z) => {
    const s = surf(z);
    if (vase) {
      // arcos abiertos entre los planos de la abertura (y = ±d), muestreados uniformemente en el ángulo
      const arc = (r: (theta: number) => number, d: number, m: number): number[] => {
        const start = alpha + planeAngle(r, alpha, d, 1);
        const end = alpha + TAU - planeAngle(r, alpha + TAU, d, -1);
        const ids: number[] = [];
        for (let j = 0; j <= m; j++) {
          const theta = start + ((end - start) * j) / m;
          ids.push(vertex(r(theta), theta, z));
        }
        return ids;
      };
      return { co: arc(s.ro, dContour, mo), ho: arc(s.roi, dHole, mo), ci: arc(() => s.rii, dContour, mi), hi: arc(() => s.rio, dHole, mi) };
    }
    // anillos cerrados: j = 0 en θ = 0, uniformes
    const ring = (r: (theta: number) => number, m: number): number[] => {
      const ids: number[] = [];
      for (let j = 0; j < m; j++) {
        const theta = (TAU * j) / m;
        ids.push(vertex(r(theta), theta, z));
      }
      return ids;
    };
    return { co: ring(s.ro, mo), ho: ring(s.roi, mo), ci: ring(() => s.rii, mi), hi: ring(() => s.rio, mi) };
  });

  // ---- Caras laterales: sólido a la izquierda del recorrido => la normal sale por la derecha
  const lateral = (name: string, chain: (i: number) => number[], closed: boolean, from: number, to: number) => {
    const start = mesh.tris.length / 3;
    for (let i = from; i < to; i++) {
      const lo = chain(i), hi = chain(i + 1);
      const edges = closed ? lo.length : lo.length - 1;
      for (let k = 0; k < edges; k++) {
        const a = lo[k], b = lo[(k + 1) % lo.length], c = hi[(k + 1) % lo.length], d = hi[k];
        addTri(mesh, a, b, c);
        addTri(mesh, a, c, d);
      }
    }
    mark(name, start);
  };
  const rev = (ids: number[]) => [...ids].reverse();
  const S = (i: number) => sections[i];

  if (vase) {
    lateral("outerFace", (i) => S(i).co, false, 0, last);
    lateral("flanks", (i) => [S(i).co[mo], S(i).ci[mi]], false, 0, last);
    lateral("innerFace", (i) => rev(S(i).ci), false, 0, last);
    lateral("flanks", (i) => [S(i).ci[0], S(i).co[0]], false, 0, last);
    // la cámara existe desde el tope del piso hasta arriba (abierta)
    lateral("chamberOuter", (i) => rev(S(i).ho), false, iFloor, last);
    lateral("plates", (i) => [S(i).ho[0], S(i).hi[0]], false, iFloor, last);
    lateral("chamberInner", (i) => S(i).hi, false, iFloor, last);
    lateral("plates", (i) => [S(i).hi[mi], S(i).ho[mo]], false, iFloor, last);
  } else {
    lateral("outerFace", (i) => S(i).co, true, 0, last);
    lateral("innerFace", (i) => rev(S(i).ci), true, 0, last);
    // cámara cerrada: del tope del piso al cielorraso
    lateral("chamberOuter", (i) => rev(S(i).ho), true, iFloor, iCeil);
    lateral("chamberInner", (i) => S(i).hi, true, iFloor, iCeil);
  }

  // ---- Superficies horizontales. El sentido de cada triángulo se fija por la normal z deseada.
  const p = mesh.positions;
  const horizontal = (name: string, up: boolean, build: (tri: (a: number, b: number, c: number) => void) => void) => {
    const start = mesh.tris.length / 3;
    build((a, b, c) => {
      const cross = (p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) - (p[b * 3 + 1] - p[a * 3 + 1]) * (p[c * 3] - p[a * 3]);
      if (Math.abs(cross) < 1e-14) return;
      if (up === cross > 0) addTri(mesh, a, b, c);
      else addTri(mesh, a, c, b);
    });
    mark(name, start);
  };
  const ang = (id: number) => (((Math.atan2(p[id * 3 + 1], p[id * 3]) - alpha) % TAU) + TAU) % TAU;
  /** Zipper entre dos arcos abiertos (de un extremo de la abertura al otro), por ángulo. */
  const zipperOpen = (a: number[], b: number[]) => (tri: (x: number, y: number, z: number) => void) => {
    let i = 0, j = 0;
    while (i < a.length - 1 || j < b.length - 1) {
      if (i < a.length - 1 && (j >= b.length - 1 || ang(a[i + 1]) <= ang(b[j + 1]))) {
        tri(a[i], a[i + 1], b[j]);
        i++;
      } else {
        tri(a[i], b[j + 1], b[j]);
        j++;
      }
    }
  };
  /** Zipper entre dos anillos cerrados uniformes que arrancan en el mismo ángulo. */
  const zipperClosed = (a: number[], b: number[]) => (tri: (x: number, y: number, z: number) => void) => {
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && (j >= b.length || (i + 1) / a.length <= (j + 1) / b.length)) {
        tri(a[i % a.length], a[(i + 1) % a.length], b[j % b.length]);
        i++;
      } else {
        tri(a[i % a.length], b[(j + 1) % b.length], b[j % b.length]);
        j++;
      }
    }
  };
  const quadsOf = (x: number[], y: number[]) => (tri: (a: number, b: number, c: number) => void) => {
    for (let j = 0; j + 1 < x.length; j++) {
      tri(x[j], x[j + 1], y[j + 1]);
      tri(x[j], y[j + 1], y[j]);
    }
  };

  if (vase) {
    horizontal("bottom", false, zipperOpen(S(0).co, S(0).ci)); // placa maciza en C del piso (la abertura sigue abierta)
    horizontal("chamberFloor", true, zipperOpen(S(iFloor).ho, S(iFloor).hi));
    // tope: la cámara queda abierta (ranura): tiras pared exterior / pared interior y las dos placas
    horizontal("top", true, (tri) => {
      const s = S(last);
      quadsOf(s.co, s.ho)(tri);
      quadsOf(s.ci, s.hi)(tri);
      for (const [a, b, c, d] of [[s.co[0], s.ci[0], s.hi[0], s.ho[0]], [s.co[mo], s.ci[mi], s.hi[mi], s.ho[mo]]]) {
        tri(a, b, c);
        tri(a, c, d);
      }
    });
  } else {
    horizontal("bottom", false, zipperClosed(S(0).co, S(0).ci));
    horizontal("chamberFloor", true, zipperClosed(S(iFloor).ho, S(iFloor).hi));
    horizontal("ceiling", false, zipperClosed(S(iCeil).ho, S(iCeil).hi));
    horizontal("top", true, zipperClosed(S(last).co, S(last).ci));
  }

  return { mesh, strategy, params, rows, zRows, zones, groups, axisAngle: alpha };
}
