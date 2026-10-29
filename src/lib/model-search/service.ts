import type {
  CursorKey,
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
import { dedupeAcrossSources } from "./results";
import { createDefaultProviders } from "./registry";
import { createRateLimiter, type RateLimiter } from "./rate-limit";
import { expandQuery as expandQueryWithLexicon, MAX_QUERY_VARIANTS, normalizeForCompare, titleMatchesQuery } from "./query-variants";
import { MAX_QUERY_LENGTH } from "./sources";

export const PROVIDER_TIMEOUT_MS = 4500;
export const RESULTS_PER_PROVIDER = 12;
/** Cuando todas las consultas originales ya respondieron, una variante lenta tiene este margen más y se descarta. */
export const VARIANT_GRACE_MS = 3000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

const sharedCache = createTtlCache<ProviderSearchPage>(CACHE_TTL_MS, CACHE_MAX_ENTRIES);
const sharedVariantLimiters = new Map<string, RateLimiter>();

export interface ModelSearchRequest {
  query: string;
  /** null = todas. */
  sources: ModelSourceId[] | null;
  filters: ModelSearchFilters;
  cursor: ModelSearchCursor;
  /** Cancelación del llamador (p. ej. el navegador cerró la request): aborta también los pedidos a las fuentes. */
  signal?: AbortSignal;
}

export interface ModelSearchDeps {
  providers?: ModelSearchProvider[];
  cache?: TtlCache<ProviderSearchPage>;
  timeoutMs?: number;
  perProvider?: number;
  /**
   * Interpretación de la consulta (variantes en otro idioma). Por defecto, el léxico determinista de
   * `query-variants.ts`. Es el punto de enganche para una interpretación con IA (ver docs/ARCHITECTURE.md §18.4):
   * debe ser estable para una misma consulta, porque las páginas siguientes la vuelven a calcular.
   */
  expandQuery?: (query: string, max: number) => string[] | Promise<string[]>;
  variantGraceMs?: number;
  /** Presupuesto de consultas de variante por provider (aislable en tests). */
  variantLimiters?: Map<string, RateLimiter>;
}

class ProviderTimeoutError extends Error {
  constructor() {
    super("provider_timeout");
    this.name = "ProviderTimeoutError";
  }
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, outer?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onOuterAbort: (() => void) | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError());
    }, timeoutMs);
    // El corte externo (cancelación o fin del margen de variantes) también rechaza aunque el provider ignore la señal.
    onOuterAbort = () => {
      controller.abort();
      reject(new ProviderTimeoutError());
    };
    if (outer?.aborted) onOuterAbort();
    else outer?.addEventListener("abort", onOuterAbort, { once: true });
  });
  // Promise.race también corta providers que ignoren la señal de aborto.
  return Promise.race([run(controller.signal), guard]).finally(() => {
    clearTimeout(timer);
    if (onOuterAbort) outer?.removeEventListener("abort", onOuterAbort);
  });
}

function classifyFailure(error: unknown): SourceStatusCode {
  if (error instanceof ProviderTimeoutError) return "timeout";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (error instanceof ProviderHttpError && error.status === 429) return "rate_limited";
  return "error";
}

function cacheKey(provider: ModelSearchProvider, query: string, filters: ModelSearchFilters, page: number, perPage: number): string {
  return [
    provider.id,
    query.toLowerCase(),
    filters.sort,
    filters.commercial,
    filters.price,
    page,
    perPage,
  ].join("|");
}

/**
 * Los filtros los aplica siempre la fuente (server-side). Si un provider no puede filtrar de forma confiable, no se le
 * pide ni se filtra su página después: se declara en `getCapabilities()` y ese provider queda fuera de la consulta.
 */
export function providerSupportsFilters(provider: ModelSearchProvider, filters: ModelSearchFilters): boolean {
  const capabilities = provider.getCapabilities();
  if (filters.price !== "any" && !capabilities.supportsPriceFilter) return false;
  if (filters.commercial !== "any" && !capabilities.commercialFilters.includes(filters.commercial)) return false;
  return true;
}

function applyReliablePriceFilter(data: ProviderSearchPage, filters: ModelSearchFilters): ProviderSearchPage {
  if (filters.price === "any") return data;
  return { ...data, results: data.results.filter((result) => result.priceType === filters.price) };
}

/** true si al menos un provider habilitado y seleccionado puede atender los filtros pedidos. */
export function hasProviderForFilters(
  providers: ModelSearchProvider[],
  sources: ModelSourceId[] | null,
  filters: ModelSearchFilters,
): boolean {
  return providers.some(
    (provider) => (!sources || sources.includes(provider.id)) && provider.isEnabled() && providerSupportsFilters(provider, filters),
  );
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
 * Une, para UNA fuente, los resultados de la consulta original con los de sus variantes. La original manda: se
 * intercalan 2 de la original por 1 de cada variante, y los resultados de una variante cuyo título no menciona nada
 * de su consulta (traducción ambigua) van al final en vez de desplazar a los relevantes. Nada se descarta salvo
 * repetidos (misma fuente e id), así que una página nunca "pierde" modelos que la fuente ya entregó.
 */
export function mergeProviderResults(
  original: ModelSearchResult[],
  variants: { query: string; results: ModelSearchResult[] }[],
): ModelSearchResult[] {
  const seen = new Set<string>();
  const merged: ModelSearchResult[] = [];
  const push = (result: ModelSearchResult): boolean => {
    const key = `${result.source}:${result.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    merged.push(result);
    return true;
  };

  const relevant = variants.map((variant) => variant.results.filter((result) => titleMatchesQuery(result.title, variant.query)));
  const demoted = variants.flatMap((variant) => variant.results.filter((result) => !titleMatchesQuery(result.title, variant.query)));
  const queues = [original, ...relevant];
  const weights = [2, ...relevant.map(() => 1)];
  const positions = queues.map(() => 0);

  let remaining = true;
  while (remaining) {
    remaining = false;
    queues.forEach((queue, index) => {
      let taken = 0;
      while (taken < weights[index] && positions[index] < queue.length) {
        if (push(queue[positions[index]++])) taken += 1;
      }
      if (positions[index] < queue.length) remaining = true;
    });
  }
  demoted.forEach(push);
  return merged;
}

/** Variantes confiables: sin repetir la consulta original ni entre sí, acotadas en cantidad y largo. */
function cleanVariants(original: string, candidates: string[]): string[] {
  const seen = new Set([normalizeForCompare(original)]);
  const variants: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const clean = candidate.replace(/\s+/g, " ").trim();
    const key = normalizeForCompare(clean);
    if (!key || clean.length > MAX_QUERY_LENGTH || seen.has(key)) continue;
    seen.add(key);
    variants.push(clean);
    if (variants.length >= MAX_QUERY_VARIANTS) break;
  }
  return variants;
}

/** Las variantes gastan un presupuesto aparte por provider para no agotar la cuota de la consulta original. */
function allowVariantRequest(provider: ModelSearchProvider, limiters: Map<string, RateLimiter>): boolean {
  const perMinute = provider.getCapabilities().variantsPerMinute;
  if (perMinute === undefined) return true;
  if (perMinute <= 0) return false;
  let limiter = limiters.get(provider.id);
  if (!limiter) {
    limiter = createRateLimiter({ windowMs: 60_000, max: perMinute });
    limiters.set(provider.id, limiter);
  }
  return limiter.check(provider.id).allowed;
}

interface SlotPlan {
  key: CursorKey;
  /** 0 = consulta original; 1.. = variantes. */
  slot: number;
  query: string;
  perPage: number;
}

type SlotResult =
  | { kind: "ok"; page: number; data: ProviderSearchPage }
  | { kind: "failed"; error: unknown }
  /** `next`: valor del cursor a conservar (null = agotada, undefined = nunca corrió). */
  | { kind: "skipped"; next: number | null | undefined };

function planSlots(provider: ModelSearchProvider, query: string, variants: string[], perProvider: number): SlotPlan[] {
  const capabilities = provider.getCapabilities();
  const perPage = Math.min(perProvider, capabilities.maxPerPage);
  const variantLimit = Math.min(MAX_QUERY_VARIANTS, Math.max(0, capabilities.maxQueryVariants ?? 0));
  // Las variantes piden páginas más chicas: amplían la lista sin duplicar su tamaño.
  const variantPerPage = Math.max(1, Math.min(Math.ceil(perProvider / 2), capabilities.maxPerPage));
  const plans: SlotPlan[] = [{ key: provider.id, slot: 0, query, perPage }];
  variants.slice(0, variantLimit).forEach((variant, index) => {
    plans.push({ key: `${provider.id}~${index + 1}` as CursorKey, slot: index + 1, query: variant, perPage: variantPerPage });
  });
  return plans;
}

/**
 * Orchestrator: consulta los providers en paralelo con timeout individual, aísla los errores y devuelve resultados
 * parciales con el estado de cada fuente. La UI y (a futuro) Stampy solo hablan con esta función.
 *
 * Búsqueda ampliada: además de la consulta original, cada provider recibe como máximo `maxQueryVariants` variantes en
 * el otro idioma. Cada consulta pagina por separado (cursor `cults`, `cults~1`…), la original conserva prioridad y un
 * fallo o lentitud de una variante nunca convierte a la fuente en "con error" ni retrasa a la original.
 */
export async function searchModels(request: ModelSearchRequest, deps: ModelSearchDeps = {}): Promise<ModelSearchResponse> {
  const providers = deps.providers ?? createDefaultProviders();
  const cache = deps.cache ?? sharedCache;
  const timeoutMs = deps.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const perProvider = deps.perProvider ?? RESULTS_PER_PROVIDER;
  const graceMs = deps.variantGraceMs ?? VARIANT_GRACE_MS;
  const variantLimiters = deps.variantLimiters ?? sharedVariantLimiters;

  const selected = providers.filter((provider) => !request.sources || request.sources.includes(provider.id));

  let variants: string[] = [];
  try {
    variants = cleanVariants(request.query, await (deps.expandQuery ?? expandQueryWithLexicon)(request.query, MAX_QUERY_VARIANTS));
  } catch {
    // La ampliación es opcional: si falla, se busca solo con la consulta original.
  }

  // Corte de las variantes: cancelación del llamador o fin del margen de gracia.
  const variantGate = new AbortController();
  const onCancel = () => variantGate.abort();
  if (request.signal?.aborted) variantGate.abort();
  else request.signal?.addEventListener("abort", onCancel, { once: true });

  const runSlot = async (provider: ModelSearchProvider, plan: SlotPlan): Promise<SlotResult> => {
    const cursorValue = request.cursor[plan.key];
    if (cursorValue === null) return { kind: "skipped", next: null };
    const page = cursorValue ?? 1;
    const key = cacheKey(provider, plan.query, request.filters, page, plan.perPage);
    const cached = cache.get(key);
    if (cached) return { kind: "ok", page, data: cached };
    if (plan.slot > 0 && !allowVariantRequest(provider, variantLimiters)) return { kind: "skipped", next: cursorValue };
    try {
      const providerData = await withTimeout(
        (signal) => provider.search({ query: plan.query, filters: request.filters, page, perPage: plan.perPage, signal }),
        timeoutMs,
        plan.slot === 0 ? request.signal : variantGate.signal,
      );
      const data = applyReliablePriceFilter(providerData, request.filters);
      cache.set(key, data);
      return { kind: "ok", page, data };
    } catch (error) {
      return { kind: "failed", error };
    }
  };

  type ProviderRun =
    | { early: "disabled" | "unsupported" | "exhausted" }
    | { early?: undefined; plans: SlotPlan[]; pending: Promise<SlotResult>[] };

  const runs: ProviderRun[] = selected.map((provider) => {
    if (!provider.isEnabled()) return { early: "disabled" };
    if (!providerSupportsFilters(provider, request.filters)) return { early: "unsupported" };
    const plans = planSlots(provider, request.query, variants, perProvider);
    if (plans.every((plan) => request.cursor[plan.key] === null)) return { early: "exhausted" };
    return { plans, pending: plans.map((plan) => runSlot(provider, plan)) };
  });

  let finished = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const originals = runs.flatMap((run) => (run.early ? [] : [run.pending[0]]));
  void Promise.allSettled(originals).then(() => {
    if (!finished) graceTimer = setTimeout(() => variantGate.abort(), graceMs);
  });

  let settled: ({ early: "disabled" | "unsupported" | "exhausted" } | { plans: SlotPlan[]; slots: SlotResult[] })[];
  try {
    settled = await Promise.all(
      runs.map(async (run) => (run.early ? { early: run.early } : { plans: run.plans, slots: await Promise.all(run.pending) })),
    );
  } finally {
    finished = true;
    clearTimeout(graceTimer);
    request.signal?.removeEventListener("abort", onCancel);
  }

  const sources: SourceStatus[] = [];
  const lists: ModelSearchResult[][] = [];
  const usedVariants = new Map<number, string>();
  const nextCursor: ModelSearchCursor = {};

  settled.forEach((run, index) => {
    const id = selected[index].id;
    if ("early" in run && run.early) {
      sources.push({ id, status: run.early === "exhausted" ? "ok" : run.early, count: 0, hasMore: false });
      return;
    }
    const { plans, slots } = run as { plans: SlotPlan[]; slots: SlotResult[] };

    const providerCursor: ModelSearchCursor = {};
    const okVariants: { query: string; results: ModelSearchResult[] }[] = [];
    let original: ModelSearchResult[] = [];
    const failures: { slot: number; error: unknown }[] = [];
    let anyOk = false;

    for (const [slotIndex, slot] of slots.entries()) {
      const plan = plans[slotIndex];
      if (slot.kind === "ok") {
        anyOk = true;
        providerCursor[plan.key] = slot.data.hasMore ? slot.page + 1 : null;
        if (plan.slot === 0) original = slot.data.results;
        else {
          okVariants.push({ query: plan.query, results: slot.data.results });
          usedVariants.set(plan.slot, plan.query);
        }
      } else if (slot.kind === "skipped") {
        if (slot.next !== undefined) providerCursor[plan.key] = slot.next;
      } else {
        failures.push({ slot: plan.slot, error: slot.error });
      }
    }

    // Un solo aviso por fuente cuando falló del todo; si respondió, se registra cada variante caída.
    for (const failure of anyOk ? failures : failures.slice(0, 1)) {
      console.warn("[model-search] provider failed", {
        provider: id,
        variant: failure.slot > 0,
        reason: classifyFailure(failure.error),
        httpStatus: failure.error instanceof ProviderHttpError ? failure.error.status : undefined,
      });
    }

    // La fuente falla solo si ninguna de sus consultas respondió (una variante caída o lenta no la marca con error).
    if (!anyOk && failures.length > 0) {
      sources.push({ id, status: classifyFailure(failures[0].error), count: 0, hasMore: false });
      return;
    }

    Object.assign(nextCursor, providerCursor);
    const results = mergeProviderResults(original, okVariants);
    lists.push(results);
    sources.push({ id, status: "ok", count: results.length, hasMore: Object.values(providerCursor).some((page) => typeof page === "number") });
  });

  return {
    results: dedupeAcrossSources(interleaveResults(lists)),
    sources,
    nextCursor: encodeCursor(nextCursor),
    queryVariants: Array.from(usedVariants.entries()).sort((a, b) => a[0] - b[0]).map(([, query]) => query),
  };
}

/** Providers habilitados y sus capacidades, para que la UI no ofrezca filtros u opciones que no existen. */
export function describeProviders(providers: ModelSearchProvider[] = createDefaultProviders()) {
  return providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    enabled: provider.isEnabled(),
    ...provider.getCapabilities(),
  }));
}
