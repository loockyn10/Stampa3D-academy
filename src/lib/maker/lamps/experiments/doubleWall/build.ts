import { addTri, addVertex, newMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";
import { createDoubleWallSurfaces, planeAngle, type DoubleWallParams, type DoubleWallStrategy } from "@/lib/maker/lamps/experiments/doubleWall/profiles";

/**
 * Mallador de las dos estrategias. Ambas son un LOFT de una sección horizontal (polígono con huecos) a lo largo de z, sin CSG:
 * en cada fila se calculan los lazos de la sección con la MISMA cantidad de vértices, las caras laterales unen filas
 * consecutivas y las tapas inferior y superior se arman con tiras de cuadriláteros entre pares de lazos. Todo es manifold por
 * construcción (se verifica además con `analyzeMeshFast`/`analyzeMesh` en los tests).
 *
 * PROTOTIPO A — "vase-c": sección en C. UN contorno exterior continuo que recorre, en este orden: la cara exterior de la pared
 * exterior → el flanco de una abertura vertical → la cara de la pared interior que mira al vacío central → el flanco de la otra
 * mitad de la abertura; y UN hueco (la cámara de aire), limitado por las caras internas de ambas paredes y por dos placas de
 * unión (una a cada lado de la abertura). La abertura atraviesa pared exterior, cámara y pared interior en línea recta: comunica
 * el vacío central con el exterior, y por eso el contorno exterior de la capa incluye a las dos paredes (lo que un laminador en
 * modo jarrón recorre como una sola línea).
 *
 * PROTOTIPO B — "conventional": dos anillos cerrados (sin abertura) unidos por `ribs` nervios radiales de altura completa.
 * Sección: contorno exterior circular, hueco central circular y `ribs` huecos (sectores de la cámara). Sin voladizos, sin puentes
 * y sin tapas: se imprime vertical sin soportes.
 */
export interface DoubleWallBuild {
  mesh: IndexedMesh;
  strategy: DoubleWallStrategy;
  params: DoubleWallParams;
  rows: number;
  /** Rangos de triángulos por superficie ("outerFace", "chamberOuter", "chamberInner", "innerFace", "flanks", "caps"). */
  groups: Record<string, [number, number][]>;
  /** Acimut (rad) del eje de la abertura (A) o del primer nervio (B). */
  axisAngle: number;
}

const TAU = Math.PI * 2;
const SLIT_AZIMUTH = Math.PI; // la abertura "posterior" apunta a −X

interface ArcSet {
  co: number[]; // cara exterior de la pared exterior
  ho: number[]; // cara de la pared exterior que mira a la cámara
  ci: number[]; // cara de la pared interior que mira al vacío central
  hi: number[]; // cara de la pared interior que mira a la cámara
}

export function buildDoubleWall(params: DoubleWallParams, strategy: DoubleWallStrategy): DoubleWallBuild {
  const surf = createDoubleWallSurfaces(params);
  const mesh = newMesh();
  const rows = Math.max(2, Math.ceil(params.heightMm / params.rowMm)) + 1;
  const groups: Record<string, [number, number][]> = {};
  const group = (name: string, from: number) => {
    (groups[name] ??= []).push([from, mesh.tris.length / 3]);
  };
  const vertex = (r: number, theta: number, z: number) => addVertex(mesh, r * Math.cos(theta), r * Math.sin(theta), z);

  // ---- Arcos por fila: [fila][arco] -> ArcSet
  const vase = strategy === "vase-c";
  const K = vase ? 1 : Math.max(2, Math.round(params.ribs));
  const mo = vase ? params.outer.flutes * params.samplesPerFlute : Math.max(8, Math.ceil((params.outer.flutes * params.samplesPerFlute) / K));
  const mi = vase ? params.innerSegments : Math.max(8, Math.ceil(params.innerSegments / K));
  const alpha0 = SLIT_AZIMUTH;
  const t = params.wallMm;
  const dContour = vase ? params.slitMm / 2 : params.ribMm / 2;
  const dHole = vase ? params.slitMm / 2 + t : params.ribMm / 2;

  const sets: ArcSet[][] = [];
  for (let i = 0; i < rows; i++) {
    const z = (params.heightMm * i) / (rows - 1);
    const s = surf(z);
    const row: ArcSet[] = [];
    for (let a = 0; a < K; a++) {
      const aCenter = alpha0 + (TAU * a) / K;
      const aNext = aCenter + TAU / K;
      const arc = (r: (theta: number) => number, d: number, m: number): number[] => {
        const start = aCenter + planeAngle(r, aCenter, d, 1);
        const end = aNext - planeAngle(r, aNext, d, -1);
        const ids: number[] = [];
        for (let j = 0; j <= m; j++) {
          const theta = start + ((end - start) * j) / m;
          ids.push(vertex(r(theta), theta, z));
        }
        return ids;
      };
      row.push({
        co: arc(s.ro, dContour, mo),
        ho: arc(s.roi, dHole, mo),
        ci: arc(() => s.rii, dContour, mi),
        hi: arc(() => s.rio, dHole, mi),
      });
    }
    sets.push(row);
  }

  // ---- Caras laterales: cadena de vértices por fila (cerrada o abierta); sólido a la izquierda del recorrido => normal a la derecha
  const lateral = (name: string, chain: (i: number) => number[], closed: boolean, from = 0, to = rows - 1) => {
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
    group(name, start);
  };
  const rev = (ids: number[]) => [...ids].reverse();

  if (vase) {
    const A = (i: number) => sets[i][0];
    // contorno exterior: Co (0..M) -> flanco Q -> Ci (M..0) -> flanco P
    lateral("outerFace", (i) => A(i).co, false);
    lateral("flanks", (i) => [A(i).co[mo], A(i).ci[mi]], false);
    lateral("innerFace", (i) => rev(A(i).ci), false);
    lateral("flanks", (i) => [A(i).ci[0], A(i).co[0]], false);
    // hueco (cámara): Ho (M..0) -> placa P -> Hi (0..M) -> placa Q
    lateral("chamberOuter", (i) => rev(A(i).ho), false);
    lateral("plates", (i) => [A(i).ho[0], A(i).hi[0]], false);
    lateral("chamberInner", (i) => A(i).hi, false);
    lateral("plates", (i) => [A(i).hi[mi], A(i).ho[mo]], false);
  } else {
    // contorno exterior: anillo completo (los arcos de cada sector, unidos por la cuerda sobre el nervio)
    lateral("outerFace", (i) => sets[i].flatMap((s) => s.co), true);
    lateral("innerFace", (i) => [...sets[i]].reverse().flatMap((s) => rev(s.ci)), true);
    for (let a = 0; a < K; a++) {
      lateral("chamberOuter", (i) => rev(sets[i][a].ho), false);
      lateral("ribs", (i) => [sets[i][a].ho[0], sets[i][a].hi[0]], false);
      lateral("chamberInner", (i) => sets[i][a].hi, false);
      lateral("ribs", (i) => [sets[i][a].hi[mi], sets[i][a].ho[mo]], false);
    }
  }

  // ---- Tapas (tiras de cuadriláteros). El sentido de cada triángulo se fija por la normal z deseada.
  const cap = (i: number, up: boolean) => {
    const start = mesh.tris.length / 3;
    const p = mesh.positions;
    const tri = (a: number, b: number, c: number) => {
      const z = (p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) - (p[b * 3 + 1] - p[a * 3 + 1]) * (p[c * 3] - p[a * 3]);
      if (z === 0) return;
      if (up === z > 0) addTri(mesh, a, b, c);
      else addTri(mesh, a, c, b);
    };
    const quad = (a: number, b: number, c: number, d: number) => {
      tri(a, b, c);
      tri(a, c, d);
    };
    const strip = (x: number[], y: number[]) => {
      for (let j = 0; j + 1 < x.length; j++) quad(x[j], x[j + 1], y[j + 1], y[j]);
    };
    for (let a = 0; a < K; a++) {
      const s = sets[i][a];
      strip(s.co, s.ho); // pared exterior
      strip(s.ci, s.hi); // pared interior
    }
    if (vase) {
      const s = sets[i][0];
      quad(s.co[0], s.ci[0], s.hi[0], s.ho[0]); // placa P (entre el flanco y la cara de la cámara)
      quad(s.co[mo], s.ci[mi], s.hi[mi], s.ho[mo]); // placa Q
    } else {
      // nervio entre el sector a−1 y el sector a: tres cuadriláteros (franja de pared exterior, cuerpo del nervio, franja de pared interior)
      for (let a = 0; a < K; a++) {
        const prev = sets[i][(a + K - 1) % K], cur = sets[i][a];
        quad(prev.co[mo], cur.co[0], cur.ho[0], prev.ho[mo]);
        quad(prev.ho[mo], cur.ho[0], cur.hi[0], prev.hi[mi]);
        quad(prev.hi[mi], cur.hi[0], cur.ci[0], prev.ci[mi]);
      }
    }
    group("caps", start);
  };
  cap(0, false);
  cap(rows - 1, true);

  return { mesh, strategy, params, rows, groups, axisAngle: alpha0 };
}
