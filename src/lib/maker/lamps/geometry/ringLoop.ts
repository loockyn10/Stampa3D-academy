import { newMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";
import { revolveProfile } from "@/lib/maker/mugs/geometry/revolveProfile";
import { femaleVoidRadius, maleRadius, type LampThreadSpec } from "@/lib/maker/lamps/threads/lampThread";

/**
 * Anillo del lazo de revolución: una altura `z` y el radio de cada columna (número fijo o función de la columna).
 * Los anillos se recorren en orden del perfil CERRADO: piel exterior hacia arriba, borde superior, piel interior hacia
 * abajo, borde inferior. Con ese orden las normales salen del material (mismo contrato que `revolveProfile`).
 */
export interface Ring {
  z: number;
  r: number | ((column: number) => number);
}

/** Malla cerrada de una pieza de revolución con relieve helicoidal: un único lazo de anillos, sin polos ni CSG. */
export function ringLoopMesh(rings: Ring[], segments: number): IndexedMesh {
  const mesh = newMesh();
  const profile = rings.map((ring) => ({ r: 1, z: ring.z }));
  revolveProfile(mesh, profile, {
    segments,
    closed: true,
    radiusAt: (_p, theta, i) => {
      const ring = rings[i];
      if (typeof ring.r === "number") return ring.r;
      const column = Math.round((theta * segments) / (2 * Math.PI)) % segments;
      return ring.r(column);
    },
  });
  return mesh;
}

/** Anillos de la rosca macho, de su extremo inferior `zBottom` a `zBottom + length` (filas uniformes, `rowsPerPitch` por paso). */
export function maleThreadRings(spec: LampThreadSpec, zBottom: number, segments: number, rowsPerPitch: number): Ring[] {
  const rows = Math.max(2, Math.ceil((spec.length / spec.pitch) * rowsPerPitch));
  const rings: Ring[] = [];
  for (let k = 0; k <= rows; k++) {
    const z = zBottom + (spec.length * k) / rows;
    const radii = new Float64Array(segments);
    for (let j = 0; j < segments; j++) radii[j] = maleRadius(spec, (2 * Math.PI * j) / segments, z, zBottom);
    rings.push({ z, r: (j) => radii[j] });
  }
  return rings;
}

/** Polígono (puntos x,y) del vacío roscado de la hembra a la altura `z`, muestreado en `segments` columnas. */
export function femaleVoidPolygon(spec: LampThreadSpec, z: number, zLedge: number, segments: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let j = 0; j < segments; j++) {
    const theta = (2 * Math.PI * j) / segments;
    const r = femaleVoidRadius(spec, theta, z, zLedge);
    pts.push([r * Math.cos(theta), r * Math.sin(theta)]);
  }
  return pts;
}

/**
 * Últimos anillos de la piel interior de una pieza roscada (de arriba hacia abajo), desde el orificio del cuello hasta su
 * borde inferior en `zBottom`. Con reborde de adhesión: sube `heightMm` por el orificio, entra `widthMm` hacia el eje y baja
 * al plano de apoyo (un anillo plano interno; el exterior no cambia). Sin reborde: el orificio llega recto al borde.
 */
export function flangeInnerRings(layout: { adhesion: { enabled: boolean; heightMm: number; outerR: number; innerR: number } }, zBottom: number): Ring[] {
  const a = layout.adhesion;
  if (!a.enabled) return [{ z: zBottom, r: a.outerR }];
  return [
    { z: zBottom + a.heightMm, r: a.outerR },
    { z: zBottom + a.heightMm, r: a.innerR },
    { z: zBottom, r: a.innerR },
  ];
}
