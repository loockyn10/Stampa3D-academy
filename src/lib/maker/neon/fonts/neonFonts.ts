import type { NeonFontId } from "@/lib/maker/neon/types";
import type { NeonFontData } from "@/lib/maker/neon/fonts/fontData";
import { ACCENT_STROKES, CAP_HEIGHT, GLYPHS, GLYPH_GAP, SPACE_ADVANCE } from "@/lib/maker/neon/fonts/glyphs";
import { MISTRAL_SINGLELINE_DATA } from "@/lib/maker/neon/fonts/data/mistralSingleLine";
import { RELIEF_SINGLELINE_DATA } from "@/lib/maker/neon/fonts/data/reliefSingleLine";

/**
 * Registro central de fuentes de TRAZOS para Neon LED. Todas exponen la misma
 * interfaz (`getGlyph` / `getKerning`), así que el motor de texto no sabe de
 * dónde vienen los glifos. Agregar una fuente: preprocesarla a `NeonFontData`
 * (scripts/build-neon-fonts.mjs), registrarla acá y documentar su licencia.
 */
export type NeonFontCategory = "script" | "modern" | "geometric" | "technical";

export const NEON_FONT_CATEGORY_LABELS: Record<NeonFontCategory, string> = {
  script: "Script",
  modern: "Moderna",
  geometric: "Geométrica",
  technical: "Técnica",
};

export interface NeonFontLicense {
  name: string;
  holder: string;
  /** Archivo de licencia versionado en fonts/licenses/ (null = código propio de Stampa). */
  file: string | null;
  url: string | null;
}

export interface NeonGlyphShape {
  /** Path data SVG (Y arriba, unidades de fuente). Vacío para el espacio. */
  d: string;
  /** Avance horizontal hasta el siguiente carácter, en unidades de fuente (sin kerning ni espaciado extra). */
  advance: number;
  /** Extensión visual aproximada (para centrar acentos sintetizados). */
  width: number;
}

export interface NeonFontDefinition {
  id: NeonFontId;
  label: string;
  category: NeonFontCategory;
  description: string;
  /** De dónde salen los glifos y en qué formato original. */
  source: string;
  license: NeonFontLicense;
  /** "upper": la fuente solo dibuja mayúsculas. "preserve": respeta mayúsculas/minúsculas. */
  caseMode: "upper" | "preserve";
  /** Inclinación (grados) aplicada a todos los trazos, cizalla horizontal sobre la línea base. */
  shearDeg: number;
  /** Altura de mayúscula en unidades de fuente: referencia de escala del "Alto del diseño". */
  capHeight: number;
  spaceAdvance: number;
  getGlyph(ch: string): NeonGlyphShape | null;
  /** Ajuste de avance del par (unidades de fuente); usa la letra base de cada carácter. */
  getKerning(left: string, right: string): number;
  /** Trazo de un acento combinante (relativo al centro del glifo base), si la fuente lo sintetiza. */
  getAccentStroke(mark: string): string | null;
}

function baseChar(ch: string): string {
  return ch.normalize("NFD")[0] ?? ch;
}

function dataFont(
  base: Pick<NeonFontDefinition, "id" | "label" | "category" | "description" | "source" | "license">,
  data: NeonFontData,
): NeonFontDefinition {
  return {
    ...base,
    caseMode: "preserve",
    shearDeg: 0,
    capHeight: data.capHeight,
    spaceAdvance: data.glyphs[" "]?.[0] ?? data.capHeight * 0.5,
    getGlyph(ch) {
      const g = data.glyphs[ch];
      return g ? { d: g[1], advance: g[0], width: g[0] } : null;
    },
    getKerning(left, right) {
      return data.kerning[baseChar(left) + baseChar(right)] ?? 0;
    },
    getAccentStroke: () => null,
  };
}

const STAMPA_LICENSE: NeonFontLicense = { name: "Propia de Stampa (sin datos de terceros)", holder: "Stampa", file: null, url: null };

function stampaFont(id: "neon-linea" | "neon-cursiva", label: string, description: string, shearDeg: number): NeonFontDefinition {
  return {
    id,
    label,
    category: shearDeg === 0 ? "geometric" : "technical",
    description,
    source: "Glifos dibujados para Stampa como paths SVG (fonts/glyphs.ts).",
    license: STAMPA_LICENSE,
    caseMode: "upper",
    shearDeg,
    capHeight: CAP_HEIGHT,
    spaceAdvance: SPACE_ADVANCE,
    getGlyph(ch) {
      const g = GLYPHS[ch];
      return g ? { d: g.d, advance: g.width + GLYPH_GAP, width: g.width } : null;
    },
    getKerning: () => 0,
    getAccentStroke: (mark) => ACCENT_STROKES[mark] ?? null,
  };
}

/** Orden del selector: script / neon-friendly primero. */
export const NEON_FONTS: readonly NeonFontDefinition[] = [
  dataFont(
    {
      id: "mistral-singleline",
      label: "Mistral SingleLine",
      category: "script",
      description: "Cursiva manuscrita de trazo único: la más natural para Neon.",
      source: "isdat-type/Mistral-SingleLine, capa single-line real (UFO, contornos abiertos). SHA fc23517.",
      license: { name: "SIL OFL 1.1", holder: "The Mistral SingleLine Project Authors (2025)", file: "OFL-Mistral-SingleLine.txt", url: "https://github.com/isdat-type/Mistral-SingleLine" },
    },
    MISTRAL_SINGLELINE_DATA,
  ),
  dataFont(
    {
      id: "relief-singleline",
      label: "Relief SingleLine",
      category: "modern",
      description: "Sans moderna de trazo único, limpia y legible.",
      source: "isdat-type/Relief-SingleLine, SVG Font single-line (open_svg). SHA 01dfc57.",
      license: { name: "SIL OFL 1.1", holder: "The Relief SingleLine Project Authors (2021/2022)", file: "OFL-Relief-SingleLine.txt", url: "https://github.com/isdat-type/Relief-SingleLine" },
    },
    RELIEF_SINGLELINE_DATA,
  ),
  stampaFont("neon-linea", "Stampa Línea", "Geométrica de trazo único, solo mayúsculas.", 0),
  stampaFont("neon-cursiva", "Stampa Línea inclinada", "Stampa Línea inclinada 12°, solo mayúsculas.", 12),
];

export function getNeonFont(id: NeonFontId): NeonFontDefinition {
  return NEON_FONTS.find((f) => f.id === id) ?? NEON_FONTS[0];
}
