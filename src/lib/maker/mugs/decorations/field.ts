import { distanceTransform, resampleField } from "@/lib/maker/neon/raster/imageProcessing";
import type { Artwork, VectorArt } from "@/lib/maker/mugs/decorations/artwork";

/**
 * DecorationField: representación 2D COMÚN de texto, SVG y PNG/JPG. Un campo de distancia con signo (mm, positivo
 * DENTRO de la silueta) sobre una grilla centrada en el origen local de la decoración (x a la derecha, y arriba).
 * Un único motor de relieve/grabado evalúa cualquier fuente con \`sampleSd\`.
 *
 * Determinístico: misma entrada + misma resolución = mismo campo. Distancia euclídea exacta (Felzenszwalb) reutilizada
 * de Neon raster, con precisión de medio píxel en el borde.
 */
export interface DecorationField {
  data: Float32Array;
  nx: number;
  ny: number;
  /** mm por píxel. */
  px: number;
  py: number;
  halfW: number;
  halfH: number;
}

const PAD = 2;

/** Rasteriza polígonos con regla de relleno (scanline, cruces ponderados). `map` lleva coordenadas fuente -> píxel. */
function fillVector(art: VectorArt, nx: number, ny: number, mapX: (x: number) => number, mapY: (y: number) => number): Uint8Array {
  const mask = new Uint8Array(nx * ny);
  for (const shape of art.shapes) {
    const edges: { x0: number; y0: number; x1: number; y1: number; dir: number }[] = [];
    for (const path of shape.paths) {
      for (let i = 0; i < path.length; i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        const x0 = mapX(a[0]), y0 = mapY(a[1]), x1 = mapX(b[0]), y1 = mapY(b[1]);
        if (y0 === y1) continue;
        edges.push(y0 < y1 ? { x0, y0, x1, y1, dir: 1 } : { x0: x1, y0: y1, x1: x0, y1: y0, dir: -1 });
      }
    }
    for (let j = 0; j < ny; j++) {
      const yc = j + 0.5;
      const hits: { x: number; dir: number }[] = [];
      for (const e of edges) if (yc >= e.y0 && yc < e.y1) hits.push({ x: e.x0 + ((yc - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), dir: e.dir });
      if (hits.length < 2) continue;
      hits.sort((p, q) => p.x - q.x);
      let winding = 0;
      for (let k = 0; k < hits.length - 1; k++) {
        winding += hits[k].dir;
        const inside = shape.fillRule === "evenodd" ? (k + 1) % 2 === 1 : winding !== 0;
        if (!inside) continue;
        const i0 = Math.max(0, Math.ceil(hits[k].x - 0.5)), i1 = Math.min(nx - 1, Math.ceil(hits[k + 1].x - 0.5) - 1);
        for (let i = i0; i <= i1; i++) mask[j * nx + i] = 1;
      }
    }
  }
  return mask;
}

/** Máscara binaria (1 = dentro) del arte en una grilla `nx × ny` que cubre exactamente su caja de contenido. */
export function rasterizeArtwork(art: Artwork, nx: number, ny: number): Uint8Array {
  if (art.kind === "mask") {
    if (art.width === nx && art.height === ny) return art.mask;
    // Remuestreo del campo 0/255 (promedio de área al reducir) y umbral a 0.5.
    const scaled = resampleField(Uint8Array.from(art.mask, (v) => (v ? 255 : 0)), art.width, art.height, nx, ny);
    return Uint8Array.from(scaled, (v) => (v >= 128 ? 1 : 0));
  }
  const w = art.maxX - art.minX, h = art.maxY - art.minY;
  return fillVector(art, nx, ny, (x) => ((x - art.minX) / w) * nx, (y) => (art.yDown ? ((y - art.minY) / h) * ny : ((art.maxY - y) / h) * ny));
}

/** Campo de distancia con signo (mm) a partir de una máscara `nx × ny` que ocupa `widthMm × heightMm`. */
export function fieldFromMask(mask: Uint8Array, nx: number, ny: number, widthMm: number, heightMm: number): DecorationField {
  const W = nx + 2 * PAD, H = ny + 2 * PAD;
  const padded = new Uint8Array(W * H);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) padded[(j + PAD) * W + i + PAD] = mask[j * nx + i];
  const inv = padded.map((v) => (v ? 0 : 1));
  const dIn = distanceTransform(padded, W, H);
  const dOut = distanceTransform(inv, W, H);
  const px = widthMm / nx, py = heightMm / ny;
  const unit = (px + py) / 2; // distancia isotrópica (aproximación si se desbloquea la proporción)
  const data = new Float32Array(W * H);
  for (let k = 0; k < data.length; k++) data[k] = (padded[k] ? dIn[k] - 0.5 : -(dOut[k] - 0.5)) * unit;
  return { data, nx: W, ny: H, px, py, halfW: (W * px) / 2, halfH: (H * py) / 2 };
}

const cache = new Map<string, DecorationField>();
const CACHE_LIMIT = 32;

/**
 * Campo del arte al tamaño pedido, con resolución `resolutionMm` (mm por píxel). La grilla se acota a 8..768 px por
 * lado: el costo depende del detalle y no del tamaño absoluto. Cacheado por `key` + grilla + medidas.
 */
export function getDecorationField(key: string, art: Artwork, widthMm: number, heightMm: number, resolutionMm: number): DecorationField {
  const nx = Math.min(768, Math.max(8, Math.ceil(widthMm / resolutionMm)));
  const ny = Math.min(768, Math.max(8, Math.ceil(heightMm / resolutionMm)));
  const ck = `${key}|${nx}x${ny}|${widthMm.toFixed(3)}x${heightMm.toFixed(3)}`;
  const hit = cache.get(ck);
  if (hit) {
    cache.delete(ck);
    cache.set(ck, hit);
    return hit;
  }
  const field = fieldFromMask(rasterizeArtwork(art, nx, ny), nx, ny, widthMm, heightMm);
  cache.set(ck, field);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return field;
}

export function clearDecorationFieldCache(): void {
  cache.clear();
}

/** Distancia con signo (mm, + dentro) en (x, y) locales, con interpolación bilineal. Fuera de la grilla = fondo. */
export function sampleSd(f: DecorationField, x: number, y: number): number {
  const gx = (x + f.halfW) / f.px - 0.5, gy = (f.halfH - y) / f.py - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const tx = gx - x0, ty = gy - y0;
  const at = (i: number, j: number) => f.data[Math.min(f.ny - 1, Math.max(0, j)) * f.nx + Math.min(f.nx - 1, Math.max(0, i))];
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}
