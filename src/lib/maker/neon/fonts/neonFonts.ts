import type { NeonFontId } from "@/lib/maker/neon/types";

/**
 * Catálogo de fuentes de TRAZOS para Neon LED. Todas comparten los datos de
 * glifos de fonts/glyphs.ts y se diferencian por una transformación simple
 * (hoy: inclinación). Sumar una fuente con otros glifos (p.ej. Hershey) es
 * agregar acá un `glyphSet` propio: el resto del pipeline no cambia.
 */
export interface NeonFontDefinition {
  id: NeonFontId;
  label: string;
  description: string;
  /** Inclinación (grados) aplicada a todos los trazos, cizalla horizontal sobre la línea base. */
  shearDeg: number;
}

export const NEON_FONTS: readonly NeonFontDefinition[] = [
  { id: "neon-linea", label: "Stampa Línea (recta)", description: "Trazo único geométrico, mayúsculas.", shearDeg: 0 },
  { id: "neon-cursiva", label: "Stampa Línea (inclinada)", description: "Misma fuente inclinada 12°.", shearDeg: 12 },
];

export function getNeonFont(id: NeonFontId): NeonFontDefinition {
  return NEON_FONTS.find((f) => f.id === id) ?? NEON_FONTS[0];
}
