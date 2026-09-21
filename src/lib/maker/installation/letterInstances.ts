import type { ContourGroup } from "@/lib/maker/types";
import type { LetterBounds, LetterInstance } from "@/lib/maker/installation/types";

interface PieceInput {
  char: string;
  contourGroups: ContourGroup[];
}

function boundsOf(groups: ContourGroup[]): LetterBounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const g of groups) {
    for (const [x, y] of g.outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Identidad FÍSICA de cada letra del cartel. Una letra es una pieza del motor
 * (un carácter con tinta), no un carácter: "STAMPA" tiene dos "A" y son dos
 * instancias distintas (`L3`/`L6`, etiquetas "A1"/"A2"). Determinístico: mismo
 * diseño => mismos ids/etiquetas. Las etiquetas de caracteres repetidos llevan el
 * número de ocurrencia (A1, A2); los únicos se quedan como están (S, T, M, P) —
 * ESA etiqueta es la que usan viewport, PDF, guía de cableado y ZIP.
 */
export function buildLetterInstances(pieces: PieceInput[]): LetterInstance[] {
  const totals = new Map<string, number>();
  for (const p of pieces) totals.set(p.char, (totals.get(p.char) ?? 0) + 1);
  const seen = new Map<string, number>();
  return pieces.map((piece, i) => {
    const occurrence = (seen.get(piece.char) ?? 0) + 1;
    seen.set(piece.char, occurrence);
    const repeated = (totals.get(piece.char) ?? 0) > 1;
    const base = piece.char.length === 1 ? piece.char : piece.char === "diseno" ? "Diseño" : piece.char;
    return {
      id: `L${i + 1}`,
      index: i + 1,
      char: piece.char,
      label: repeated ? `${base}${occurrence}` : base,
      boundsMm: boundsOf(piece.contourGroups),
      contourGroups: piece.contourGroups,
      positionInWord: { index: i, count: pieces.length, isFirst: i === 0, isLast: i === pieces.length - 1 },
    };
  });
}

export function findInstance(instances: LetterInstance[], id: string): LetterInstance | undefined {
  return instances.find((l) => l.id === id);
}
