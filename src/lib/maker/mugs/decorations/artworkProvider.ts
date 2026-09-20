import type * as opentype from "opentype.js";
import { prepareRasterArt, prepareSvgArt, prepareTextArt, type Artwork, type ArtworkResult } from "@/lib/maker/mugs/decorations/artwork";
import type { MugDecoration } from "@/lib/maker/mugs/types";
import type { MakerFontId } from "@/lib/maker/types";

/**
 * ASSET de una decoración: el archivo original (SVG como texto, PNG/JPG como bytes). Vive fuera de la
 * `MugDefinition` (que solo guarda `assetId`); en proyectos se sube a Storage privado y al abrir se vuelve a
 * descargar para reconstruir el campo — nunca se guarda el raster/SDF procesado.
 */
export type MugAsset =
  | { id: string; kind: "svg"; fileName: string; content: string }
  | { id: string; kind: "raster"; format: "png" | "jpg"; fileName: string; bytes: Uint8Array };

export type MugFonts = Partial<Record<MakerFontId, opentype.Font>>;

export interface MugArtworkProvider {
  get: (d: MugDecoration) => Artwork | null;
  /** Identifica el CONTENIDO del arte (no la posición/tamaño/profundidad): clave del cache de campos. */
  key: (d: MugDecoration) => string;
  /** Resultado completo (ok / mensaje de error) para mostrarlo en la UI. */
  result: (d: MugDecoration) => ArtworkResult | null;
}

const MAX_CACHE = 64;
const cache = new Map<string, ArtworkResult>();
const fontIds = new WeakMap<opentype.Font, number>();
let nextFontId = 1;

function remember(key: string, compute: () => ArtworkResult): ArtworkResult {
  const hit = cache.get(key);
  if (hit) return hit;
  const value = compute();
  cache.set(key, value);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return value;
}

/** Clave estable del contenido de una decoración (independiente de posición, tamaño, profundidad y bevel). */
export function artworkKey(d: MugDecoration): string {
  const s = d.source;
  if (s.kind === "text") return `text|${s.fontId}|${s.align}|${s.text}`;
  if (s.kind === "svg") return `svg|${s.assetId}`;
  if (s.kind === "raster") return `raster|${s.assetId}|${s.detection}|${s.threshold ?? "auto"}|${s.invert ? 1 : 0}`;
  return "none";
}

/**
 * Proveedor de arte para el motor: prepara (y cachea por contenido) texto / SVG / imagen. Mover, escalar o cambiar
 * la profundidad de una decoración NO vuelve a parsear el SVG ni a decodificar la imagen. Cero DOM / React.
 */
export function createArtworkProvider(assets: ReadonlyMap<string, MugAsset>, fonts: MugFonts): MugArtworkProvider {
  const result = (d: MugDecoration): ArtworkResult | null => {
    const s = d.source;
    if (s.kind === "none") return null;
    if (s.kind === "text") {
      const font = fonts[s.fontId];
      if (!font) return null;
      if (!fontIds.has(font)) fontIds.set(font, nextFontId++);
      return remember(`${artworkKey(d)}|f${fontIds.get(font)}`, () => prepareTextArt(font, s));
    }
    const asset = assets.get(s.assetId);
    if (!asset) return null;
    if (s.kind === "svg") return asset.kind === "svg" ? remember(`${artworkKey(d)}|${asset.content.length}`, () => prepareSvgArt(asset.content)) : null;
    return asset.kind === "raster" ? remember(`${artworkKey(d)}|${asset.bytes.length}`, () => prepareRasterArt(asset.bytes, s)) : null;
  };
  return {
    get: (d) => {
      const r = result(d);
      return r && r.ok ? r.artwork : null;
    },
    key: artworkKey,
    result,
  };
}

export function clearArtworkCache(): void {
  cache.clear();
}
