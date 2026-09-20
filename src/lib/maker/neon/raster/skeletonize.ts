/**
 * Skeletonization (adelgazamiento) de una máscara binaria: Guo–Hall (1989), 2 sub-iteraciones.
 *
 * Por qué Guo–Hall y no Zhang–Suen: ambos son determinísticos, puros y de ~50 líneas, sin dependencias.
 * Guo–Hall usa un número de cruce que preserva mejor la conectividad, erosiona menos las diagonales y
 * deja menos "escaleras" y espolones que Zhang–Suen, que es lo que más importa para trazar paths limpios.
 * No se usó una biblioteca (WASM/OpenCV): sería una dependencia grande para un algoritmo de ~100 líneas
 * y los resultados de un adelgazamiento clásico alcanzan cuando después se poda y suaviza el grafo.
 *
 * Es un adelgazamiento, no el eje medial exacto: preserva topología (loops, componentes, bifurcaciones)
 * pero los extremos se retraen ~medio ancho del trazo (se compensa en extendEndpoints).
 */

/** Devuelve una copia con el skeleton (0/1). La máscara debe tener un borde vacío de al menos 1 px (rasterToNeonPaths lo garantiza); igual se protege. */
export function skeletonize(mask: Uint8Array, width: number, height: number): Uint8Array {
  const img = Uint8Array.from(mask);
  // Borde forzado a 0: el algoritmo lee vecinos sin comprobar límites.
  for (let x = 0; x < width; x++) {
    img[x] = 0;
    img[(height - 1) * width + x] = 0;
  }
  for (let y = 0; y < height; y++) {
    img[y * width] = 0;
    img[y * width + width - 1] = 0;
  }

  let active: number[] = [];
  for (let i = 0; i < img.length; i++) if (img[i]) active.push(i);

  const W = width;
  let changed = true;
  while (changed) {
    changed = false;
    for (let sub = 0; sub < 2; sub++) {
      const toDelete: number[] = [];
      for (const p of active) {
        const p2 = img[p - W], p3 = img[p - W + 1], p4 = img[p + 1], p5 = img[p + W + 1];
        const p6 = img[p + W], p7 = img[p + W - 1], p8 = img[p - 1], p9 = img[p - W - 1];
        const C =
          (p2 ? 0 : 1) * (p3 | p4) + (p4 ? 0 : 1) * (p5 | p6) + (p6 ? 0 : 1) * (p7 | p8) + (p8 ? 0 : 1) * (p9 | p2);
        if (C !== 1) continue;
        const n1 = (p9 | p2) + (p3 | p4) + (p5 | p6) + (p7 | p8);
        const n2 = (p2 | p3) + (p4 | p5) + (p6 | p7) + (p8 | p9);
        const N = n1 < n2 ? n1 : n2;
        if (N < 2 || N > 3) continue;
        const m = sub === 0 ? (p6 | p7 | (p9 ? 0 : 1)) & p8 : (p2 | p3 | (p5 ? 0 : 1)) & p4;
        if (m === 0) toDelete.push(p);
      }
      if (toDelete.length) {
        changed = true;
        for (const p of toDelete) img[p] = 0;
        active = active.filter((p) => img[p] === 1);
      }
    }
  }
  removeStaircaseCorners(img, width, height);
  return img;
}

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
];

/**
 * Quita píxeles "de esquina" redundantes (un píxel con exactamente 2 vecinos que ya son adyacentes entre sí):
 * dejan el skeleton en 8-conectividad de 1 px sin falsos grados 3. Nunca rompe la conectividad.
 */
export function removeStaircaseCorners(img: Uint8Array, width: number, height: number): void {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 8) {
    changed = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x;
        if (!img[p]) continue;
        let count = 0, a = -1, b = -1;
        for (let k = 0; k < 8; k++) {
          const [dx, dy] = NEIGHBORS[k];
          if (img[p + dy * width + dx]) {
            if (count === 0) a = k;
            else if (count === 1) b = k;
            count++;
          }
        }
        if (count !== 2) continue;
        // a y b adyacentes entre sí: en el anillo de 8 vecinos están a distancia 1 o 2 (esquina) — 2 solo si el del medio es 4-vecino
        const d = Math.min(Math.abs(a - b), 8 - Math.abs(a - b));
        const [ax, ay] = NEIGHBORS[a], [bx, by] = NEIGHBORS[b];
        const adjacent = Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= 1;
        if (adjacent && d <= 2) {
          img[p] = 0;
          changed = true;
        }
      }
    }
  }
}
