import type { LetterSignParams } from "@/lib/maker/types";

/**
 * Resistencia del cartel (Creador de Carteles): dos espesores de pared
 * estándar. Es una forma simple de elegir `wallMm`, NO un segundo parámetro:
 * la única fuente de verdad sigue siendo `LetterSignParams.wallMm` (el campo
 * "Pared" de Personalización avanzada). La opción elegida se DEDUCE del
 * espesor (`detectWallStrength`), igual que el estilo "Personalizado" se
 * deduce de los parámetros: no existe un estado que pueda contradecirse con
 * el slider, ni hay nada nuevo que persistir en presets o proyectos (los
 * guardados antes siguen funcionando: 1,6 mm es simplemente "personalizado").
 *
 * Es espesor FÍSICO de la pared, no cantidad de perímetros: cuántos perímetros
 * imprime el laminador depende de su ancho de línea (ver `PERIMETER_HINT`).
 */
export type WallStrength = "normal" | "reinforced";

export const NORMAL_WALL_MM = 1.2;
export const REINFORCED_WALL_MM = 2.4;

export interface WallStrengthOption {
  id: WallStrength;
  label: string;
  wallMm: number;
  /** Qué prioriza. */
  summary: string;
  /** Para qué cartel está pensada. */
  usage: string;
}

export const WALL_STRENGTH_OPTIONS: readonly WallStrengthOption[] = [
  {
    id: "normal",
    label: "Normal",
    wallMm: NORMAL_WALL_MM,
    summary: "Menos material, impresión más rápida.",
    usage: "Carteles decorativos convencionales.",
  },
  {
    id: "reinforced",
    label: "Reforzado",
    wallMm: REINFORCED_WALL_MM,
    summary: "Paredes más robustas.",
    usage: "Carteles grandes o que van a recibir más exigencia.",
  },
];

/** Orientación (no una garantía): perímetros que suele sacar un laminador con línea de ~0,4–0,45 mm. */
export const PERIMETER_HINT = "Con líneas de 0,4–0,45 mm, 1,2 mm equivale a unos 3 perímetros y 2,4 mm a unos 5–6; la cantidad exacta la decide tu laminador.";

const TOLERANCE_MM = 1e-6;

/** Opción de resistencia que corresponde al espesor de pared, o null si es un valor propio (p.ej. 1,6 mm de proyectos anteriores). */
export function detectWallStrength(wallMm: number): WallStrength | null {
  return WALL_STRENGTH_OPTIONS.find((o) => Math.abs(o.wallMm - wallMm) < TOLERANCE_MM)?.id ?? null;
}

export function wallMmForStrength(strength: WallStrength): number {
  return strength === "reinforced" ? REINFORCED_WALL_MM : NORMAL_WALL_MM;
}

/** Aplica la resistencia sobre los params actuales: sólo cambia `wallMm` (texto, fuente, estilo y demás ajustes se conservan). */
export function applyWallStrength(params: LetterSignParams, strength: WallStrength): LetterSignParams {
  return { ...params, wallMm: wallMmForStrength(strength) };
}
