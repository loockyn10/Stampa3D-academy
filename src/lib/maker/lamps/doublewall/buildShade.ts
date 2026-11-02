import { maleThreadRings } from "@/lib/maker/lamps/geometry/ringLoop";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import type { DoubleWallField } from "@/lib/maker/lamps/doublewall/field";
import { createDoubleWallSurfaces, doubleWallZones } from "@/lib/maker/lamps/doublewall/profiles";
import { LAMP_GEOMETRY, type LampDefinition } from "@/lib/maker/lamps/types";
import { addTri, addVertex, newMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * PANTALLA de DOBLE PARED (impresión convencional) con la interfaz E27 real: el mismo cuello roscado macho, la transición de 45° hacia
 * afuera y el mismo reborde de adhesión que las otras pantallas; sobre la transición, las dos paredes unidas por el piso y por el techo.
 *
 * Es un LOFT de lazos concéntricos (sin CSG, manifold por construcción):
 *   co  cara exterior de la pared exterior   (rosca → cuello → transición → paredes, estrías, techo)
 *   ci  cara de la pared interior que mira al vacío central (reborde → orificio del cuello → cono de 45° → pared interior)
 *   ho  cara de la pared exterior que mira a la cámara     (solo entre el piso y el cielorraso / el tope)
 *   hi  cara de la pared interior que mira a la cámara
 * Bajo el piso y en el cuello la sección es el anillo entre co y ci; entre el piso y el techo son dos anillos (las dos paredes) y la
 * cámara. La abertura central nunca se tapa: ci es un lazo que atraviesa todo el alto. Con la cámara cerrada, el cielorraso la
 * convierte en una cavidad interna (otra superficie de la misma malla, volumen negativo); con la cámara abierta termina en una ranura.
 */
export function createDoubleWallShadeMesh(def: LampDefinition, field: DoubleWallField, layout: LampLayout): IndexedMesh {
  const g = LAMP_GEOMETRY;
  const p = field.params;
  const surf = createDoubleWallSurfaces(p);
  const zones = doubleWallZones(p);
  const spec = layout.spec;
  const mesh = newMesh();
  const TAU = Math.PI * 2;
  const mo = field.columns;
  const mi = p.innerSegments;
  const closed = def.doubleWall.chamber === "closed";
  const z0 = layout.decorZ0;
  const H = p.heightMm;
  const zBottom = layout.ledgeZ;

  // ---- Alturas locales (0 = borde inferior de la parte decorativa): uniformes + cambios de sección
  const uniform = Math.max(2, Math.ceil(H / p.rowMm));
  const zs: number[] = [];
  for (let i = 0; i <= uniform; i++) zs.push((H * i) / uniform);
  for (const z of [zones.floorTop, zones.roofStart, zones.ceiling]) zs.push(z);
  zs.sort((a, b) => a - b);
  const wallZ = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 1e-6);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const iFloor = wallZ.findIndex((z) => near(z, zones.floorTop));
  const iCeil = wallZ.findIndex((z) => near(z, zones.ceiling));
  const iEnd = closed ? iCeil : wallZ.length - 1;

  const ring = (rOf: (j: number) => number, m: number, z: number): number[] => {
    const ids: number[] = [];
    for (let j = 0; j < m; j++) {
      const th = (TAU * j) / m;
      ids.push(addVertex(mesh, rOf(j) * Math.cos(th), rOf(j) * Math.sin(th), z));
    }
    return ids;
  };
  const rev = (ids: number[]) => [...ids].reverse();

  // ---- Lazo exterior co: rosca, cuello, y las paredes (la transición de 45° es el tramo cuello → primera fila de las paredes)
  const co: number[][] = [];
  for (const r of maleThreadRings(spec, zBottom, mo, g.threadRowsPerPitch)) co.push(ring((j) => (typeof r.r === "number" ? r.r : r.r(j)), mo, r.z));
  co.push(ring(() => spec.rootR, mo, layout.neckTopZ));
  const rowAt = wallZ.map((z) => surf(z));
  rowAt.forEach((s, i) => co.push(ring((j) => s.ro((TAU * j) / mo), mo, z0 + wallZ[i])));

  // ---- Lazo interior ci: de abajo hacia arriba (reborde de adhesión, orificio del cuello, cono de 45°, pared interior)
  const ci: number[][] = [];
  const a = layout.adhesion;
  if (a.enabled) {
    ci.push(ring(() => a.innerR, mi, zBottom));
    ci.push(ring(() => a.innerR, mi, zBottom + a.heightMm));
    ci.push(ring(() => a.outerR, mi, zBottom + a.heightMm));
  } else ci.push(ring(() => spec.boreR, mi, zBottom));
  const rii0 = rowAt[0].rii;
  const coneH = Math.abs(spec.boreR - rii0) * Math.tan((g.flareDeg * Math.PI) / 180);
  if (coneH > 1e-6) ci.push(ring(() => spec.boreR, mi, z0 - coneH));
  rowAt.forEach((s, i) => ci.push(ring(() => s.rii, mi, z0 + wallZ[i])));

  // ---- Lazos de la cámara (entre el piso y el cielorraso, o el tope si queda abierta)
  const ho: number[][] = [];
  const hi: number[][] = [];
  for (let i = iFloor; i <= iEnd; i++) {
    const s = rowAt[i];
    ho.push(ring((j) => s.roi((TAU * j) / mo), mo, z0 + wallZ[i]));
    hi.push(ring(() => s.rio, mi, z0 + wallZ[i]));
  }

  // ---- Caras laterales (sólido a la izquierda del recorrido ⇒ la normal sale por la derecha)
  const lateral = (rows: number[][]) => {
    for (let i = 0; i + 1 < rows.length; i++) {
      const lo = rows[i], up = rows[i + 1];
      for (let k = 0; k < lo.length; k++) {
        const b = (k + 1) % lo.length;
        addTri(mesh, lo[k], lo[b], up[b]);
        addTri(mesh, lo[k], up[b], up[k]);
      }
    }
  };
  lateral(co);
  lateral(ci.map(rev));
  lateral(ho.map(rev));
  lateral(hi);

  // ---- Superficies horizontales (el sentido se fija por la normal z deseada)
  const p3 = mesh.positions;
  const horizontal = (up: boolean, build: (tri: (a: number, b: number, c: number) => void) => void) =>
    build((a, b, c) => {
      const cross = (p3[b * 3] - p3[a * 3]) * (p3[c * 3 + 1] - p3[a * 3 + 1]) - (p3[b * 3 + 1] - p3[a * 3 + 1]) * (p3[c * 3] - p3[a * 3]);
      if (Math.abs(cross) < 1e-14) return;
      if (up === cross > 0) addTri(mesh, a, b, c);
      else addTri(mesh, a, c, b);
    });
  const zipper = (x: number[], y: number[]) => (tri: (a: number, b: number, c: number) => void) => {
    let i = 0, j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && (j >= y.length || (i + 1) / x.length <= (j + 1) / y.length)) {
        tri(x[i % x.length], x[(i + 1) % x.length], y[j % y.length]);
        i++;
      } else {
        tri(x[i % x.length], y[(j + 1) % y.length], y[j % y.length]);
        j++;
      }
    }
  };
  const strip = (x: number[], y: number[]) => (tri: (a: number, b: number, c: number) => void) => {
    for (let k = 0; k < x.length; k++) {
      const b = (k + 1) % x.length;
      tri(x[k], x[b], y[b]);
      tri(x[k], y[b], y[k]);
    }
  };
  horizontal(false, zipper(co[0], ci[0])); // tapa inferior: el anillo que apoya en la cama (con el reborde de adhesión)
  horizontal(true, zipper(ho[0], hi[0])); // piso de la cámara
  if (closed) {
    horizontal(false, zipper(ho[ho.length - 1], hi[hi.length - 1])); // cielorraso (hacia abajo)
    horizontal(true, zipper(co[co.length - 1], ci[ci.length - 1])); // cara superior: rim macizo
  } else {
    horizontal(true, strip(co[co.length - 1], ho[ho.length - 1])); // cámara abierta: tapa superior de cada pared
    horizontal(true, strip(ci[ci.length - 1], hi[hi.length - 1]));
  }
  return mesh;
}
