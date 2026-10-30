import type { ContourGroup } from "@/lib/maker/types";
import { insetContourGroups, regroupClipperSolution } from "@/lib/maker/geometry/offsets";

/**
 * Protección de modificadores que angostan o ahuecan la letra (bisel superior,
 * cintura lateral, espesor de pared): ¿hasta qué desplazamiento hacia adentro
 * sigue siendo "la misma forma" la silueta de un contorno?
 *
 * Erosionar un contorno `d` mm lo adelgaza de forma uniforme; mientras no
 * ocurra ningún evento topológico (un trazo se parte en dos, una parte
 * desaparece, un counter se fusiona con el exterior) todos sus trazos siguen
 * existiendo. El PRIMER evento ocurre a `d* = (ancho del trazo más fino) / 2`.
 * Medir `d*` evita que un bisel o una pared pensados para una letra grande
 * partan en pedazos (o dejen macizos) los trazos finos de una letra chica, sin
 * necesitar un esqueleto/eje medial: alcanza con Clipper, que el motor ya usa.
 */

// Referencia contra la que se compara: apenas por encima de 0 para no depender
// de microdetalles del contorno original ya limpiados por Clipper.
const REFERENCE_INSET_MM = 0.05;
// Resolución de la bisección: 0.05 mm sobra para una advertencia/ajuste de bisel.
const RESOLUTION_MM = 0.05;

/** "Forma topológica" de un contorno erosionado `insetMm`: cantidad de exteriores y de huecos. */
function topologyAt(group: ContourGroup, insetMm: number): string {
  const groups = regroupClipperSolution(insetContourGroups([group], insetMm));
  return `${groups.length}:${groups.reduce((sum, g) => sum + g.holes.length, 0)}`;
}

/**
 * Desplazamiento (mm) al que ocurre el primer evento topológico de `group`
 * (la mitad del ancho de su trazo más fino), o `Infinity` si no ocurre ninguno
 * hasta `maxMm`. Precisión ~0.05 mm. Una sola erosión cuando no hay problema.
 */
export function firstTopologyEventMm(group: ContourGroup, maxMm: number): number {
  if (!(maxMm > 0)) return Infinity;
  const reference = topologyAt(group, Math.min(REFERENCE_INSET_MM, maxMm / 2));
  if (topologyAt(group, maxMm) === reference && topologyAt(group, maxMm / 2) === reference) return Infinity;

  let lo = Math.min(REFERENCE_INSET_MM, maxMm / 2);
  let hi = maxMm;
  while (hi - lo > RESOLUTION_MM) {
    const mid = (lo + hi) / 2;
    if (topologyAt(group, mid) === reference) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Mínimo de `firstTopologyEventMm` sobre un conjunto de contornos (`Infinity` si ninguno tiene eventos hasta `maxMm`). */
export function minStrokeHalfWidthMm(groups: ContourGroup[], maxMm: number): number {
  let min = Infinity;
  for (const group of groups) min = Math.min(min, firstTopologyEventMm(group, Math.min(maxMm, min)));
  return min;
}
