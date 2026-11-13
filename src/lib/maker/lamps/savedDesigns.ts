/**
 * Diseños de lámpara guardados en ESTE navegador (`localStorage`): nombre + código del diseño (`SL1:`, el mismo texto que ya se copia y se pega).
 * No hay base de datos ni migration (la tabla de proyectos de Maker no admite lámparas): lo que se guarda es exactamente lo que `encodeLampDesign`
 * produce y lo que `decodeLampDesign` lee, así que un diseño guardado con una versión anterior del motor se abre con la misma tolerancia que un código pegado.
 * Funciones puras (sin DOM) para poder probarlas.
 */

export interface SavedLampDesign {
  id: string;
  name: string;
  code: string;
  savedAt: number;
}

export const SAVED_LAMPS_KEY = "stampa-maker:lamps:saved:v1";
export const MAX_SAVED_LAMPS = 30;
export const DEFAULT_LAMP_NAME = "Mi lámpara";
const MAX_NAME = 60;

export function cleanLampName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return trimmed || DEFAULT_LAMP_NAME;
}

/** Lee la lista guardada tolerando datos corruptos o de otra versión: lo que no tiene la forma esperada se descarta. */
export function parseSavedLampDesigns(raw: string | null): SavedLampDesign[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is SavedLampDesign => !!x && typeof x === "object" && typeof (x as SavedLampDesign).id === "string" && typeof (x as SavedLampDesign).name === "string" && typeof (x as SavedLampDesign).code === "string" && typeof (x as SavedLampDesign).savedAt === "number")
      .slice(0, MAX_SAVED_LAMPS);
  } catch {
    return [];
  }
}

/** Guarda (o reemplaza, si `id` existe) un diseño; el más reciente queda primero y la lista no pasa de `MAX_SAVED_LAMPS`. */
export function upsertSavedLampDesign(list: readonly SavedLampDesign[], entry: { id: string; name: string; code: string; now: number }): SavedLampDesign[] {
  const item: SavedLampDesign = { id: entry.id, name: cleanLampName(entry.name), code: entry.code, savedAt: entry.now };
  return [item, ...list.filter((x) => x.id !== entry.id)].slice(0, MAX_SAVED_LAMPS);
}

export function removeSavedLampDesign(list: readonly SavedLampDesign[], id: string): SavedLampDesign[] {
  return list.filter((x) => x.id !== id);
}

export function newSavedLampId(now: number, random: number = Math.random()): string {
  return `lamp-${now.toString(36)}-${Math.floor(random * 1e6).toString(36)}`;
}
