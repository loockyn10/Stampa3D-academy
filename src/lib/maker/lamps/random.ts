/** PRNG determinista (mulberry32): misma semilla -> misma secuencia, en cualquier entorno. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SmoothNoise {
  /** Valor en [-1, 1], suave (suma de senoides con fases/frecuencias de la semilla). */
  at(u: number): number;
}

/** Ruido 1D suave y reproducible: continuo en todas sus derivadas (no hay saltos de forma al variar la semilla). */
export function smoothNoise(seed: number, channel: number): SmoothNoise {
  const rand = mulberry32((seed ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0);
  const harmonics = [
    { freq: 0.7 + rand() * 0.5, amp: 1, phase: rand() * Math.PI * 2 },
    { freq: 1.4 + rand() * 0.9, amp: 0.6, phase: rand() * Math.PI * 2 },
    { freq: 2.6 + rand() * 1.4, amp: 0.3, phase: rand() * Math.PI * 2 },
  ];
  const norm = harmonics.reduce((s, h) => s + h.amp, 0);
  return {
    at(u: number) {
      let v = 0;
      for (const h of harmonics) v += h.amp * Math.sin(2 * Math.PI * h.freq * u + h.phase);
      return v / norm;
    },
  };
}
