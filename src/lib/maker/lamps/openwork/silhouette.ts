import { smoothNoise } from "@/lib/maker/lamps/random";
import type { LampOpenworkDef, LampShadeDef } from "@/lib/maker/lamps/types";

/**
 * MOTOR DE SILUETAS compartido por todos los patrones calados: una sola función radio(u) continua (u = altura relativa 0..1)
 * con el diámetro inferior y superior, un abombado (diámetro máximo), una cintura y cambios orgánicos. El patrón (diamante,
 * espiral, los que vengan) NO conoce la silueta: la recibe como una tabla de radios por fila. Cilíndrica, abombada, reloj de
 * arena y orgánica son combinaciones de los mismos parámetros, no modelos distintos.
 *
 *   R(u) = [ lineal(u) + dBulge · b(u) ] · [ 1 − w · b(u) ] · [ 1 + o · ruido(u) ]
 *
 * con b(u) un "bulto" suave de pico 1 en la posición elegida y 0 en los extremos (pendiente nula en el pico y en las puntas).
 */
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface SilhouetteInput {
  bottomDiameterMm: number;
  topDiameterMm: number;
  maxDiameterMm: number;
  bulgePositionPct: number;
  curvaturePct: number;
  waistPct: number;
  organicPct: number;
  seed: number;
}

export function silhouetteInput(shade: LampShadeDef, ow: LampOpenworkDef): SilhouetteInput {
  return {
    bottomDiameterMm: shade.bottomDiameterMm,
    topDiameterMm: shade.topDiameterMm,
    maxDiameterMm: ow.maxDiameterMm,
    bulgePositionPct: ow.bulgePositionPct,
    curvaturePct: ow.curvaturePct,
    waistPct: ow.waistPct,
    organicPct: ow.organicPct,
    seed: ow.seed,
  };
}

/** Radio (mm) en función de la altura relativa u ∈ [0, 1]. */
export function createSilhouette(input: SilhouetteInput): (u: number) => number {
  const R0 = input.bottomDiameterMm / 2;
  const R1 = input.topDiameterMm / 2;
  const up = clamp(input.bulgePositionPct / 100, 0.05, 0.95);
  const curv = clamp(input.curvaturePct / 100, 0, 1);
  // exponente del bulto: > 1 => pendiente nula en las puntas (sin quiebres contra el anillo inferior/superior)
  const p = 1.2 + 3.3 * curv;
  const w = 0.65 * clamp(input.waistPct / 100, 0, 1);
  const organic = clamp(input.organicPct / 100, 0, 1);
  const noise = smoothNoise(input.seed, 5);
  const linAt = (u: number) => R0 + (R1 - R0) * u;
  const dBulge = Math.max(0, input.maxDiameterMm / 2 - linAt(up));
  const bump = (u: number) => {
    const s = u <= up ? u / up : (1 - u) / (1 - up);
    return Math.pow(Math.sin((Math.PI / 2) * clamp(s, 0, 1)), p);
  };
  return (u: number) => {
    const x = clamp(u, 0, 1);
    const b = bump(x);
    let r = (linAt(x) + dBulge * b) * (1 - w * b);
    if (organic > 0) r *= 1 + 0.2 * organic * noise.at(x) * smoothstep(0, 0.12, x) * smoothstep(0, 0.12, 1 - x);
    return r;
  };
}

/** Siluetas de partida: no son modelos, solo recetas de los mismos parámetros (se aplican sobre la definición actual). */
export type SilhouetteKind = "cylinder" | "bulge" | "hourglass" | "organic";

export const SILHOUETTE_LABELS: Record<SilhouetteKind, string> = {
  cylinder: "Cilíndrica",
  bulge: "Abombada",
  hourglass: "Reloj de arena",
  organic: "Orgánica",
};

/**
 * Recetas relativas al diámetro inferior/superior actuales (no pisan altura ni extremos salvo que la forma lo pida).
 * `mountMm`: con el difusor como dato los extremos son el montaje (no se tocan): la silueta solo puede EXPANDIRSE hacia afuera de ese diámetro exterior.
 */
export function silhouetteRecipe(kind: SilhouetteKind, shade: LampShadeDef, mountMm?: number): { shade: Partial<LampShadeDef>; openwork: Partial<LampOpenworkDef> } {
  if (mountMm !== undefined) {
    const m = mountMm;
    switch (kind) {
      case "cylinder":
        return { shade: {}, openwork: { maxDiameterMm: Math.round(m), waistPct: 0, organicPct: 0 } };
      case "bulge":
        return { shade: {}, openwork: { maxDiameterMm: Math.round(m * 1.6), bulgePositionPct: 50, curvaturePct: 35, waistPct: 0, organicPct: 0 } };
      case "hourglass":
        // la cintura quedaría más angosta que los extremos (= el difusor): la validación lo rechaza; se deja la receta para que se explique por qué
        return { shade: {}, openwork: { maxDiameterMm: Math.round(m), bulgePositionPct: 50, curvaturePct: 30, waistPct: 55, organicPct: 0 } };
      case "organic":
        return { shade: {}, openwork: { maxDiameterMm: Math.round(m * 1.5), bulgePositionPct: 42, curvaturePct: 20, waistPct: 15, organicPct: 70 } };
    }
  }
  const base = Math.round((shade.bottomDiameterMm + shade.topDiameterMm) / 2);
  switch (kind) {
    case "cylinder":
      return { shade: { topDiameterMm: shade.bottomDiameterMm }, openwork: { maxDiameterMm: shade.bottomDiameterMm, waistPct: 0, organicPct: 0 } };
    case "bulge":
      return { shade: { topDiameterMm: shade.bottomDiameterMm }, openwork: { maxDiameterMm: Math.round(shade.bottomDiameterMm * 1.35), bulgePositionPct: 50, curvaturePct: 35, waistPct: 0, organicPct: 0 } };
    case "hourglass":
      return { shade: { topDiameterMm: shade.bottomDiameterMm }, openwork: { maxDiameterMm: shade.bottomDiameterMm, bulgePositionPct: 50, curvaturePct: 30, waistPct: 55, organicPct: 0 } };
    case "organic":
      return { shade: { topDiameterMm: Math.round(base * 1.05) }, openwork: { maxDiameterMm: Math.round(base * 1.2), bulgePositionPct: 42, curvaturePct: 20, waistPct: 15, organicPct: 70 } };
  }
}
