import { DEFAULT_LETTER_SIGN_PARAMS } from "@/lib/maker/defaults";
import type { LetterSignParams } from "@/lib/maker/types";
import { PRESET_SETTING_KEYS, type PresetSettings } from "@/lib/maker/presets/presetSettings";

/**
 * ESTILOS del Creador de Carteles (creación rápida): registro central de
 * presets "de sistema". Un estilo es una configuración concreta de los MISMOS
 * parámetros (`LetterSignParams`) que ya edita la "Personalización avanzada":
 * no hay un segundo estado ni un motor propio. Elegir un estilo = aplicar sus
 * parámetros sobre `params`; editar un parámetro a mano = `params` deja de
 * coincidir con el estilo y la UI lo marca "Personalizado".
 *
 * Distinto de los presets del usuario (`maker_presets`, tabla en Supabase,
 * presets/presetSettings.ts): esos son recetas guardadas por cada usuario;
 * los estilos son fijos, versionados en código y no tocan la base de datos.
 *
 * Estilo (aspecto) y fabricación (material + resistencia, ver wallStrength.ts)
 * son independientes: `material` y `wallMm` NO son claves de estilo, así que
 * elegir un estilo nunca los modifica ni los restaura, y ningún estilo puede
 * definirlos. El bisel y la cintura tampoco dependen de la pared: la cavidad
 * los acompaña (geometry/body/cavity.ts).
 *
 * Ver docs/STAMPA_MAKER.md (sección "Estilos del Creador de Carteles").
 */

/**
 * Claves de LetterSignParams que define un estilo: la receta de cuerpo/frente
 * (PRESET_SETTING_KEYS) SIN la receta de instalación (montaje/cableado/
 * plantilla) y SIN la configuración estructural de fabricación (`material`,
 * `wallMm`): ambas son independientes del aspecto del cartel y se conservan al
 * cambiar de estilo. Nunca incluye el diseño (texto, fuente, alto, recortes).
 */
export const NON_STYLE_KEYS = ["installation", "material", "wallMm"] as const;
type NonStyleKey = (typeof NON_STYLE_KEYS)[number];

export const STYLE_PARAM_KEYS = PRESET_SETTING_KEYS.filter((k) => !(NON_STYLE_KEYS as readonly string[]).includes(k)) as readonly Exclude<(typeof PRESET_SETTING_KEYS)[number], NonStyleKey>[];

export type StyleSettings = Omit<PresetSettings, NonStyleKey>;

/** Categorías de estilo (preparado para filtrar la galería cuando haya más estilos; hoy solo se usa como metadato). */
export type StyleCategory = "esencial" | "volumen" | "tecnico" | "luminoso";

export interface StylePreset {
  /** Identificador estable: nunca se renombra ni se reutiliza (lo referencian miniaturas, documentación y, a futuro, favoritos/proyectos). */
  id: string;
  /** Sube cuando cambian los parámetros del estilo (invalida la miniatura generada). */
  version: number;
  name: string;
  /** Una línea: qué lo distingue físicamente. */
  description: string;
  category: StyleCategory;
  /** Solo lo que se aparta de los valores base de Stampa (DEFAULT_LETTER_SIGN_PARAMS); el resto se completa en `resolveStyleSettings`. */
  overrides: Partial<StyleSettings>;
}

/** Texto de ejemplo uniforme de las miniaturas (todas se generan con el mismo, para poder comparar diseños). */
export const STYLE_THUMBNAIL_SAMPLE_TEXT = "Sol";
/** Alto del texto de ejemplo de las miniaturas, en mm (el de Stampa por defecto, para que las proporciones sean las reales). */
export const STYLE_THUMBNAIL_SAMPLE_HEIGHT_MM = DEFAULT_LETTER_SIGN_PARAMS.heightMm;

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: "minimal",
    version: 2,
    name: "Minimal",
    description: "Contorno bajo y liviano, frente abierto: poco material y rápido de imprimir.",
    category: "esencial",
    overrides: { depthMm: 12 },
  },
  {
    id: "clasico",
    version: 1,
    name: "Clásico",
    description: "Letra corpórea hueca de frente abierto, con los valores base de Stampa.",
    category: "esencial",
    overrides: {},
  },
  {
    id: "liso",
    version: 1,
    name: "Liso",
    description: "Frente cerrado con tapa plana: la letra se ve maciza y prolija.",
    category: "esencial",
    overrides: { frontType: "lid", lidMm: 1.2, depthMm: 25 },
  },
  {
    id: "suave",
    version: 2,
    name: "Suave",
    description: "Bisel superior y tapa de borde suavizado: bordes inclinados en lugar de cantos vivos.",
    category: "volumen",
    overrides: { frontType: "lid", lidMm: 2, depthMm: 30, bevelEnabled: true, bevelDepthMm: 6, bevelInsetMm: 2.4, lidBevelEnabled: true, lidBevelDepthMm: 1, lidBevelInsetMm: 0.8 },
  },
  {
    id: "bold",
    version: 3,
    name: "Bold",
    description: "Letras muy profundas, con tapa gruesa y una costilla lateral marcada: presencia máxima.",
    category: "volumen",
    overrides: { frontType: "lid", lidMm: 2.4, depthMm: 70, baseMm: 2, ribsCount: 1, ribProtrusionMm: 2, ribWidthMm: 6 },
  },
  {
    id: "retro",
    version: 2,
    name: "Retro",
    description: "Tapa cerrada y una cintura hundida en el lateral, como los carteles de marquesina.",
    category: "volumen",
    overrides: { frontType: "lid", lidMm: 1.2, depthMm: 40, grooveEnabled: true, grooveInsetMm: 2.2, grooveWidthMm: 10, groovePositionMm: 20 },
  },
  {
    id: "capas",
    version: 1,
    name: "Capas",
    description: "Cuerpo escalonado que se ensancha hacia la base, con niveles visibles.",
    category: "volumen",
    overrides: { frontType: "lid", lidMm: 1.2, depthMm: 40, bodyType: "tapered", taperStyle: "stepped", rearExpansionMm: 8 },
  },
  {
    id: "industrial",
    version: 3,
    name: "Industrial",
    description: "Frente perforado con máscara oscura y costillas laterales, de aspecto técnico.",
    category: "tecnico",
    overrides: { frontType: "perforated", depthMm: 40, ribsCount: 2 },
  },
  {
    id: "luminoso",
    version: 1,
    name: "Luminoso",
    description: "Canal interior con difusor para iluminar la letra desde adentro.",
    category: "luminoso",
    overrides: { frontType: "light-channel", depthMm: 35 },
  },
  {
    id: "moderno",
    version: 2,
    name: "Moderno",
    description: "Frente abierto con un bisel amplio en el borde y poca profundidad: líneas limpias.",
    category: "esencial",
    overrides: { depthMm: 22, bevelEnabled: true, bevelDepthMm: 10, bevelInsetMm: 2.8 },
  },
];

export const DEFAULT_STYLE_ID = "clasico";

export function getStylePreset(id: string | null | undefined): StylePreset | null {
  return STYLE_PRESETS.find((s) => s.id === id) ?? null;
}

/** Extrae SOLO las claves de estilo de los params actuales. */
export function extractStyleSettings(params: LetterSignParams): StyleSettings {
  const out: Record<string, unknown> = {};
  for (const key of STYLE_PARAM_KEYS) out[key] = params[key];
  return out as unknown as StyleSettings;
}

/** Configuración COMPLETA y determinística de un estilo: valores base de Stampa + sus overrides. No depende de lo que el usuario tenga cargado. */
export function resolveStyleSettings(preset: StylePreset): StyleSettings {
  return { ...extractStyleSettings(DEFAULT_LETTER_SIGN_PARAMS), ...preset.overrides };
}

/**
 * Aplica un estilo sobre los params actuales. Conserva todo lo que no es de
 * estilo: texto, fuente, alto, recortes traseros, instalación.
 */
export function applyStylePreset(current: LetterSignParams, preset: StylePreset): LetterSignParams {
  return { ...current, ...resolveStyleSettings(preset) };
}

/** ¿Los params actuales coinciden exactamente con la configuración del estilo? (false = "Personalizado"). Material y pared no son claves de estilo: se eligen aparte y cambiarlos no saca al cartel de su estilo. */
export function matchesStylePreset(params: LetterSignParams, preset: StylePreset): boolean {
  const target = resolveStyleSettings(preset);
  return STYLE_PARAM_KEYS.every((key) => params[key] === target[key]);
}

/** Estilo cuya configuración coincide con los params (p.ej. al abrir un proyecto o un preset del usuario); null si ninguno. */
export function detectStylePreset(params: LetterSignParams): StylePreset | null {
  return STYLE_PRESETS.find((s) => matchesStylePreset(params, s)) ?? null;
}

/** Ruta pública de la miniatura de un estilo (generada con scripts/generate-maker-style-thumbnails.mjs). */
export function styleThumbnailPath(preset: Pick<StylePreset, "id">): string {
  return `/maker/styles/${preset.id}.png`;
}

/** Firma estable de la configuración de un estilo (FNV-1a de su JSON ordenado): el manifiesto de miniaturas la guarda para detectar miniaturas desactualizadas. */
export function styleSignature(preset: StylePreset): string {
  const settings = resolveStyleSettings(preset) as unknown as Record<string, unknown>;
  const text = JSON.stringify({ v: preset.version, sample: STYLE_THUMBNAIL_SAMPLE_TEXT, h: STYLE_THUMBNAIL_SAMPLE_HEIGHT_MM, s: STYLE_PARAM_KEYS.map((k) => [k, settings[k]]) });
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
