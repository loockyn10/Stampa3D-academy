import { normalizeMugDefinition } from "@/lib/maker/mugs/defaults";
import type { MugDefinition } from "@/lib/maker/mugs/types";

/**
 * Presets DE SISTEMA: recetas de configuración, NO código geométrico. Un preset solo produce una MugDefinition que
 * pasa por el mismo motor que cualquier otra. No pisan el modo ni las dimensiones principales (alto/diámetros/
 * paredes): son proporciones y estilo. Los presets de usuario quedan preparados (misma forma `recipe`) pero no se
 * persisten en 0.1.
 */
export type MugRecipe = Partial<Pick<MugDefinition, "bodyStyle" | "bodyBulgePct" | "rim" | "base" | "surface" | "grooves" | "bands">> & {
  handle?: Partial<MugDefinition["handle"]>;
};

export interface MugSystemPreset {
  id: string;
  label: string;
  description: string;
  recipe: MugRecipe;
}

const PLAIN: MugRecipe = {
  surface: { style: "smooth", sides: 8 },
  grooves: { enabled: false, count: 12, depthMm: 1.5 },
  bands: { enabled: false, count: 3, heightMm: 6, reliefMm: 1.5 },
  rim: "simple",
  base: "normal",
};

export const MUG_SYSTEM_PRESETS: readonly MugSystemPreset[] = [
  { id: "classic", label: "Clásico", description: "Recto, asa clásica, liso.", recipe: { ...PLAIN, bodyStyle: "straight", handle: { style: "classic" } } },
  {
    id: "barrel",
    label: "Barril",
    description: "Cuerpo de barril, 3 bandas y ranuras verticales.",
    recipe: {
      ...PLAIN,
      bodyStyle: "barrel",
      bodyBulgePct: 55,
      bands: { enabled: true, count: 3, heightMm: 6, reliefMm: 1.5 },
      grooves: { enabled: true, count: 16, depthMm: 1.2 },
      handle: { style: "classic" },
    },
  },
  {
    id: "tavern",
    label: "Taberna",
    description: "Abombado, bandas, asa angular y borde grueso.",
    recipe: { ...PLAIN, bodyStyle: "bulged", bodyBulgePct: 60, rim: "thick", bands: { enabled: true, count: 2, heightMm: 7, reliefMm: 1.8 }, handle: { style: "angular" } },
  },
  {
    id: "geometric",
    label: "Geométrico",
    description: "Facetado, asa cuadrada.",
    recipe: { ...PLAIN, bodyStyle: "straight", surface: { style: "faceted", sides: 8 }, handle: { style: "square" } },
  },
  {
    id: "industrial",
    label: "Industrial",
    description: "Ligeramente cónico, ranuras, asa angular.",
    recipe: { ...PLAIN, bodyStyle: "conical", grooves: { enabled: true, count: 24, depthMm: 1 }, base: "reinforced", handle: { style: "angular" } },
  },
];

/** Aplica una receta sobre una definición: el resultado es una MugDefinition normal (mismo motor, sin ramas por preset). */
export function applyMugRecipe(def: MugDefinition, recipe: MugRecipe): MugDefinition {
  return normalizeMugDefinition({ ...def, ...recipe, handle: { ...def.handle, ...recipe.handle } });
}
