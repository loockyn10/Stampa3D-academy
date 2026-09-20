import { addTri, addVertex, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";
import type { PathFrame, V3 } from "@/lib/maker/mugs/geometry/sweep";

/**
 * UNIÓN TOPOLÓGICA cuerpo/asa (sin CSG): en la pared exterior se OMITEN los cuadriláteros de una ventana rectangular
 * (la "zona de unión") y el asa se construye como un loft cuyo primer/último anillo son EXACTAMENTE los vértices del
 * borde de esa ventana. Esos vértices pertenecen a las dos superficies, así que no hay huecos, ni caras
 * interpenetradas, ni triángulos degenerados: la malla resultante es una sola superficie cerrada. El anillo pasa
 * gradualmente de la ventana rectangular (unión ancha que soporta carga) a la sección oval del asa.
 */
export interface LoopOffset {
  /** Columnas respecto del centro de la ventana (hacia +θ). */
  dc: number;
  /** Filas respecto del centro, en la dirección N del asa (hacia arriba en la unión superior). */
  dr: number;
}

/** Recorrido antihorario del borde de una ventana de (2hc × 2hr) celdas. Ambos extremos usan el MISMO orden local. */
export function windowLoop(hc: number, hr: number): LoopOffset[] {
  const out: LoopOffset[] = [];
  for (let dc = -hc; dc < hc; dc++) out.push({ dc, dr: -hr });
  for (let dr = -hr; dr < hr; dr++) out.push({ dc: hc, dr });
  for (let dc = hc; dc > -hc; dc--) out.push({ dc, dr: hr });
  for (let dr = hr; dr > -hr; dr--) out.push({ dc: -hc, dr });
  return out;
}

export interface LoftParams {
  /** Semiejes del óvalo del asa: A a lo ancho (Y), B en el plano del asa (N). */
  halfWidth: number;
  halfThickness: number;
  /** Longitud (mm) en la que cada extremo pasa de la ventana al óvalo. */
  blendLength: number;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const smooth = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

function localCoords(mesh: IndexedMesh, vi: number, f: PathFrame): V3 {
  const d: V3 = [mesh.positions[vi * 3] - f.c[0], mesh.positions[vi * 3 + 1] - f.c[1], mesh.positions[vi * 3 + 2] - f.c[2]];
  return [dot(d, f.y), dot(d, f.n), dot(d, f.t)];
}

/**
 * Loft entre dos anillos ya existentes en la malla (`startLoop`, `endLoop`: índices de vértice, mismo orden local).
 * Devuelve los anillos creados (para tests). Winding: ((k+1) − k) × T apunta hacia afuera del tubo.
 */
export function loftBetweenLoops(mesh: IndexedMesh, startLoop: number[], endLoop: number[], frames: PathFrame[], params: LoftParams): number[][] {
  const P = startLoop.length;
  const first = frames[0], last = frames[frames.length - 1];
  const startLocal = startLoop.map((v) => localCoords(mesh, v, first));
  const endLocal = endLoop.map((v) => localCoords(mesh, v, last));
  const maxA = Math.max(...startLocal.map((l) => Math.abs(l[0])), 1e-6);
  const maxB = Math.max(...startLocal.map((l) => Math.abs(l[1])), 1e-6);
  const oval = startLocal.map((l) => {
    const phi = Math.atan2(l[1] / maxB, l[0] / maxA);
    return [params.halfWidth * Math.cos(phi), params.halfThickness * Math.sin(phi)] as const;
  });

  const total = last.s;
  const rings: number[][] = [startLoop];
  for (let m = 1; m < frames.length - 1; m++) {
    const f = frames[m];
    const ws = smooth(f.s / params.blendLength), we = smooth((total - f.s) / params.blendLength);
    const ring: number[] = [];
    for (let k = 0; k < P; k++) {
      const a = oval[k][0] + (1 - ws) * (startLocal[k][0] - oval[k][0]) + (1 - we) * (endLocal[k][0] - oval[k][0]);
      const b = oval[k][1] + (1 - ws) * (startLocal[k][1] - oval[k][1]) + (1 - we) * (endLocal[k][1] - oval[k][1]);
      const c = (1 - ws) * startLocal[k][2] + (1 - we) * endLocal[k][2];
      ring.push(
        addVertex(
          mesh,
          f.c[0] + a * f.y[0] + b * f.n[0] + c * f.t[0],
          f.c[1] + a * f.y[1] + b * f.n[1] + c * f.t[1],
          f.c[2] + a * f.y[2] + b * f.n[2] + c * f.t[2],
        ),
      );
    }
    rings.push(ring);
  }
  rings.push(endLoop);

  for (let m = 0; m < rings.length - 1; m++) {
    for (let k = 0; k < P; k++) {
      const k1 = (k + 1) % P;
      const a = rings[m][k], b = rings[m][k1], c = rings[m + 1][k1], d = rings[m + 1][k];
      addTri(mesh, a, b, c);
      addTri(mesh, a, c, d);
    }
  }
  return rings;
}
