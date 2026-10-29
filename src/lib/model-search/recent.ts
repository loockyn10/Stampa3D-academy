/** Historial reciente de búsquedas (solo en el navegador del usuario, nunca en el servidor). */
export const RECENT_SEARCHES_KEY = "stampa:model-search:recent";
export const MAX_RECENT_SEARCHES = 6;

export function parseRecentSearches(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0 && entry.length <= 100)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

/** Agrega la búsqueda al frente, sin repetir (sin distinguir mayúsculas) y con tope. */
export function addRecentSearch(list: string[], query: string): string[] {
  const clean = query.replace(/\s+/g, " ").trim();
  if (!clean) return list;
  const rest = list.filter((entry) => entry.toLowerCase() !== clean.toLowerCase());
  return [clean, ...rest].slice(0, MAX_RECENT_SEARCHES);
}
