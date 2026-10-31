import { createShadeRowEvaluator } from "@/lib/maker/lamps/shade/surface";
import type { LampShadeDef } from "@/lib/maker/lamps/types";

export interface LampSilhouette {
  /** Contorno de las crestas (relleno), en un viewBox de `width` × `height`. */
  crest: string;
  /** Contorno de los valles (más angosto). */
  valley: string;
  width: number;
  height: number;
}

/**
 * Silueta 2D barata (sin malla) de una pantalla, para las miniaturas de los diseños iniciales: el mismo evaluador de
 * filas que usa la geometría real, así que la miniatura nunca se desvía del modelo. Escala fija (mm -> px) para que
 * dos diseños de la misma altura se comparen a ojo.
 */
export function lampSilhouette(shade: LampShadeDef, heightPx = 84): LampSilhouette {
  const evalRow = createShadeRowEvaluator(shade);
  const steps = 48;
  const scale = heightPx / shade.heightMm;
  const crestR: number[] = [];
  const valleyR: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const row = evalRow((shade.heightMm * i) / steps);
    crestR.push((row.radius + row.amp) * scale);
    valleyR.push((row.radius - row.amp) * scale);
  }
  const maxR = Math.max(...crestR);
  const width = Math.ceil(maxR * 2 + 4);
  const cx = width / 2;
  const path = (radii: number[]) => {
    const y = (i: number) => heightPx - (i / steps) * heightPx;
    const right = radii.map((r, i) => `${(cx + r).toFixed(1)},${y(i).toFixed(1)}`);
    const left = radii.map((r, i) => `${(cx - r).toFixed(1)},${y(i).toFixed(1)}`).reverse();
    return `M${right.join("L")}L${left.join("L")}Z`;
  };
  return { crest: path(crestR), valley: path(valleyR), width, height: heightPx };
}
