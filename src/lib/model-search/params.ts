import type { CommercialFilter, ModelSearchCursor, ModelSearchFilters, ModelSort, ModelSourceId } from "./types";
import { isModelSourceId, MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, MODEL_SOURCE_IDS } from "./sources";
import { CONTROL_CHARS } from "./sanitize";

export { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH };
export const MAX_PAGE = 20;

export type ModelSearchParamError =
  | "missing_query"
  | "query_too_short"
  | "query_too_long"
  | "invalid_source"
  | "invalid_filter"
  | "invalid_cursor";

export interface ParsedModelSearchParams {
  query: string;
  /** null = todas las fuentes habilitadas. */
  sources: ModelSourceId[] | null;
  filters: ModelSearchFilters;
  cursor: ModelSearchCursor;
}

export type ParseResult =
  | { ok: true; value: ParsedModelSearchParams }
  | { ok: false; error: ModelSearchParamError };

const SORTS: readonly ModelSort[] = ["relevance", "popular", "newest"];
const COMMERCIAL: readonly CommercialFilter[] = ["any", "allowed", "prohibited", "unknown"];

export function normalizeQuery(raw: string): string {
  return raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

export function encodeCursor(cursor: ModelSearchCursor): string | null {
  const entries = Object.entries(cursor).filter(([, page]) => typeof page === "number");
  if (!entries.length) return null;
  return Buffer.from(JSON.stringify(Object.fromEntries(entries)), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null): ModelSearchCursor | null {
  if (!raw) return {};
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const cursor: ModelSearchCursor = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!isModelSourceId(key)) return null;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_PAGE) return null;
      cursor[key] = value;
    }
    return cursor;
  } catch {
    return null;
  }
}

function parseBoolean(raw: string | null): boolean | null {
  if (raw === null || raw === "" || raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  return null;
}

/** Valida y normaliza los parámetros de `GET /api/model-search`. No acepta URLs ni providers arbitrarios. */
export function parseModelSearchParams(searchParams: URLSearchParams): ParseResult {
  const rawQuery = searchParams.get("q");
  if (rawQuery === null) return { ok: false, error: "missing_query" };
  const query = normalizeQuery(rawQuery);
  if (!query) return { ok: false, error: "missing_query" };
  if (query.length < MIN_QUERY_LENGTH) return { ok: false, error: "query_too_short" };
  if (query.length > MAX_QUERY_LENGTH) return { ok: false, error: "query_too_long" };

  let sources: ModelSourceId[] | null = null;
  const rawSources = searchParams.get("sources");
  if (rawSources && rawSources !== "all") {
    const parts = Array.from(new Set(rawSources.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)));
    if (!parts.length || parts.length > MODEL_SOURCE_IDS.length || !parts.every(isModelSourceId)) {
      return { ok: false, error: "invalid_source" };
    }
    sources = parts as ModelSourceId[];
  }

  const freeOnly = parseBoolean(searchParams.get("free"));
  if (freeOnly === null) return { ok: false, error: "invalid_filter" };

  const commercial = (searchParams.get("commercial") ?? "any") as CommercialFilter;
  if (!COMMERCIAL.includes(commercial)) return { ok: false, error: "invalid_filter" };

  const sort = (searchParams.get("sort") ?? "relevance") as ModelSort;
  if (!SORTS.includes(sort)) return { ok: false, error: "invalid_filter" };

  const cursor = decodeCursor(searchParams.get("cursor"));
  if (cursor === null) return { ok: false, error: "invalid_cursor" };

  return { ok: true, value: { query, sources, filters: { freeOnly, commercial, sort }, cursor } };
}

/** Profundidad de la paginación pedida (página más alta entre providers). */
export function cursorDepth(cursor: ModelSearchCursor): number {
  return Math.max(1, ...Object.values(cursor).filter((page): page is number => typeof page === "number"));
}
