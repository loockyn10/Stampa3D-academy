import type {
  ModelSearchFilters,
  ModelSearchProvider,
  ModelSearchResponse,
  ModelSearchResult,
  ModelSourceId,
  ModelSearchCursor,
  ProviderSearchPage,
  SourceStatus,
  SourceStatusCode,
} from "./types";
import { ProviderHttpError } from "./types";
import { createTtlCache, type TtlCache } from "./cache";
import { encodeCursor } from "./params";
import { createDefaultProviders } from "./registry";

export const PROVIDER_TIMEOUT_MS = 4500;
export const RESULTS_PER_PROVIDER = 12;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

const sharedCache = createTtlCache<ProviderSearchPage>(CACHE_TTL_MS, CACHE_MAX_ENTRIES);

export interface ModelSearchRequest {
  query: string;
  /** null = todas. */
  sources: ModelSourceId[] | null;
  filters: ModelSearchFilters;
  cursor: ModelSearchCursor;
}

export interface ModelSearchDeps {
  providers?: ModelSearchProvider[];
  cache?: TtlCache<ProviderSearchPage>;
  timeoutMs?: number;
  perProvider?: number;
}

class ProviderTimeoutError extends Error {
  constructor() {
    super("provider_timeout");
    this.name = "ProviderTimeoutError";
  }
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError());
    }, timeoutMs);
  });
  // Promise.race también corta providers que ignoren la señal de aborto.
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

function classifyFailure(error: unknown): SourceStatusCode {
  if (error instanceof ProviderTimeoutError) return "timeout";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "error";
}

function cacheKey(provider: ModelSearchProvider, request: ModelSearchRequest, page: number, perPage: number): string {
  const { filters } = request;
  return [
    provider.id,
    request.query.toLowerCase(),
    filters.sort,
    filters.commercial,
    filters.freeOnly ? "free" : "any",
    page,
    perPage,
  ].join("|");
}

function passesFilters(result: ModelSearchResult, filters: ModelSearchFilters): boolean {
  if (filters.freeOnly && result.isFree !== true) return false;
  if (filters.commercial !== "any" && result.license.commercialUse !== filters.commercial) return false;
  return true;
}

/** Intercala resultados de cada fuente (round-robin) en vez de concatenar bloques por provider. */
export function interleaveResults(lists: ModelSearchResult[][]): ModelSearchResult[] {
  const merged: ModelSearchResult[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      if (index < list.length) merged.push(list[index]);
    }
  }
  return merged;
}

/**
 * Orchestrator: consulta los providers en paralelo con timeout individual, aísla los errores y devuelve resultados
 * parciales con el estado de cada fuente. La UI y (a futuro) Stampy solo hablan con esta función.
 */
export async function searchModels(request: ModelSearchRequest, deps: ModelSearchDeps = {}): Promise<ModelSearchResponse> {
  const providers = deps.providers ?? createDefaultProviders();
  const cache = deps.cache ?? sharedCache;
  const timeoutMs = deps.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const perProvider = deps.perProvider ?? RESULTS_PER_PROVIDER;

  const selected = providers.filter((provider) => !request.sources || request.sources.includes(provider.id));

  const outcomes = await Promise.allSettled(
    selected.map(async (provider): Promise<{ page: number; data: ProviderSearchPage } | "disabled"> => {
      if (!provider.isEnabled()) return "disabled";
      const page = request.cursor[provider.id] ?? 1;
      const perPage = Math.min(perProvider, provider.getCapabilities().maxPerPage);
      const key = cacheKey(provider, request, page, perPage);
      const cached = cache.get(key);
      if (cached) return { page, data: cached };
      const data = await withTimeout(
        (signal) => provider.search({ query: request.query, filters: request.filters, page, perPage, signal }),
        timeoutMs,
      );
      cache.set(key, data);
      return { page, data };
    }),
  );

  const sources: SourceStatus[] = [];
  const lists: ModelSearchResult[][] = [];
  const nextCursor: ModelSearchCursor = {};

  outcomes.forEach((outcome, index) => {
    const id = selected[index].id;
    if (outcome.status === "rejected") {
      console.warn("[model-search] provider failed", {
        provider: id,
        reason: classifyFailure(outcome.reason),
        httpStatus: outcome.reason instanceof ProviderHttpError ? outcome.reason.status : undefined,
      });
      sources.push({ id, status: classifyFailure(outcome.reason), count: 0, hasMore: false });
      return;
    }
    if (outcome.value === "disabled") {
      sources.push({ id, status: "disabled", count: 0, hasMore: false });
      return;
    }
    const { page, data } = outcome.value;
    const results = data.results.filter((result) => passesFilters(result, request.filters));
    lists.push(results);
    if (data.hasMore) nextCursor[id] = page + 1;
    sources.push({ id, status: "ok", count: results.length, hasMore: data.hasMore });
  });

  return { results: interleaveResults(lists), sources, nextCursor: encodeCursor(nextCursor) };
}

/** Providers habilitados y sus capacidades, para que la UI no ofrezca filtros u opciones que no existen. */
export function describeProviders(providers: ModelSearchProvider[] = createDefaultProviders()) {
  return providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    enabled: provider.isEnabled(),
    sorts: provider.getCapabilities().sorts,
  }));
}
