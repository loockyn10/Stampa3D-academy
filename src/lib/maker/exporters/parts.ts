import type { SignPart, TriangleSoupData } from "@/lib/maker/types";

export interface PartFileEntry {
  fileName: string;
  mesh: TriangleSoupData;
}

/**
 * Un archivo .stl por pieza física: `<baseName>.stl` cuando hay una sola
 * pieza (frente abierto, comportamiento 0.1 sin cambios), o
 * `<baseName>_<sufijo>.stl` por pieza cuando hay dos o más (tapa, máscara,
 * difusor, canal — 0.2+). Punto único de esta decisión: exportWord.ts y
 * exportLettersZip.ts la reusan en vez de tener cada uno su propio
 * `if (piezas > 1)`.
 */
export function partFileEntries(parts: SignPart[], baseName: string): PartFileEntry[] {
  if (parts.length === 1) {
    return [{ fileName: `${baseName}.stl`, mesh: parts[0].mesh }];
  }
  return parts.map((part) => ({ fileName: `${baseName}_${part.filenameSuffix}.stl`, mesh: part.mesh }));
}
