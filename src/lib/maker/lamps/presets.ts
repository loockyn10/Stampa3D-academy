import type { LampDefinition, LampShadeDef } from "@/lib/maker/lamps/types";

/**
 * Diseños iniciales. Son solo PUNTOS DE PARTIDA: una receta de parámetros de la pantalla que se aplica sobre la
 * definición actual (no pisa altura, diámetro inferior, espesor ni nada del inserto/base/portalámparas). Después se
 * puede seguir ajustando todo, o generar variaciones.
 */
export interface LampPreset {
  id: string;
  label: string;
  description: string;
  /** Parámetros de forma; `topRatio` = diámetro superior / diámetro inferior. */
  recipe: Partial<Omit<LampShadeDef, "heightMm" | "bottomDiameterMm" | "topDiameterMm" | "wallMm" | "collarHeightMm">> & { topRatio: number };
}

export const LAMP_PRESETS: readonly LampPreset[] = [
  { id: "ondas-suaves", label: "Ondas suaves", description: "Ondulaciones parejas, perfil casi recto.", recipe: { family: "wavy", waves: 10, amplitudeMm: 5, twistDeg: 0, profile: "straight", profileAmountPct: 0, verticalFrequency: 0, patternIntensityPct: 0, organicPct: 0, topRatio: 1.1, seed: 1 } },
  { id: "ondas-marcadas", label: "Ondas marcadas", description: "Más ondas y respiración vertical del relieve.", recipe: { family: "wavy", waves: 16, amplitudeMm: 7, twistDeg: 0, profile: "barrel", profileAmountPct: 30, verticalFrequency: 3, patternIntensityPct: 45, organicPct: 0, topRatio: 1.0, seed: 2 } },
  { id: "espiral-suave", label: "Espiral suave", description: "Las ondas giran despacio a lo alto.", recipe: { family: "spiral", waves: 9, amplitudeMm: 6, twistDeg: 240, profile: "barrel", profileAmountPct: 30, verticalFrequency: 0, patternIntensityPct: 0, organicPct: 0, topRatio: 1.15, seed: 3 } },
  { id: "espiral-torsionada", label: "Espiral torsionada", description: "Giro fuerte, aspecto de cuerda.", recipe: { family: "spiral", waves: 12, amplitudeMm: 7, twistDeg: 600, profile: "straight", profileAmountPct: 0, verticalFrequency: 0, patternIntensityPct: 0, organicPct: 0, topRatio: 1.0, seed: 4 } },
  { id: "organica", label: "Orgánica", description: "Amplitud y diámetro cambian suavemente, como una forma natural.", recipe: { family: "organic", waves: 7, amplitudeMm: 5.5, twistDeg: 60, profile: "straight", profileAmountPct: 0, verticalFrequency: 1.5, patternIntensityPct: 20, organicPct: 55, topRatio: 1.1, seed: 7 } },
  { id: "organica-fluida", label: "Orgánica fluida", description: "Pocas ondas grandes que se deslizan.", recipe: { family: "organic", waves: 5, amplitudeMm: 8, twistDeg: -120, profile: "barrel", profileAmountPct: 40, verticalFrequency: 0, patternIntensityPct: 0, organicPct: 85, topRatio: 0.9, seed: 21 } },
  { id: "tulipan", label: "Tulipán", description: "Se abre hacia arriba con pétalos anchos.", recipe: { family: "wavy", waves: 6, amplitudeMm: 8, twistDeg: 0, profile: "tulip", profileAmountPct: 80, verticalFrequency: 0, patternIntensityPct: 0, organicPct: 0, topRatio: 1.35, seed: 5 } },
  { id: "reloj-de-arena", label: "Reloj de arena", description: "Cintura marcada con ondas en espiral.", recipe: { family: "spiral", waves: 14, amplitudeMm: 5, twistDeg: 360, profile: "waist", profileAmountPct: 55, verticalFrequency: 0, patternIntensityPct: 0, organicPct: 0, topRatio: 1.0, seed: 6 } },
  { id: "campana", label: "Campana", description: "Falda que se abre en curva.", recipe: { family: "wavy", waves: 12, amplitudeMm: 4, twistDeg: 0, profile: "bell", profileAmountPct: 60, verticalFrequency: 2, patternIntensityPct: 25, organicPct: 0, topRatio: 1.5, seed: 8 } },
];

export function applyLampPreset(def: LampDefinition, preset: LampPreset): LampDefinition {
  const { topRatio, ...rest } = preset.recipe;
  return {
    ...def,
    shade: {
      ...def.shade,
      ...rest,
      topDiameterMm: Math.round(def.shade.bottomDiameterMm * topRatio),
    },
  };
}
