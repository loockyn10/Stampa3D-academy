import * as opentype from "opentype.js";
import type { MakerFontDefinition, MakerFontId } from "@/lib/maker/types";

// Catálogo inicial de fuentes de Stampa Maker.
// Para agregar una fuente nueva: sumar el archivo .woff en /public/fonts/maker
// y agregar una entrada acá. El resto del pipeline no requiere cambios.
export const MAKER_FONTS: readonly MakerFontDefinition[] = [
  {
    id: "montserrat-regular",
    label: "Montserrat",
    url: "/fonts/maker/Montserrat-Regular.woff",
  },
  {
    id: "montserrat-bold",
    label: "Montserrat Bold",
    url: "/fonts/maker/Montserrat-Bold.woff",
  },
];

export const DEFAULT_MAKER_FONT_ID: MakerFontId = "montserrat-bold";

export function getMakerFontDefinition(fontId: MakerFontId): MakerFontDefinition {
  const def = MAKER_FONTS.find((f) => f.id === fontId);
  if (!def) {
    throw new Error(`Fuente desconocida: ${fontId}`);
  }
  return def;
}

const fontCache = new Map<MakerFontId, Promise<opentype.Font>>();

/** Carga y parsea (con cache) una fuente registrada. Debe correr en el cliente. */
export function loadMakerFont(fontId: MakerFontId): Promise<opentype.Font> {
  const cached = fontCache.get(fontId);
  if (cached) return cached;

  const def = getMakerFontDefinition(fontId);
  const promise = fetch(def.url)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`No se pudo cargar la fuente "${def.label}" (${res.status})`);
      }
      return res.arrayBuffer();
    })
    .then((buffer) => opentype.parse(buffer));

  fontCache.set(fontId, promise);
  return promise;
}
