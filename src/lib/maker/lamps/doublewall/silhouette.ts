import { createDoubleWallSurfaces } from "@/lib/maker/lamps/doublewall/profiles";
import { doubleWallParams } from "@/lib/maker/lamps/doublewall/params";
import type { LampDefinition } from "@/lib/maker/lamps/types";

export interface DoubleWallSilhouette {
  /** Contorno de la pared exterior (crestas) y de la pared interior, en un viewBox de `width` × `height`. */
  outer: string;
  inner: string;
  width: number;
  height: number;
}

/**
 * Silueta 2D barata (sin malla) de la doble pared para las miniaturas de la biblioteca: las MISMAS funciones de superficie que usa la geometría
 * (`createDoubleWallSurfaces`), así que la miniatura no se desvía del modelo. Escala fija (mm → px) para comparar dos estilos a ojo.
 */
export function doubleWallSilhouette(def: LampDefinition, heightPx = 84): DoubleWallSilhouette {
  const p = doubleWallParams(def);
  const surfaces = createDoubleWallSurfaces(p);
  const steps = 40;
  const scale = heightPx / p.heightMm;
  const outerR: number[] = [];
  const innerR: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = surfaces((p.heightMm * i) / steps);
    outerR.push(s.crest * scale);
    innerR.push(s.rio * scale);
  }
  const width = Math.ceil(Math.max(...outerR) * 2 + 4);
  const cx = width / 2;
  const path = (radii: number[]) => {
    const y = (i: number) => heightPx - (i / steps) * heightPx;
    const right = radii.map((r, i) => `${(cx + r).toFixed(1)},${y(i).toFixed(1)}`);
    const left = radii.map((r, i) => `${(cx - r).toFixed(1)},${y(i).toFixed(1)}`).reverse();
    return `M${right.join("L")}L${left.join("L")}Z`;
  };
  return { outer: path(outerR), inner: path(innerR), width, height: heightPx };
}
