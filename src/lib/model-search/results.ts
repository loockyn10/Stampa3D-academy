import type { ModelSearchResult } from "./types";

/** Une páginas sin repetir un modelo si un provider devuelve resultados solapados. Preserva el orden recibido. */
export function mergeUniqueResults(current: ModelSearchResult[], incoming: ModelSearchResult[]): ModelSearchResult[] {
  const seen = new Set(current.map((result) => `${result.source}:${result.externalId}`));
  const unique = incoming.filter((result) => {
    const key = `${result.source}:${result.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...current, ...unique];
}
