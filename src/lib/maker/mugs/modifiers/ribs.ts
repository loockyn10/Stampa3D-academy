import type { MugDefinition } from "@/lib/maker/mugs/types";

function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Facetado: polígono regular de `sides` lados con la APOTEMA en el radio base (las caras planas quedan en `r`, las
 * esquinas sobresalen), así la pared nunca se afina por debajo del espesor pedido. Una cara plana mira a +X (asa).
 * Devuelve el radio EXTRA (>= 0) en el ángulo theta.
 */
export function facetExtra(r: number, theta: number, sides: number): number {
  const sector = (2 * Math.PI) / sides;
  const local = ((((theta + sector / 2) % sector) + sector) % sector) - sector / 2;
  return r * (1 / Math.cos(local) - 1);
}

/** Ranuras verticales: sinusoide suave; el VALLE queda en el radio base (0) y la cresta sobresale `depth` (nunca afina la pared). */
export function grooveExtra(theta: number, count: number, depthMm: number): number {
  return depthMm * 0.5 * (1 - Math.cos(count * theta));
}

/** Atenuación de las ranuras cerca de base y boca (0 en los extremos, 1 hacia adentro) para que no rompan el borde. */
export function grooveFade(z: number, heightMm: number): number {
  const zone = Math.min(6, heightMm / 6);
  return smoothstep(z / zone) * smoothstep((heightMm - z) / zone);
}

export function surfaceSides(def: MugDefinition): number | null {
  return def.surface.style === "faceted" ? def.surface.sides : null;
}
export function grooveCount(def: MugDefinition): number | null {
  return def.grooves.enabled && def.grooves.depthMm > 0 ? def.grooves.count : null;
}
