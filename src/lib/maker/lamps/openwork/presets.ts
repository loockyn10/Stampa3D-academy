import { conformToFamily, rememberFamily, restoreFamily, type FamilyMemory } from "@/lib/maker/lamps/capabilities";
import { fitDoubleWallEnds } from "@/lib/maker/lamps/doublewall/params";
import { resolveLampDef } from "@/lib/maker/lamps/resolve";
import { silhouetteRecipe, type SilhouetteKind } from "@/lib/maker/lamps/openwork/silhouette";
import type { LampDefinition, LampOpenworkDef, LampShadeType } from "@/lib/maker/lamps/types";

/**
 * Diseños calados iniciales. Cada uno es una combinación REAL de parámetros del mismo motor (nunca un modelo aparte) que se
 * aplica sobre la definición actual: no pisa la altura, el diámetro inferior, el inserto, la base ni la rosca. Después se puede
 * seguir ajustando cualquier parámetro. Las miniaturas se dibujan con el mismo campo de aberturas que la malla exportada.
 * Es el mismo patrón que los diseños de la pantalla sólida (`LAMP_PRESETS`), con su propia receta.
 */
export interface OpenworkPreset {
  id: string;
  label: string;
  description: string;
  /** Diámetro superior y máximo como múltiplo del diámetro inferior actual. */
  topRatio: number;
  maxRatio: number;
  /** Con el difusor como dato: Ø máximo decorativo como múltiplo del Ø exterior del montaje (los extremos salen del difusor y no se tocan). */
  mountMaxRatio: number;
  recipe: Partial<LampOpenworkDef>;
}

export const OPENWORK_PRESETS: readonly OpenworkPreset[] = [
  {
    id: "diamante-clasico",
    label: "Diamante clásico",
    description: "Rombos regulares en una pantalla casi recta.",
    topRatio: 1.1,
    maxRatio: 1.1,
    mountMaxRatio: 1.35,
    recipe: { pattern: "diamond", divisions: 12, inclinationDeg: 55, stripWidthMm: 4, depthMm: 2.4, twistDeg: 0, waistPct: 0, organicPct: 0, phaseDeg: 0, variationPct: 0, bottomRingMm: 10, topRingMm: 8, topFinish: "ring" },
  },
  {
    id: "diamante-fino",
    label: "Diamante fino",
    description: "Muchos rombos pequeños con tiras delgadas.",
    topRatio: 1.0,
    maxRatio: 1.0,
    mountMaxRatio: 1.25,
    recipe: { pattern: "diamond", divisions: 16, inclinationDeg: 62, stripWidthMm: 3, depthMm: 2, twistDeg: 0, waistPct: 0, organicPct: 0, phaseDeg: 0, variationPct: 0, bottomRingMm: 10, topRingMm: 7, topFinish: "ring" },
  },
  {
    id: "diamante-torsion",
    label: "Diamante con torsión",
    description: "Los rombos se inclinan al subir y la pantalla se abomba.",
    topRatio: 1.0,
    maxRatio: 1.22,
    mountMaxRatio: 1.6,
    recipe: { pattern: "diamond", divisions: 14, inclinationDeg: 62, stripWidthMm: 4, depthMm: 2.4, twistDeg: 100, waistPct: 0, bulgePositionPct: 50, curvaturePct: 35, organicPct: 0, phaseDeg: 0, variationPct: 0, bottomRingMm: 10, topRingMm: 8, topFinish: "ring" },
  },
  {
    id: "espiral-suave",
    label: "Espiral suave",
    description: "Pocas bandas anchas que giran despacio.",
    topRatio: 1.1,
    maxRatio: 1.1,
    mountMaxRatio: 1.4,
    recipe: { pattern: "spiral", bands: 6, turns: 0.4, stripWidthMm: 7, depthMm: 2.4, twistDeg: 0, waistPct: 0, organicPct: 0, phaseDeg: 0, variationPct: 0, connectors: 0, bottomRingMm: 10, topRingMm: 8, topFinish: "ring" },
  },
  {
    id: "espiral-intensa",
    label: "Espiral intensa",
    description: "Bandas finas más enroscadas, con dos anillos de unión (puede pedir soportes).",
    topRatio: 1.0,
    maxRatio: 1.22,
    mountMaxRatio: 1.6,
    recipe: { pattern: "spiral", bands: 10, turns: 0.55, stripWidthMm: 3.2, depthMm: 2.2, twistDeg: 0, waistPct: 0, bulgePositionPct: 50, curvaturePct: 40, organicPct: 0, phaseDeg: 0, variationPct: 25, variationCycles: 1, connectors: 2, connectorWidthMm: 3, bottomRingMm: 10, topRingMm: 8, topFinish: "ring" },
  },
  {
    id: "reloj-de-arena-calado",
    label: "Reloj de arena calado",
    description: "Cintura marcada con rombos alargados.",
    topRatio: 1.0,
    maxRatio: 1.0,
    mountMaxRatio: 1.0,
    recipe: { pattern: "diamond", divisions: 14, inclinationDeg: 58, stripWidthMm: 3.6, depthMm: 2.4, twistDeg: 0, waistPct: 50, bulgePositionPct: 50, curvaturePct: 30, organicPct: 0, phaseDeg: 0, variationPct: 0, bottomRingMm: 10, topRingMm: 8, topFinish: "ring" },
  },
];

export function applyOpenworkPreset(def: LampDefinition, preset: OpenworkPreset): LampDefinition {
  const withRecipe: LampDefinition = { ...def, shadeType: "openwork", openwork: { ...def.openwork, ...preset.recipe } };
  if (withRecipe.openwork.diffuserFit === "diameter") {
    // El difusor manda: los extremos son el montaje y no se tocan; la silueta decorativa se expresa respecto del Ø exterior del montaje.
    const mount = resolveLampDef(withRecipe).shade.bottomDiameterMm;
    return { ...withRecipe, openwork: { ...withRecipe.openwork, maxDiameterMm: Math.round(mount * preset.mountMaxRatio) } };
  }
  const bottom = def.shade.bottomDiameterMm;
  return {
    ...withRecipe,
    shade: { ...def.shade, topDiameterMm: Math.round(bottom * preset.topRatio) },
    openwork: { ...withRecipe.openwork, maxDiameterMm: Math.round(bottom * preset.maxRatio) },
  };
}

/** ¿Los parámetros actuales son los de este preset? (para marcarlo como activo en la galería). */
export function openworkPresetMatches(def: LampDefinition, preset: OpenworkPreset): boolean {
  if (def.shadeType !== "openwork") return false;
  const r = preset.recipe as Record<string, unknown>;
  const o = def.openwork as unknown as Record<string, unknown>;
  if (!Object.keys(r).every((k) => o[k] === r[k])) return false;
  if (def.openwork.diffuserFit === "diameter") {
    const mount = resolveLampDef(def).shade.bottomDiameterMm;
    return Math.abs(def.openwork.maxDiameterMm - mount * preset.mountMaxRatio) <= 1;
  }
  return def.shade.topDiameterMm === Math.round(def.shade.bottomDiameterMm * preset.topRatio) && def.openwork.maxDiameterMm === Math.round(def.shade.bottomDiameterMm * preset.maxRatio);
}

/**
 * Cambia de familia (sólida, calada, doble pared) CONSERVANDO lo que el usuario dejó en la que abandona. Los parámetros propios de cada familia conviven en la
 * definición y no se tocan; lo compartido que sí cambia con la familia (el difusor, la unión y los diámetros de los extremos) se recuerda en `memory` y vuelve al
 * regresar. Al llegar a una familia por primera vez se aplican sus compatibilidades (`conformToFamily`: difusor cilíndrico en calada y doble pared, doble pared
 * sin difusor, unión integrada) y, en la doble pared, los diámetros de los extremos se llevan, de a 5 mm, al mínimo que respeta la separación pedida (`fitDoubleWallEnds`).
 * Conserva la altura, el diámetro de montaje, la rosca, la base, el color y las medidas del portalámparas. Es una acción del usuario y se informa en el panel.
 */
export function switchFamily(def: LampDefinition, shadeType: LampShadeType, memory: FamilyMemory = {}): { def: LampDefinition; memory: FamilyMemory } {
  if (def.shadeType === shadeType) return { def, memory };
  const from = def.shadeType;
  const saved = rememberFamily(def, memory);
  const next = conformToFamily({ ...def, shadeType }, from);
  if (saved[shadeType] && memory[shadeType]) return { def: restoreFamily(next, memory), memory: saved };
  return { def: shadeType === "double" ? fitDoubleWallEnds(next) : next, memory: saved };
}

/** Alterna entre familias sin recordar nada (ver `switchFamily`). */
export function applyShadeType(def: LampDefinition, shadeType: LampShadeType): LampDefinition {
  return switchFamily(def, shadeType).def;
}

/** Aplica una silueta de partida (recetas de los mismos parámetros) sobre la pantalla calada. */
export function applySilhouette(def: LampDefinition, kind: SilhouetteKind): LampDefinition {
  const driven = def.shadeType === "openwork" && def.openwork.diffuserFit === "diameter";
  const r = silhouetteRecipe(kind, def.shade, driven ? resolveLampDef(def).shade.bottomDiameterMm : undefined);
  return { ...def, shade: { ...def.shade, ...r.shade }, openwork: { ...def.openwork, ...r.openwork } };
}
