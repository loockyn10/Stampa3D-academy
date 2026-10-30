import type { LetterSignParams, MakerMaterial } from "@/lib/maker/types";

/**
 * Material y resistencia del cartel (Creador de Carteles). Dos selectores
 * simples que eligen `wallMm`; NO son un segundo espesor: la única fuente de
 * verdad geométrica sigue siendo `LetterSignParams.wallMm` (el campo "Pared"
 * de Personalización avanzada).
 *
 * - `params.material` es una selección EXPLÍCITA (PLA o PETG), independiente
 *   del espesor: el mismo espesor aparece en dos perfiles (PETG Normal = PLA
 *   Ligero = 1,35 mm), por eso el material nunca se deduce de `wallMm`.
 * - La resistencia (Ligero / Normal / Reforzado) SÍ se deduce de
 *   (material, wallMm), igual que el estilo "Personalizado" se deduce de los
 *   parámetros: no hay un estado que pueda contradecirse con el campo "Pared".
 *   Un espesor que no coincide con ningún perfil del material es "Personalizado".
 *
 * El material es un PERFIL DE FABRICACIÓN: no cambia propiedades físicas del
 * modelo ni simula resistencia mecánica. Los espesores son valores iniciales de
 * diseño pensados para boquilla de 0,4 mm y línea nominal de 0,45 mm; el
 * laminador decide los perímetros finales.
 */
export type { MakerMaterial } from "@/lib/maker/types";
export type WallStrength = "light" | "normal" | "reinforced";

export const DEFAULT_MATERIAL: MakerMaterial = "petg";
export const DEFAULT_WALL_STRENGTH: WallStrength = "normal";

/** Ancho de línea nominal de referencia (mm) para la descripción "aproximadamente N líneas". */
export const NOMINAL_LINE_WIDTH_MM = 0.45;

/** Espesor de pared (mm) por material y resistencia. Única tabla de perfiles. */
export const WALL_PROFILES: Readonly<Record<MakerMaterial, Readonly<Record<WallStrength, number>>>> = {
  petg: { light: 0.9, normal: 1.35, reinforced: 1.8 },
  pla: { light: 1.35, normal: 1.8, reinforced: 2.25 },
};

/** Espesor inicial de proyectos nuevos: PETG + Normal. */
export const DEFAULT_WALL_MM = WALL_PROFILES[DEFAULT_MATERIAL][DEFAULT_WALL_STRENGTH];

export interface MaterialOption {
  id: MakerMaterial;
  label: string;
}

/** Orden de los botones en la interfaz. */
export const MATERIAL_OPTIONS: readonly MaterialOption[] = [
  { id: "pla", label: "PLA" },
  { id: "petg", label: "PETG" },
];

export interface WallStrengthOption {
  id: WallStrength;
  label: string;
  /** Qué prioriza. */
  summary: string;
}

export const WALL_STRENGTH_OPTIONS: readonly WallStrengthOption[] = [
  { id: "light", label: "Ligero", summary: "Menos material, impresión más rápida." },
  { id: "normal", label: "Normal", summary: "Equilibrio para carteles decorativos." },
  { id: "reinforced", label: "Reforzado", summary: "Paredes más robustas." },
];

/** Orientación (no una garantía): lo que decide el laminador es el número final de perímetros. */
export const PERIMETER_HINT = "Es el espesor físico de la pared, no una garantía de resistencia ni de perímetros: el laminador decide las trayectorias finales.";

const TOLERANCE_MM = 1e-6;

/**
 * Material de un valor persistido. Proyectos y presets anteriores no lo tienen:
 * se leen como PETG (valor de compatibilidad, igual al de proyectos nuevos) sin
 * tocar su espesor; si ese espesor no coincide con un perfil, se muestra "Personalizado".
 */
export function normalizeMaterial(value: unknown): MakerMaterial {
  return value === "pla" || value === "petg" ? value : DEFAULT_MATERIAL;
}

export function wallMmFor(material: MakerMaterial, strength: WallStrength): number {
  return WALL_PROFILES[material][strength];
}

/** Resistencia que corresponde a (material, espesor), o null si es un valor propio (p.ej. 1,6 mm de proyectos anteriores). */
export function detectWallStrength(material: MakerMaterial, wallMm: number): WallStrength | null {
  const profile = WALL_PROFILES[material];
  return WALL_STRENGTH_OPTIONS.find((o) => Math.abs(profile[o.id] - wallMm) < TOLERANCE_MM)?.id ?? null;
}

/** Aplica una resistencia: sólo cambia `wallMm` (según el material actual); texto, fuente, estilo y demás ajustes se conservan. */
export function applyWallStrength(params: LetterSignParams, strength: WallStrength): LetterSignParams {
  return { ...params, wallMm: wallMmFor(params.material, strength) };
}

/**
 * Cambia el material conservando el nivel de resistencia elegido: con un nivel
 * activo el espesor pasa al del mismo nivel en el material nuevo; si la pared es
 * "Personalizada" se respeta tal cual (sólo cambia el material).
 */
export function applyMaterial(params: LetterSignParams, material: MakerMaterial): LetterSignParams {
  if (material === params.material) return params;
  const strength = detectWallStrength(params.material, params.wallMm);
  return { ...params, material, wallMm: strength ? wallMmFor(material, strength) : params.wallMm };
}

/** Líneas de extrusión nominales que entran en la pared (orientativo). */
export function approxExtrusionLines(wallMm: number): number {
  return Math.max(1, Math.round(wallMm / NOMINAL_LINE_WIDTH_MM - 1e-9));
}

export function materialLabel(material: MakerMaterial): string {
  return MATERIAL_OPTIONS.find((o) => o.id === material)?.label ?? material.toUpperCase();
}

export function strengthLabel(strength: WallStrength | null): string {
  return WALL_STRENGTH_OPTIONS.find((o) => o.id === strength)?.label ?? "Personalizado";
}
