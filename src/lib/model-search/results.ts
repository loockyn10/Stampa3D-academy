import type { ModelSearchResult } from "./types";

function normalizeKey(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Clave de duplicado entre plataformas: mismo título y mismo autor normalizados. Exige ambos para no fusionar
 * modelos distintos con un nombre genérico; sin autor informado nunca se considera duplicado.
 */
export function crossSourceKey(result: ModelSearchResult): string | null {
  if (!result.authorName) return null;
  const title = normalizeKey(result.title);
  const author = normalizeKey(result.authorName);
  return title && author ? `${title}|${author}` : null;
}

/** Quita el mismo modelo republicado en otra plataforma por el mismo autor. Conserva la primera aparición. */
export function dedupeAcrossSources(results: ModelSearchResult[]): ModelSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = crossSourceKey(result);
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Une páginas sin repetir un modelo: ni el mismo `source:externalId` si un provider devuelve resultados solapados,
 * ni el mismo título+autor republicado en otra plataforma. Preserva el orden recibido.
 */
export function mergeUniqueResults(current: ModelSearchResult[], incoming: ModelSearchResult[]): ModelSearchResult[] {
  const seen = new Set(current.map((result) => `${result.source}:${result.externalId}`));
  const seenCross = new Set(current.map(crossSourceKey).filter((key): key is string => key !== null));
  const unique = incoming.filter((result) => {
    const key = `${result.source}:${result.externalId}`;
    if (seen.has(key)) return false;
    const cross = crossSourceKey(result);
    if (cross !== null && seenCross.has(cross)) return false;
    seen.add(key);
    if (cross !== null) seenCross.add(cross);
    return true;
  });
  return [...current, ...unique];
}
