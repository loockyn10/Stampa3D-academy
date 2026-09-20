import type { RasterCleaning, RasterImage } from "@/lib/maker/neon/raster/types";

/**
 * Procesamiento de imagen puro (sin DOM): campos escalares, umbral, recorte, remuestreo, blur y
 * morfología. Trabaja sobre un CAMPO escalar de 0-255 (alpha o luminancia) y solo al final se
 * binariza, así el remuestreo y el blur conservan el anti-aliasing de los bordes.
 */

export type FieldKind = "alpha" | "luminance";

export interface Field {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Luminancia de un píxel RGB con los coeficientes Rec. 709 (0.2126 R + 0.7152 G + 0.0722 B), sobre los valores
 * sRGB tal cual (luma, sin linealizar). Un píxel semitransparente se compone antes sobre BLANCO.
 */
export function luminanceField(img: RasterImage, contrast = 0): Uint8Array {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  const d = img.data;
  // Contraste: (v - 128) * f + 128, con f = 259(c+255) / (255(259-c)), c = contrast * 2.55 (contrast -100..100).
  const c = Math.max(-100, Math.min(100, contrast)) * 2.55;
  const f = c === 0 ? 1 : (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = d[j + 3] / 255;
    const r = d[j] * a + 255 * (1 - a);
    const g = d[j + 1] * a + 255 * (1 - a);
    const b = d[j + 2] * a + 255 * (1 - a);
    let v = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (f !== 1) v = (v - 128) * f + 128;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }
  return out;
}

export function alphaField(img: RasterImage): Uint8Array {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  for (let i = 0, j = 3; i < n; i++, j += 4) out[i] = img.data[j];
  return out;
}

/**
 * ¿Tiene transparencia significativa? (más de 1 % de píxeles con alpha < 250). Sirve para elegir el modo en
 * "Automático": un PNG opaco (o con un puñado de píxeles semitransparentes en el borde) va por luminosidad.
 */
export function hasSignificantAlpha(img: RasterImage): boolean {
  const n = img.width * img.height;
  let transparent = 0;
  for (let i = 0, j = 3; i < n; i++, j += 4) if (img.data[j] < 250) transparent++;
  return transparent / n > 0.01;
}

/**
 * Umbral de Otsu sobre un campo 0-255: el valor T que maximiza la varianza entre clases {<=T} y {>T}.
 * Determinístico; ante un histograma de una sola clase devuelve 127.
 */
export function otsuThreshold(field: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < field.length; i++) hist[field[i]]++;
  const total = field.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let wB = 0, sumB = 0, best = -1, first = 127, last = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best * (1 + 1e-12)) {
      best = between;
      first = t;
      last = t;
    } else if (between >= best * (1 - 1e-12)) {
      last = t; // meseta: mismo máximo (p.ej. un histograma de solo 0 y 255 empata en todo el hueco)
    }
  }
  // Punto medio de la meseta: con dos valores puros (0/255) da ~127 en vez de 0, y tolera grises intermedios.
  return Math.round((first + last) / 2);
}

/** Valor del campo que la máscara considera FONDO (para rellenar márgenes sin crear foreground). */
export function backgroundValue(kind: FieldKind, invert: boolean): number {
  const fgIsHigh = kind === "alpha" ? !invert : invert; // ¿el foreground está en valores altos?
  return fgIsHigh ? 0 : 255;
}

/**
 * Máscara binaria del campo. alpha: material = alpha > umbral. luminance: material = oscuro (lum <= umbral).
 * `invert` invierte la MÁSCARA (nunca los paths).
 */
export function foregroundMask(field: Uint8Array, threshold: number, kind: FieldKind, invert: boolean): Uint8Array {
  const out = new Uint8Array(field.length);
  const high = kind === "alpha";
  for (let i = 0; i < field.length; i++) {
    const on = high ? field[i] > threshold : field[i] <= threshold;
    out[i] = on !== invert ? 1 : 0;
  }
  return out;
}

export interface Box {
  x0: number;
  y0: number;
  /** exclusivos */
  x1: number;
  y1: number;
}

export function maskBoundingBox(mask: Uint8Array, width: number, height: number): Box | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

export function maskCount(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

/** Recorta `box` ampliado en `margin` px; lo que cae fuera de la imagen se rellena con `fill`. */
export function cropField(field: Uint8Array, width: number, height: number, box: Box, margin: number, fill: number): Field {
  const w = box.x1 - box.x0 + 2 * margin;
  const h = box.y1 - box.y0 + 2 * margin;
  const out = new Uint8Array(w * h).fill(fill);
  for (let y = 0; y < h; y++) {
    const sy = box.y0 - margin + y;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < w; x++) {
      const sx = box.x0 - margin + x;
      if (sx < 0 || sx >= width) continue;
      out[y * w + x] = field[sy * width + sx];
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Remuestreo de un campo. Reducir = promedio de área (box filter: sin aliasing); ampliar = bilinear.
 * Se hace sobre el campo (no sobre la máscara) para que el borde conserve su anti-aliasing.
 */
export function resampleField(src: Uint8Array, width: number, height: number, newW: number, newH: number): Uint8Array {
  if (newW === width && newH === height) return src;
  const out = new Uint8Array(newW * newH);
  const sx = width / newW, sy = height / newH;
  if (sx >= 1 && sy >= 1) {
    for (let y = 0; y < newH; y++) {
      const y0 = y * sy, y1 = Math.min(height, (y + 1) * sy);
      for (let x = 0; x < newW; x++) {
        const x0 = x * sx, x1 = Math.min(width, (x + 1) * sx);
        let acc = 0, wsum = 0;
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
            const w = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0));
            acc += src[yy * width + xx] * w;
            wsum += w;
          }
        }
        out[y * newW + x] = Math.round(acc / wsum);
      }
    }
    return out;
  }
  // Bilinear (ampliación o eje mixto).
  for (let y = 0; y < newH; y++) {
    const fy = Math.min(height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(height - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < newW; x++) {
      const fx = Math.min(width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(width - 1, x0 + 1), tx = fx - x0;
      const a = src[y0 * width + x0] * (1 - tx) + src[y0 * width + x1] * tx;
      const b = src[y1 * width + x0] * (1 - tx) + src[y1 * width + x1] * tx;
      out[y * newW + x] = Math.round(a * (1 - ty) + b * ty);
    }
  }
  return out;
}

/** Blur gaussiano separable (bordes replicados). sigma <= 0 devuelve el mismo campo. */
export function gaussianBlur(src: Uint8Array, width: number, height: number, sigma: number): Uint8Array {
  if (sigma <= 0) return src;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        acc += src[y * width + xx] * kernel[k + radius];
      }
      tmp[y * width + x] = acc;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        acc += tmp[yy * width + x] * kernel[k + radius];
      }
      out[y * width + x] = Math.round(acc);
    }
  }
  return out;
}

export interface Labeling {
  labels: Int32Array;
  count: number;
  areas: number[];
}

/** Componentes conexas de los píxeles == `value` (conectividad 8 para el 1, 4 para el 0: el par estándar sin ambigüedad). */
export function labelComponents(mask: Uint8Array, width: number, height: number, value = 1): Labeling {
  const labels = new Int32Array(width * height).fill(-1);
  const areas: number[] = [];
  const stack: number[] = [];
  const eight = value === 1;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== value || labels[start] !== -1) continue;
    const id = areas.length;
    let area = 0;
    stack.push(start);
    labels[start] = id;
    while (stack.length) {
      const p = stack.pop() as number;
      area++;
      const x = p % width, y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (mask[q] === value && labels[q] === -1) {
            labels[q] = id;
            stack.push(q);
          }
        }
      }
    }
    areas.push(area);
  }
  return { labels, count: areas.length, areas };
}

/** Quita islas de foreground menores que `minIsland` px y rellena agujeros (fondo que no toca el borde) menores que `minHole` px. */
export function removeSmallFeatures(mask: Uint8Array, width: number, height: number, minIsland: number, minHole: number): { mask: Uint8Array; islandsRemoved: number } {
  const out = Uint8Array.from(mask);
  let islandsRemoved = 0;
  const fg = labelComponents(out, width, height, 1);
  for (let i = 0; i < out.length; i++) {
    if (out[i] === 1 && fg.areas[fg.labels[i]] < minIsland) out[i] = 0;
  }
  for (const a of fg.areas) if (a < minIsland) islandsRemoved++;
  if (minHole > 0) {
    const bg = labelComponents(out, width, height, 0);
    const touchesBorder = new Uint8Array(bg.count);
    for (let x = 0; x < width; x++) {
      touchesBorder[bg.labels[x]] = 1;
      touchesBorder[bg.labels[(height - 1) * width + x]] = 1;
    }
    for (let y = 0; y < height; y++) {
      touchesBorder[bg.labels[y * width]] = 1;
      touchesBorder[bg.labels[y * width + width - 1]] = 1;
    }
    for (let i = 0; i < out.length; i++) {
      if (out[i] === 0) {
        const id = bg.labels[i];
        if (!touchesBorder[id] && bg.areas[id] < minHole) out[i] = 1;
      }
    }
  }
  return { mask: out, islandsRemoved };
}

/** Filtro de mayoría 3×3 (alisa bordes irregulares y píxeles sueltos sin cambiar la topología gruesa). */
export function majorityFilter(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width) n += mask[yy * width + xx];
        }
      }
      out[y * width + x] = n >= 5 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Distancia euclídea exacta (px) de cada píxel de foreground al fondo más cercano (Felzenszwalb–Huttenlocher, O(n)).
 * El valor sobre el skeleton es el RADIO local del trazo: sirve para distinguir un espolón real de un abultamiento de esquina.
 */
export function distanceTransform(mask: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e20;
  const f = new Float64Array(Math.max(width, height));
  const v = new Int32Array(Math.max(width, height));
  const z = new Float64Array(Math.max(width, height) + 1);
  const d = new Float64Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const pass = (n: number, get: (i: number) => number, set: (i: number, val: number) => void) => {
    for (let i = 0; i < n; i++) f[i] = get(i);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      set(q, (q - v[k]) * (q - v[k]) + f[v[k]]);
    }
  };
  for (let x = 0; x < width; x++) pass(height, (y) => d[y * width + x], (y, val) => (d[y * width + x] = val));
  for (let y = 0; y < height; y++) pass(width, (x) => d[y * width + x], (x, val) => (d[y * width + x] = val));
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(d[i]);
  return out;
}

/** Parámetros de limpieza por nivel: sigma del blur (px de trabajo), factor del tamaño mínimo de islas/agujeros y si aplica mayoría 3×3. */
export function cleaningParams(level: RasterCleaning): { sigma: number; sizeFactor: number; majority: boolean } {
  switch (level) {
    case 0: return { sigma: 0, sizeFactor: 0, majority: false };
    case 1: return { sigma: 0.8, sizeFactor: 1, majority: false };
    case 2: return { sigma: 1.5, sizeFactor: 2, majority: true };
    default: return { sigma: 2.2, sizeFactor: 4, majority: true };
  }
}
