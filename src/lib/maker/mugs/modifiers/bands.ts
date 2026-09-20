import type { MugBandsDef } from "@/lib/maker/mugs/types";

/** Centros (z, mm) de las bandas, distribución uniforme entre 12 % y 88 % de la altura. */
export function bandCenters(bands: MugBandsDef, heightMm: number): number[] {
  if (!bands.enabled || bands.count <= 0) return [];
  const lo = heightMm * 0.12, hi = heightMm * 0.88;
  if (bands.count === 1) return [(lo + hi) / 2];
  return Array.from({ length: bands.count }, (_, k) => lo + ((hi - lo) * k) / (bands.count - 1));
}

/** Relieve (mm, >= 0) de las bandas a la altura z: meseta con flancos de coseno. Sigue el radio local porque es aditivo. */
export function bandRelief(bands: MugBandsDef, centers: number[], z: number): number {
  let best = 0;
  const half = bands.heightMm / 2;
  for (const c of centers) {
    const u = Math.abs(z - c) / half;
    const s = u < 0.6 ? 1 : u < 1 ? 0.5 * (1 + Math.cos((Math.PI * (u - 0.6)) / 0.4)) : 0;
    if (s > best) best = s;
  }
  return best * bands.reliefMm;
}
