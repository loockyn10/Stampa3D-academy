import type { Point2D } from "@/lib/maker/types";
import { DesignImportError, IMPORT_LIMITS, type PngImportOptions, type PngSmoothing, type RawDesign } from "@/lib/maker/import/types";

/** Imagen RGBA 8 bits, fila por fila desde arriba. */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Trazado PNG (0.5): raster -> campo escalar -> contornos -> simplificación.
 *
 * Decisión (documentada en docs/STAMPA_MAKER.md §17): marching squares con
 * interpolación lineal sub-píxel + Douglas-Peucker PROPIOS, en vez de sumar
 * potrace/imagetracerjs. Es un algoritmo corto y determinístico; la
 * interpolación sobre un campo levemente desenfocado da bordes suaves (sin
 * pixelado ni geometría píxel por píxel), y no agrega dependencias con
 * WASM/fetch ni código de terceros en el camino de un archivo del usuario.
 */

/** Lado máximo del campo de trabajo: imágenes más grandes se promedian por bloques (el resultado se re-escala a mm de todos modos). */
const MAX_WORK_DIMENSION = 1600;
const SIGMA_BY_SMOOTHING: Record<PngSmoothing, number> = { low: 0.5, medium: 1.0, high: 2.0 };
/** Área mínima de un contorno (px² del campo de trabajo): max(MIN, fracción de la imagen). Descarta motas y agujeros de un pixel. */
const MIN_CONTOUR_AREA_PX2 = 6;
const MIN_CONTOUR_AREA_FRACTION = 2e-5;

interface Field {
  data: Float32Array;
  w: number;
  h: number;
  iso: number;
  /** Factor de reducción aplicado (1 = tamaño original). */
  factor: number;
  /** Celdas vacías de margen en cada lado (cubren el radio del desenfoque para que todo contorno cierre). */
  pad: number;
}

/** true si el PNG tiene transparencia real (>= 0.1% de píxeles con alpha < 250). */
export function hasRealTransparency(img: RasterImage): boolean {
  const n = img.width * img.height;
  let count = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) count++;
  return count >= Math.max(1, Math.floor(n * 0.001));
}

function buildField(img: RasterImage, opts: PngImportOptions, pad: number): Field {
  const { width, height, data } = img;
  const alphaMode = hasRealTransparency(img);
  const factor = Math.max(1, Math.ceil(Math.max(width, height) / MAX_WORK_DIMENSION));
  const w = Math.ceil(width / factor), h = Math.ceil(height / factor);
  // Campo con borde vacío (>= radio del desenfoque) para que todo contorno cierre.
  const pw = w + 2 * pad, ph = h + 2 * pad;
  const out = new Float32Array(pw * ph);
  const threshold = Math.min(255, Math.max(0, opts.threshold));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dy = 0; dy < factor; dy++) {
        const sy = y * factor + dy;
        if (sy >= height) break;
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx;
          if (sx >= width) break;
          const o = (sy * width + sx) * 4;
          let v: number;
          if (alphaMode) v = data[o + 3] / 255;
          else {
            const a = data[o + 3] / 255;
            // Compuesto sobre blanco; luminosidad -> "cuánto material" (oscuro = material).
            const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
            const l = lum * a + 255 * (1 - a);
            v = opts.invert ? l / 255 : (255 - l) / 255;
          }
          sum += v;
          cnt++;
        }
      }
      out[(y + pad) * pw + (x + pad)] = cnt ? sum / cnt : 0;
    }
  }

  let iso = 0.5;
  if (!alphaMode) iso = opts.invert ? threshold / 255 : (255 - threshold) / 255;
  iso = Math.min(0.98, Math.max(0.02, iso));
  return { data: out, w: pw, h: ph, iso, factor, pad };
}

function gaussianBlur(field: Field, sigma: number): void {
  if (sigma <= 0.05) return;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    total += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;

  const { w, h, data } = field;
  const tmp = new Float32Array(data.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        acc += data[row + xx] * kernel[k + radius];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        acc += tmp[yy * w + x] * kernel[k + radius];
      }
      data[y * w + x] = acc;
    }
  }
}

/** Marching squares con interpolación lineal: lazos cerrados en coordenadas del campo (Y hacia abajo). */
function marchingSquares(field: Field): Point2D[][] {
  const { data, w, h, iso } = field;
  const hCount = w * h;
  // ids: horizontal (x,y)-(x+1,y) = y*w+x ; vertical (x,y)-(x,y+1) = hCount + y*w+x
  const linkA = new Int32Array(hCount * 2).fill(-1);
  const linkB = new Int32Array(hCount * 2).fill(-1);
  const link = (a: number, b: number) => {
    if (linkA[a] < 0) linkA[a] = b;
    else linkB[a] = b;
    if (linkA[b] < 0) linkA[b] = a;
    else linkB[b] = a;
  };

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = data[y * w + x], tr = data[y * w + x + 1], br = data[(y + 1) * w + x + 1], bl = data[(y + 1) * w + x];
      const idx = (tl >= iso ? 8 : 0) | (tr >= iso ? 4 : 0) | (br >= iso ? 2 : 0) | (bl >= iso ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = y * w + x;
      const R = hCount + y * w + x + 1;
      const B = (y + 1) * w + x;
      const L = hCount + y * w + x;
      switch (idx) {
        case 1: case 14: link(L, B); break;
        case 2: case 13: link(B, R); break;
        case 3: case 12: link(L, R); break;
        case 4: case 11: link(T, R); break;
        case 6: case 9: link(T, B); break;
        case 7: case 8: link(L, T); break;
        case 5: {
          const center = (tl + tr + br + bl) / 4 >= iso;
          if (center) { link(L, T); link(B, R); } else { link(T, R); link(L, B); }
          break;
        }
        case 10: {
          const center = (tl + tr + br + bl) / 4 >= iso;
          if (center) { link(T, R); link(L, B); } else { link(L, T); link(B, R); }
          break;
        }
      }
    }
  }

  const pointOf = (id: number): Point2D => {
    if (id < hCount) {
      const y = Math.floor(id / w), x = id % w;
      const a = data[id], b = data[id + 1];
      const t = b === a ? 0.5 : (iso - a) / (b - a);
      return [x + t, y];
    }
    const k = id - hCount;
    const y = Math.floor(k / w), x = k % w;
    const a = data[k], b = data[k + w];
    const t = b === a ? 0.5 : (iso - a) / (b - a);
    return [x, y + t];
  };

  const visited = new Uint8Array(hCount * 2);
  const loops: Point2D[][] = [];
  for (let start = 0; start < hCount * 2; start++) {
    if (linkA[start] < 0 || visited[start]) continue;
    const loop: Point2D[] = [];
    let prev = -1, cur = start;
    let guard = 0;
    while (!visited[cur] && guard++ < hCount * 2) {
      visited[cur] = 1;
      loop.push(pointOf(cur));
      const a = linkA[cur], b = linkB[cur];
      const next = a !== prev && a >= 0 && !visited[a] ? a : b >= 0 && b !== prev && !visited[b] ? b : -1;
      if (next < 0) break;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function polygonArea(p: Point2D[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Douglas-Peucker para un lazo cerrado (iterativo). */
export function simplifyClosed(points: Point2D[], epsilon: number): Point2D[] {
  const n = points.length;
  if (n <= 4 || epsilon <= 0) return points;
  // Ancla: el punto más lejano del primero; parte el lazo en dos cadenas abiertas.
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) {
    const d = (points[i][0] - points[0][0]) ** 2 + (points[i][1] - points[0][1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  const chain = (from: number, to: number) => {
    const stack: [number, number][] = [[from, to]];
    while (stack.length) {
      const [s, e] = stack.pop()!;
      if (e - s < 2) continue;
      const [ax, ay] = points[s % n], [bx, by] = points[e % n];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      let maxD = -1, idx = -1;
      for (let i = s + 1; i < e; i++) {
        const [px, py] = points[i % n];
        const d = len < 1e-12 ? Math.hypot(px - ax, py - ay) : Math.abs((px - ax) * dy - (py - ay) * dx) / len;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > epsilon) {
        keep[idx % n] = 1;
        stack.push([s, idx], [idx, e]);
      }
    }
  };
  chain(0, far);
  chain(far, n);
  const out: Point2D[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out.length >= 3 ? out : points;
}

export interface TraceStats {
  contours: number;
  vertices: number;
  removedTiny: number;
}

/**
 * Etapa 1 PNG: raster -> formas (contornos simplificados) en píxeles de la
 * imagen ORIGINAL, Y hacia abajo. Alpha real tiene prioridad; si no hay
 * transparencia se usa luminosidad con umbral/invertir.
 */
export function traceRaster(img: RasterImage, options: PngImportOptions): RawDesign & { stats: TraceStats } {
  const sigma = SIGMA_BY_SMOOTHING[options.smoothing] ?? SIGMA_BY_SMOOTHING.medium;
  const field = buildField(img, options, Math.ceil(sigma * 3) + 2);
  gaussianBlur(field, sigma);

  const loops = marchingSquares(field);
  const minArea = Math.max(MIN_CONTOUR_AREA_PX2, MIN_CONTOUR_AREA_FRACTION * field.w * field.h);
  const big = loops.filter((l) => Math.abs(polygonArea(l)) >= minArea);
  const removedTiny = loops.length - big.length;
  if (big.length === 0) {
    throw new DesignImportError("TRACE_EMPTY", "No se detectó ninguna forma en la imagen. Probá ajustar el umbral, invertir, o usar un PNG con fondo transparente.");
  }

  // Simplificación: epsilon crece con el suavizado y, si el resultado sigue
  // siendo enorme, se reintenta más agresivo antes de rendirse.
  let epsilon = Math.max(0.4, 0.5 * sigma);
  let simplified: Point2D[][] = [];
  let vertices = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    simplified = big.map((l) => simplifyClosed(l, epsilon));
    vertices = simplified.reduce((s, l) => s + l.length, 0);
    if (vertices <= IMPORT_LIMITS.maxVertices / 2) break;
    epsilon *= 1.7;
  }
  if (vertices > IMPORT_LIMITS.maxVertices) {
    throw new DesignImportError("TOO_COMPLEX", "La imagen es demasiado compleja para vectorizar (demasiados detalles). Usá una imagen más simple o con menos ruido.");
  }

  const f = field.factor;
  // Campo con borde `pad`: (x-pad)*f a coordenadas de la imagen original.
  const shapes = [{ paths: simplified.map((l) => l.map(([x, y]) => [(x - field.pad) * f, (y - field.pad) * f] as Point2D)), fillRule: "evenodd" as const }];
  const warnings: string[] = [];
  if (removedTiny > 0) warnings.push(`Se descartaron ${removedTiny} motas/agujeros diminutos de la imagen.`);
  return { shapes, warnings, pngMode: hasRealTransparency(img) ? "alpha" : "luminosity", stats: { contours: simplified.length, vertices, removedTiny } };
}
