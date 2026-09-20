import { cubicBezier, resamplePolyline, roundedPolyline, type P2 } from "@/lib/maker/mugs/geometry/sweep";
import type { MugHandleStyle } from "@/lib/maker/mugs/types";

/**
 * Eje central del asa como recorrido plano (x radial, z vertical), de la unión SUPERIOR (xTop, zTop) a la INFERIOR
 * (xBot, zBot). Los tramos de los extremos son horizontales: el asa sale perpendicular a la pared.
 * `projectionMm` = distancia máxima del eje al eje de las uniones.
 */
export function handleCenterline(style: MugHandleStyle, xTop: number, zTop: number, xBot: number, zBot: number, projectionMm: number, stepMm: number): P2[] {
  const h = zTop - zBot;
  const p = projectionMm;
  let raw: P2[];
  if (style === "classic") {
    // C con curvas suaves: Bézier cúbica con tangentes horizontales en ambos extremos (x máximo = 0.75 · 4/3 · p).
    raw = cubicBezier([xTop, zTop], [xTop + p * (4 / 3), zTop], [xBot + p * (4 / 3), zBot], [xBot, zBot]);
  } else if (style === "square") {
    const o = Math.max(xTop, xBot) + p;
    raw = roundedPolyline([[xTop, zTop], [o, zTop], [o, zBot], [xBot, zBot]], Math.min(p, h / 2) * 0.45);
  } else {
    // Angular: sube en diagonal, tramo casi recto y vuelve en diagonal; esquinas suaves de 4 mm.
    const o = Math.max(xTop, xBot) + p;
    raw = roundedPolyline(
      [[xTop, zTop], [xTop + p * 0.5, zTop], [o, zTop - h * 0.32], [o - p * 0.08, zBot + h * 0.3], [xBot + p * 0.45, zBot], [xBot, zBot]],
      4,
    );
  }
  return resamplePolyline(raw, stepMm);
}
