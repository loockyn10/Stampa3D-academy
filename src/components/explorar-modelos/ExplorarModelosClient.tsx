"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, History, Languages, Loader2, Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, MODEL_SOURCE_LABELS } from "@/lib/model-search/sources";
import { mergeUniqueResults } from "@/lib/model-search/results";
import { addRecentSearch, parseRecentSearches, RECENT_SEARCHES_KEY } from "@/lib/model-search/recent";
import type {
  CommercialFilter,
  ModelSearchResult,
  ModelSort,
  ModelSourceId,
  PriceFilter,
  SourceStatus,
  SourceStatusCode,
} from "@/lib/model-search/types";
import { ModelResultCard } from "./ModelResultCard";
import { FilterChipGroups, FilterDropdowns, type FilterGroup } from "./ModelSearchFilterBar";
import { FeatureLink } from "@/components/features/feature-link";
import { useFeatureVisibility } from "@/components/features/feature-flags-provider";

export interface ProviderInfo {
  id: ModelSourceId;
  label: string;
  enabled: boolean;
  sorts: readonly ModelSort[];
  supportsPriceFilter: boolean;
  reportsPrice: boolean;
  priceFilterMode: "native" | "post" | "none";
  commercialFilters: readonly Exclude<CommercialFilter, "any">[];
}

type Tier = "anonymous" | "free" | "paid";
type Phase = "idle" | "loading" | "loadingMore" | "done" | "error";

interface ApiResponse {
  results: ModelSearchResult[];
  sources: SourceStatus[];
  nextCursor: string | null;
  /** Variantes en otro idioma que se consultaron (ausente en respuestas de versiones anteriores). */
  queryVariants?: string[];
  viewer: { tier: Tier; maxPages: number; gated: boolean };
}

const SORT_LABELS: Record<ModelSort, string> = { relevance: "Relevancia", popular: "Populares", newest: "Recientes" };
const COMMERCIAL_OPTIONS: { value: CommercialFilter; label: string }[] = [
  { value: "any", label: "Todos" },
  { value: "allowed", label: "Permitido" },
  { value: "prohibited", label: "No permitido" },
  { value: "unknown", label: "Desconocido" },
];
const PRICE_OPTIONS: { value: PriceFilter; label: string }[] = [
  { value: "any", label: "Todos" },
  { value: "free", label: "Gratis" },
  { value: "paid", label: "De pago" },
];

/** Búsquedas recientes visibles sin expandir: el historial no debe dominar la pantalla. */
const RECENT_COLLAPSED = 3;

const API_ERRORS: Record<string, string> = {
  query_too_short: `Escribí al menos ${MIN_QUERY_LENGTH} caracteres.`,
  query_too_long: `La búsqueda no puede superar ${MAX_QUERY_LENGTH} caracteres.`,
  rate_limited: "Hiciste muchas búsquedas seguidas. Esperá unos segundos y probá de nuevo.",
  account_required: "Creá tu cuenta gratis para usar esta opción.",
  unsupported_filter: "Esa combinación de filtros no está disponible para la fuente elegida.",
  search_unavailable: "No pudimos completar la búsqueda. Probá de nuevo en un momento.",
};

/** Qué le decimos al usuario por cada estado de una fuente (sin detalles técnicos). */
const SOURCE_PROBLEM_TEXT: Partial<Record<SourceStatusCode, string>> = {
  timeout: "no respondió a tiempo",
  error: "tuvo un problema",
  rate_limited: "alcanzó su límite de consultas (probá en un minuto)",
};

const recentListeners = new Set<() => void>();
const readRecentRaw = () => {
  try {
    return window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]";
  } catch {
    return "[]";
  }
};
const writeRecent = (list: string[]) => {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // Almacenamiento bloqueado (modo privado, etc.): el historial es solo una comodidad.
  }
  recentListeners.forEach((listener) => listener());
};
const subscribeRecent = (listener: () => void) => {
  recentListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    recentListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

function supportsCommercial(provider: ProviderInfo, value: CommercialFilter): boolean {
  return value !== "any" && provider.commercialFilters.includes(value);
}

function ResultSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface" aria-hidden="true">
      <div className="aspect-[4/3] animate-pulse bg-fg/5" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-4/5 animate-pulse rounded bg-fg/10" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-fg/5" />
        <div className="h-9 animate-pulse rounded-xl bg-fg/5" />
      </div>
    </div>
  );
}

export function ExplorarModelosClient({ providers }: { providers: ProviderInfo[] }) {
  const calculatorVisible = useFeatureVisibility().isFeatureVisible("calculadora");
  const enabledProviders = useMemo(() => providers.filter((provider) => provider.enabled), [providers]);
  const [tier, setTier] = useState<Tier | null>(null);
  const [input, setInput] = useState("");
  const [source, setSource] = useState<ModelSourceId | "all">("all");
  const [price, setPrice] = useState<PriceFilter>("any");
  const [commercial, setCommercial] = useState<CommercialFilter>("any");
  const [sort, setSort] = useState<ModelSort>("relevance");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<ModelSearchResult[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [queryVariants, setQueryVariants] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [gated, setGated] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [upsell, setUpsell] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const recentRaw = useSyncExternalStore(subscribeRecent, readRecentRaw, () => "[]");
  const recent = useMemo(() => parseRecentSearches(recentRaw), [recentRaw]);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    getCurrentUserAccess(createClient()).then(({ access }) => {
      if (!active) return;
      setTier(access.capabilities.accessPlatform ? "paid" : access.authenticated ? "free" : "anonymous");
    });
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, []);

  const isMember = tier === "free" || tier === "paid";
  const selectedProviders = useMemo(
    () => (source === "all" ? enabledProviders : enabledProviders.filter((provider) => provider.id === source)),
    [enabledProviders, source],
  );
  // Gratis/De pago consulta solo providers con metadata confiable; resultados `unknown` quedan afuera.
  const priceEnabled = selectedProviders.some((provider) => provider.supportsPriceFilter);
  const commercialOffered = COMMERCIAL_OPTIONS.filter(
    (option) => option.value !== "any" && enabledProviders.some((provider) => supportsCommercial(provider, option.value)),
  );
  const commercialEnabled = (value: CommercialFilter) =>
    value === "any" || (selectedProviders.length > 0 && selectedProviders.every((provider) => supportsCommercial(provider, value)));
  const commercialHint = commercialOffered.some((option) => !commercialEnabled(option.value))
    ? `Este filtro está disponible solo en ${enabledProviders.filter((provider) => provider.commercialFilters.length > 0).map((provider) => provider.label).join(" y ")}. Elegí esa fuente para usarlo.`
    : null;
  const availableSorts = useMemo(() => {
    const selected = selectedProviders;
    return (Object.keys(SORT_LABELS) as ModelSort[]).filter((option) => selected.every((provider) => provider.sorts.includes(option)));
  }, [selectedProviders]);

  const runSearch = useCallback(
    async (params: { query: string; source: ModelSourceId | "all"; price: PriceFilter; commercial: CommercialFilter; sort: ModelSort; cursor: string | null }) => {
      const id = ++requestId.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const append = params.cursor !== null;
      setPhase(append ? "loadingMore" : "loading");
      setMessage(null);
      if (!append) {
        setResults([]);
        setSources([]);
        setQueryVariants([]);
        setNextCursor(null);
        setGated(false);
      }

      const query = new URLSearchParams({ q: params.query });
      if (params.source !== "all") query.set("sources", params.source);
      if (params.price !== "any") query.set("price", params.price);
      if (params.commercial !== "any") query.set("commercial", params.commercial);
      if (params.sort !== "relevance") query.set("sort", params.sort);
      if (params.cursor) query.set("cursor", params.cursor);

      try {
        const response = await fetch(`/api/model-search?${query.toString()}`, { signal: controller.signal });
        if (id !== requestId.current) return;
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          if (body?.error === "account_required") setUpsell(true);
          setMessage(API_ERRORS[body?.error ?? ""] ?? API_ERRORS.search_unavailable);
          setPhase(append ? "done" : "error");
          return;
        }
        const data = (await response.json()) as ApiResponse;
        if (id !== requestId.current) return;
        setResults((current) => (append ? mergeUniqueResults(current, data.results) : data.results));
        setSources(data.sources);
        // Al paginar se suman (sin repetir) las variantes que recién respondieron: la indicación no desaparece ni se duplica.
        setQueryVariants((current) => (append ? Array.from(new Set([...current, ...(data.queryVariants ?? [])])) : (data.queryVariants ?? [])));
        setNextCursor(data.nextCursor);
        setGated(data.viewer.gated);
        setPhase(data.sources.length > 0 && data.sources.every((entry) => entry.status !== "ok") ? "error" : "done");
      } catch (error) {
        if ((error as Error).name === "AbortError" || id !== requestId.current) return;
        setMessage(API_ERRORS.search_unavailable);
        setPhase(append ? "done" : "error");
      }
    },
    [],
  );

  const current = { source, price, commercial, sort };

  const submit = (event?: React.FormEvent, override?: string) => {
    event?.preventDefault();
    if (enabledProviders.length === 0) return;
    const query = (override ?? input).replace(/\s+/g, " ").trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setMessage(API_ERRORS.query_too_short);
      return;
    }
    setInput(query);
    setSubmitted(query);
    writeRecent(addRecentSearch(recent, query));
    void runSearch({ query, ...current, cursor: null });
  };

  const clearInput = () => {
    setInput("");
    setMessage(null);
  };

  const activeFilterCount = [source !== "all", price !== "any", commercial !== "any", sort !== "relevance"].filter(Boolean).length;
  const resetFilters = () => applyFilters({ source: "all", price: "any", commercial: "any", sort: "relevance" });

  const applyFilters = (patch: Partial<typeof current>) => {
    const next = { ...current, ...patch };
    if (patch.source !== undefined) setSource(patch.source);
    if (patch.price !== undefined) setPrice(patch.price);
    if (patch.commercial !== undefined) setCommercial(patch.commercial);
    if (patch.sort !== undefined) setSort(patch.sort);
    if (patch.source !== undefined) {
      // Si la nueva fuente no soporta un filtro u orden elegido, volver al valor neutro (no fingir filtros inexistentes).
      const selected = next.source === "all" ? enabledProviders : enabledProviders.filter((provider) => provider.id === next.source);
      if (next.sort !== "relevance" && !selected.every((provider) => provider.sorts.includes(next.sort))) {
        next.sort = "relevance";
        setSort("relevance");
      }
      if (next.price !== "any" && !selected.some((provider) => provider.supportsPriceFilter)) {
        next.price = "any";
        setPrice("any");
      }
      if (next.commercial !== "any" && !selected.every((provider) => supportsCommercial(provider, next.commercial))) {
        next.commercial = "any";
        setCommercial("any");
      }
    }
    if (submitted) void runSearch({ query: submitted, ...next, cursor: null });
  };

  const lockedFilterClick = () => setUpsell(true);

  const noProviders = enabledProviders.length === 0;

  // Mismos filtros y mismas reglas de siempre; solo cambia cómo se presentan (desplegables en escritorio, panel en móvil).
  const sourceGroup: FilterGroup = {
    id: "source",
    label: "Fuente",
    value: source,
    neutral: "all",
    options: [
      { value: "all", label: "Todas", disabled: noProviders },
      ...providers.map((provider) => ({
        value: provider.id,
        label: provider.label,
        disabled: !provider.enabled,
        note: provider.enabled ? undefined : "no disponible",
      })),
    ],
    onSelect: (value) => applyFilters({ source: value as ModelSourceId | "all" }),
  };
  const priceGroup: FilterGroup = {
    id: "price",
    label: "Precio",
    value: price,
    neutral: "any",
    options: PRICE_OPTIONS.map((option) => ({ ...option, disabled: option.value !== "any" && !priceEnabled })),
    hint: !priceEnabled
      ? "Las fuentes seleccionadas no informan precio, por eso no se puede filtrar."
      : price !== "any"
        ? "Los modelos con precio no informado quedan fuera de este filtro."
        : null,
    onSelect: (value) => applyFilters({ price: value as PriceFilter }),
  };
  const commercialGroup: FilterGroup = {
    id: "commercial",
    label: "Uso comercial",
    value: commercial,
    neutral: "any",
    options: [COMMERCIAL_OPTIONS[0], ...commercialOffered].map((option) => ({
      ...option,
      disabled: !commercialEnabled(option.value),
      locked: !isMember && option.value !== "any",
    })),
    hint: commercialHint,
    onSelect: (value) => {
      if (isMember) applyFilters({ commercial: value as CommercialFilter });
      else if (value !== "any") lockedFilterClick();
    },
  };
  const sortGroup: FilterGroup = {
    id: "sort",
    label: "Orden",
    value: sort,
    neutral: "relevance",
    options: availableSorts.map((option) => ({ value: option, label: SORT_LABELS[option], locked: !isMember && option !== "relevance" })),
    hint:
      availableSorts.length <= 1 && selectedProviders.length > 0
        ? `${selectedProviders.map((provider) => provider.label).join(" y ")} solo ${selectedProviders.length > 1 ? "ordenan" : "ordena"} por relevancia.`
        : null,
    onSelect: (value) => {
      if (isMember || value === "relevance") applyFilters({ sort: value as ModelSort });
      else lockedFilterClick();
    },
  };
  // Cada filtro aparece solo si alguna fuente seleccionada lo admite.
  const filterGroups: FilterGroup[] = noProviders
    ? [sourceGroup]
    : [sourceGroup, priceGroup, ...(commercialOffered.length > 0 ? [commercialGroup] : []), sortGroup];

  const failedSources = sources.filter((entry) => entry.status in SOURCE_PROBLEM_TEXT);
  const okSources = sources.filter((entry) => entry.status === "ok");
  const unsupportedSources = sources.filter((entry) => entry.status === "unsupported");
  const labels = (entries: SourceStatus[]) => entries.map((entry) => MODEL_SOURCE_LABELS[entry.id]).join(" y ");
  const partialNotice =
    failedSources.length > 0 && okSources.length > 0
      ? failedSources.map((entry) => `${MODEL_SOURCE_LABELS[entry.id]} ${SOURCE_PROBLEM_TEXT[entry.status]}`).join("; ") + `. Mostrando resultados de ${labels(okSources)}.`
      : null;
  const unsupportedNotice =
    unsupportedSources.length > 0 && okSources.length > 0
      ? `${labels(unsupportedSources)} no ${unsupportedSources.length > 1 ? "admiten" : "admite"} estos filtros y quedó fuera de la búsqueda.`
      : null;
  const allUnsupported = sources.length > 0 && sources.every((entry) => entry.status === "unsupported" || entry.status === "disabled");
  const contributingSources = okSources.filter((entry) => results.some((result) => result.source === entry.id));
  const busy = phase === "loading";
  const visibleRecent = recentExpanded ? recent : recent.slice(0, RECENT_COLLAPSED);
  const hiddenRecent = recent.length - RECENT_COLLAPSED;
  const showExpansion = queryVariants.length > 0 && submitted && (phase === "done" || phase === "loadingMore");

  return (
    <div className="min-h-screen bg-stampa-bg text-stampa-body">
      {tier === "anonymous" && (
        <header className="sticky top-0 z-20 border-b border-stampa-border bg-stampa-bg/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <Link href={calculatorVisible ? "/calculadora" : "/login"} className="flex items-center gap-2">
              <Image src="/favicon.svg" alt="Stampa" width={28} height={28} className="h-7 w-7" />
              <span className="text-sm font-bold text-fg">Stampa</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm font-semibold whitespace-nowrap">
              <FeatureLink href="/calculadora" className="hidden rounded-lg px-3 py-2 text-gray-300 hover:text-fg sm:inline-block">Calculadora</FeatureLink>
              <Link href="/login" className="rounded-lg px-3 py-2 text-gray-300 hover:text-fg">Ingresar</Link>
              <Link href="/registro" className="rounded-lg bg-stampa-orange px-3 py-2 text-neutral-950 hover:bg-stampa-orange-hover">Crear cuenta</Link>
            </nav>
          </div>
        </header>
      )}

      <div className="mx-auto w-full max-w-6xl px-4 py-3 sm:py-4">
        {/* El header global ya muestra el nombre de la sección: el título queda solo para lectores de pantalla. */}
        <h1 className="sr-only">Explorar Modelos: encontrá modelos 3D en distintas plataformas desde un solo lugar</h1>

        {noProviders && (
          <div role="status" className="mb-3 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <AlertTriangle className="mt-0.5 shrink-0 text-amber-300" size={20} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">Las plataformas de modelos no están disponibles por ahora.</p>
              <p className="mt-1 text-xs text-gray-300">
                No mostramos resultados de ejemplo: la búsqueda se habilita apenas haya al menos una plataforma conectada.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="flex gap-2" role="search">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" size={18} aria-hidden="true" />
            <input
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={MAX_QUERY_LENGTH}
              disabled={noProviders}
              placeholder="Buscá un modelo: soporte notebook, laptop stand…"
              aria-label="Buscar modelos 3D"
              enterKeyHint="search"
              autoComplete="off"
              className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft py-3 pl-11 pr-11 text-base text-fg outline-none placeholder:text-gray-500 focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00] disabled:cursor-not-allowed disabled:opacity-60 [&::-webkit-search-cancel-button]:hidden"
            />
            {input && !noProviders && (
              <button
                type="button"
                onClick={clearInput}
                aria-label="Borrar búsqueda"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-fg/10 hover:text-fg"
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={busy || noProviders}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-stampa-orange px-4 py-3 text-sm font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:opacity-60 sm:px-6"
          >
            {busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
            <span className="sr-only sm:not-sr-only">{busy ? "Buscando…" : "Buscar"}</span>
          </button>
        </form>

        <div className="mt-2.5 sm:hidden">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="model-search-filters"
            className="inline-flex items-center gap-2 rounded-xl border border-stampa-border bg-stampa-surface px-3.5 py-2 text-sm font-semibold text-fg"
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            Filtros
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-stampa-orange px-2 py-0.5 text-[11px] font-bold text-neutral-950">
                <span className="sr-only">{activeFilterCount === 1 ? "1 filtro activo" : `${activeFilterCount} filtros activos`}</span>
                <span aria-hidden="true">{activeFilterCount}</span>
              </span>
            )}
          </button>
          <div id="model-search-filters" hidden={!filtersOpen} className="mt-2 max-h-[55vh] overflow-y-auto overscroll-contain rounded-xl border border-stampa-border bg-stampa-surface p-3">
            <FilterChipGroups groups={filterGroups} activeCount={activeFilterCount} onReset={resetFilters} />
          </div>
        </div>

        <div className="mt-2.5 hidden sm:block">
          <FilterDropdowns groups={filterGroups} activeCount={activeFilterCount} onReset={resetFilters} />
        </div>

        {recent.length > 0 && !noProviders && (
          <div className="mt-2.5 flex items-center gap-1.5" aria-label="Búsquedas recientes" role="group">
            <History size={14} className="shrink-0 text-gray-500" aria-hidden="true" />
            <div className={`flex min-w-0 flex-1 gap-1.5 ${recentExpanded ? "flex-wrap" : "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"}`}>
              {visibleRecent.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => submit(undefined, entry)}
                  className="max-w-[12rem] shrink-0 truncate rounded-full border border-stampa-border bg-stampa-surface px-2.5 py-0.5 text-xs font-medium text-gray-300 hover:bg-fg/10 hover:text-fg"
                >
                  {entry}
                </button>
              ))}
            </div>
            {hiddenRecent > 0 && (
              <button
                type="button"
                onClick={() => setRecentExpanded((expanded) => !expanded)}
                aria-expanded={recentExpanded}
                className="shrink-0 px-1 py-0.5 text-xs font-semibold text-gray-400 hover:text-fg"
              >
                {recentExpanded ? "Ver menos" : `+${hiddenRecent}`}
              </button>
            )}
            <button type="button" onClick={() => writeRecent([])} className="shrink-0 px-1 py-0.5 text-xs text-gray-500 underline-offset-2 hover:text-fg hover:underline">
              Borrar historial
            </button>
          </div>
        )}

        {upsell && !isMember && (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-stampa-orange/30 bg-stampa-orange/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-gray-200">Creá tu cuenta gratis para usar todos los filtros y ver más resultados.</p>
            <Link href="/registro" className="shrink-0 rounded-lg bg-stampa-orange px-4 py-2 text-center font-semibold text-neutral-950 hover:bg-stampa-orange-hover">Crear cuenta gratis</Link>
          </div>
        )}

        <div className="mt-4" aria-live="polite" aria-busy={busy}>
          {message && phase !== "error" && <p className="mb-4 rounded-xl border border-stampa-border bg-stampa-surface p-3 text-sm text-gray-300">{message}</p>}
          {partialNotice && (
            <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              {partialNotice}
            </p>
          )}
          {unsupportedNotice && <p className="mb-4 rounded-xl border border-stampa-border bg-stampa-surface p-3 text-xs text-gray-400">{unsupportedNotice}</p>}

          {phase === "idle" && !noProviders && (
            <div className="rounded-2xl border border-dashed border-stampa-border px-6 py-10 text-center">
              <Search className="mx-auto mb-3 text-gray-600" size={28} aria-hidden="true" />
              <p className="text-sm font-semibold text-fg">Buscá un modelo para empezar</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
                Vas a ver resultados de {enabledProviders.map((provider) => provider.label).join(" y ")}. Cada modelo te lleva a su página original.
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">Escribí en español o en inglés: también buscamos en el otro idioma.</p>
            </div>
          )}

          {busy && (
            <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => <ResultSkeleton key={index} />)}
            </div>
          )}

          {phase === "error" && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
              <AlertTriangle className="mx-auto mb-2 text-red-400" size={24} aria-hidden="true" />
              <p className="text-sm font-semibold text-fg">
                {message ?? (allUnsupported ? "Ninguna de las fuentes elegidas admite esos filtros." : "Ninguna plataforma pudo responder ahora.")}
              </p>
              {!message && !allUnsupported && <p className="mx-auto mt-1 max-w-sm text-xs text-gray-400">No es un problema de tu búsqueda. Probá de nuevo en unos segundos.</p>}
              {sources.length > 0 && !allUnsupported && (
                <p className="mt-1 text-xs text-gray-400">
                  {sources.map((entry) => `${MODEL_SOURCE_LABELS[entry.id]}: ${entry.status === "disabled" ? "no disponible" : SOURCE_PROBLEM_TEXT[entry.status] ?? "sin respuesta"}`).join(" · ")}
                </p>
              )}
              {submitted && !allUnsupported && (
                <button type="button" onClick={() => void runSearch({ query: submitted, ...current, cursor: null })} className="mt-4 rounded-xl border border-stampa-border px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-fg/10">
                  Reintentar
                </button>
              )}
              {allUnsupported && activeFilterCount > 0 && (
                <button type="button" onClick={resetFilters} className="mt-4 rounded-xl border border-stampa-border px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-fg/10">
                  Limpiar filtros
                </button>
              )}
            </div>
          )}

          {showExpansion && (
            <p className="mb-2 flex items-start gap-1.5 text-xs text-gray-500">
              <Languages size={13} className="mt-px shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">
                <span className="font-semibold">Búsqueda ampliada:</span> {[submitted, ...queryVariants].join(" · ")}
              </span>
            </p>
          )}

          {(phase === "done" || phase === "loadingMore") && results.length === 0 && (
            <div className="rounded-2xl border border-dashed border-stampa-border px-6 py-14 text-center">
              <SearchX className="mx-auto mb-3 text-gray-600" size={28} aria-hidden="true" />
              <p className="text-sm font-semibold text-fg">No encontramos modelos para “{submitted}”</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">Probá con otras palabras, quitá algún filtro o elegí otra fuente.</p>
            </div>
          )}

          {results.length > 0 && (
            <>
              <p className="mb-3 text-xs text-gray-500">
                {results.length} {results.length === 1 ? "modelo" : "modelos"} de {labels(contributingSources)}
              </p>
              <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
                {results.map((result) => (
                  <ModelResultCard key={`${result.source}:${result.externalId}`} result={result} canCalculate={tier === "paid"} />
                ))}
              </div>
            </>
          )}

          {results.length > 0 && (
            <div className="mt-6 flex flex-col items-center gap-3">
              {nextCursor && (
                <button
                  type="button"
                  disabled={phase === "loadingMore"}
                  onClick={() => submitted && void runSearch({ query: submitted, ...current, cursor: nextCursor })}
                  className="inline-flex items-center gap-2 rounded-xl border border-stampa-border bg-stampa-surface px-6 py-3 text-sm font-semibold text-fg hover:bg-fg/10 disabled:opacity-60"
                >
                  {phase === "loadingMore" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                  {phase === "loadingMore" ? "Cargando…" : "Ver más resultados"}
                </button>
              )}
              {gated && !isMember && (
                <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-stampa-orange/30 bg-stampa-orange/5 p-4 text-center text-sm">
                  <p className="text-gray-200">Creá tu cuenta gratis para seguir viendo más resultados.</p>
                  <Link href="/registro" className="rounded-lg bg-stampa-orange px-4 py-2 font-semibold text-neutral-950 hover:bg-stampa-orange-hover">Crear cuenta gratis</Link>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="mt-10 border-t border-stampa-border pt-4 text-xs leading-relaxed text-gray-500">
          Los modelos pertenecen a sus creadores y a las plataformas donde están alojados; Stampa solo te ayuda a encontrarlos y no aloja ni distribuye sus archivos.
          Verificá siempre la licencia en la fuente antes de usar un modelo, especialmente para venderlo.
        </p>
      </div>
    </div>
  );
}
