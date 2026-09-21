"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, Loader2, Lock, Search, SearchX } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, MODEL_SOURCE_LABELS } from "@/lib/model-search/sources";
import type {
  CommercialFilter,
  ModelSearchResult,
  ModelSort,
  ModelSourceId,
  SourceStatus,
} from "@/lib/model-search/types";
import { ModelResultCard } from "./ModelResultCard";

export interface ProviderInfo {
  id: ModelSourceId;
  label: string;
  enabled: boolean;
  sorts: readonly ModelSort[];
  freeFilter: boolean;
  commercialFilters: readonly Exclude<CommercialFilter, "any">[];
}

type Tier = "anonymous" | "free" | "paid";
type Phase = "idle" | "loading" | "loadingMore" | "done" | "error";

interface ApiResponse {
  results: ModelSearchResult[];
  sources: SourceStatus[];
  nextCursor: string | null;
  viewer: { tier: Tier; maxPages: number; gated: boolean };
}

const SORT_LABELS: Record<ModelSort, string> = { relevance: "Relevancia", popular: "Populares", newest: "Recientes" };
const COMMERCIAL_OPTIONS: { value: CommercialFilter; label: string }[] = [
  { value: "any", label: "Todos" },
  { value: "allowed", label: "Permitido" },
  { value: "prohibited", label: "No permitido" },
  { value: "unknown", label: "Desconocido" },
];

const API_ERRORS: Record<string, string> = {
  query_too_short: `Escribí al menos ${MIN_QUERY_LENGTH} caracteres.`,
  query_too_long: `La búsqueda no puede superar ${MAX_QUERY_LENGTH} caracteres.`,
  rate_limited: "Hiciste muchas búsquedas seguidas. Esperá unos segundos y probá de nuevo.",
  account_required: "Creá tu cuenta gratis para usar esta opción.",
  unsupported_filter: "Esa combinación de filtros no está disponible para la fuente elegida.",
  search_unavailable: "No pudimos completar la búsqueda. Probá de nuevo en un momento.",
};

function supportsCommercial(provider: ProviderInfo, value: CommercialFilter): boolean {
  return value !== "any" && provider.commercialFilters.includes(value);
}

function chipClass(active: boolean) {
  return `shrink-0 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${
    active
      ? "border-stampa-orange bg-stampa-orange/10 text-stampa-orange"
      : "border-stampa-border bg-stampa-surface text-gray-300 hover:bg-white/10 hover:text-white"
  }`;
}

function ResultSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface" aria-hidden="true">
      <div className="aspect-[4/3] animate-pulse bg-white/5" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-4/5 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-white/5" />
        <div className="h-9 animate-pulse rounded-xl bg-white/5" />
      </div>
    </div>
  );
}

export function ExplorarModelosClient({ providers }: { providers: ProviderInfo[] }) {
  const enabledProviders = useMemo(() => providers.filter((provider) => provider.enabled), [providers]);
  const [tier, setTier] = useState<Tier | null>(null);
  const [input, setInput] = useState("");
  const [source, setSource] = useState<ModelSourceId | "all">("all");
  const [freeOnly, setFreeOnly] = useState(false);
  const [commercial, setCommercial] = useState<CommercialFilter>("any");
  const [sort, setSort] = useState<ModelSort>("relevance");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<ModelSearchResult[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [gated, setGated] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [upsell, setUpsell] = useState(false);
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
  // Los filtros reflejan capacidades reales: se ofrecen solo si alguna fuente los soporta y se habilitan únicamente si
  // TODAS las fuentes seleccionadas los soportan (si no, "Todas" descartaría resultados de alguna fuente en silencio).
  const freeOffered = enabledProviders.some((provider) => provider.freeFilter);
  const freeEnabled = selectedProviders.length > 0 && selectedProviders.every((provider) => provider.freeFilter);
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
    async (params: { query: string; source: ModelSourceId | "all"; freeOnly: boolean; commercial: CommercialFilter; sort: ModelSort; cursor: string | null }) => {
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
        setNextCursor(null);
        setGated(false);
      }

      const query = new URLSearchParams({ q: params.query });
      if (params.source !== "all") query.set("sources", params.source);
      if (params.freeOnly) query.set("free", "1");
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
        setResults((current) => (append ? [...current, ...data.results] : data.results));
        setSources(data.sources);
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

  const current = { source, freeOnly, commercial, sort };

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const query = input.replace(/\s+/g, " ").trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setMessage(API_ERRORS.query_too_short);
      return;
    }
    setSubmitted(query);
    void runSearch({ query, ...current, cursor: null });
  };

  const applyFilters = (patch: Partial<typeof current>) => {
    const next = { ...current, ...patch };
    if (patch.source !== undefined) setSource(patch.source);
    if (patch.freeOnly !== undefined) setFreeOnly(patch.freeOnly);
    if (patch.commercial !== undefined) setCommercial(patch.commercial);
    if (patch.sort !== undefined) setSort(patch.sort);
    if (patch.source !== undefined) {
      // Si la nueva fuente no soporta un filtro u orden elegido, volver al valor neutro (no fingir filtros inexistentes).
      const selected = next.source === "all" ? enabledProviders : enabledProviders.filter((provider) => provider.id === next.source);
      if (next.sort !== "relevance" && !selected.every((provider) => provider.sorts.includes(next.sort))) {
        next.sort = "relevance";
        setSort("relevance");
      }
      if (next.freeOnly && !selected.every((provider) => provider.freeFilter)) {
        next.freeOnly = false;
        setFreeOnly(false);
      }
      if (next.commercial !== "any" && !selected.every((provider) => supportsCommercial(provider, next.commercial))) {
        next.commercial = "any";
        setCommercial("any");
      }
    }
    if (submitted) void runSearch({ query: submitted, ...next, cursor: null });
  };

  const lockedFilterClick = () => setUpsell(true);

  const failedSources = sources.filter((entry) => entry.status === "timeout" || entry.status === "error");
  const okSources = sources.filter((entry) => entry.status === "ok");
  const partialNotice =
    failedSources.length > 0 && okSources.length > 0
      ? `${failedSources.map((entry) => MODEL_SOURCE_LABELS[entry.id]).join(" y ")} no ${failedSources.length > 1 ? "respondieron" : "respondió"}. Mostrando resultados de ${okSources.map((entry) => MODEL_SOURCE_LABELS[entry.id]).join(" y ")}.`
      : null;
  const busy = phase === "loading";

  return (
    <div className="min-h-screen bg-stampa-bg text-[#ededed]">
      {tier === "anonymous" && (
        <header className="sticky top-0 z-20 border-b border-stampa-border bg-stampa-bg/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/calculadora" className="flex items-center gap-2">
              <Image src="/favicon.svg" alt="Stampa" width={28} height={28} className="h-7 w-7" />
              <span className="text-sm font-bold text-white">Stampa</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm font-semibold whitespace-nowrap">
              <Link href="/calculadora" className="hidden rounded-lg px-3 py-2 text-gray-300 hover:text-white sm:inline-block">Calculadora</Link>
              <Link href="/login" className="rounded-lg px-3 py-2 text-gray-300 hover:text-white">Ingresar</Link>
              <Link href="/registro" className="rounded-lg bg-stampa-orange px-3 py-2 text-neutral-950 hover:bg-stampa-orange-hover">Crear cuenta</Link>
            </nav>
          </div>
        </header>
      )}

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold text-white sm:text-3xl">Explorar Modelos</h1>
          <p className="mt-1.5 text-sm text-gray-400 sm:text-base">Encontrá modelos 3D en distintas plataformas desde un solo lugar.</p>
        </div>

        {enabledProviders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stampa-border p-8 text-center">
            <AlertTriangle className="mx-auto mb-3 text-stampa-orange" size={24} />
            <p className="text-sm font-semibold text-white">El buscador todavía no tiene fuentes disponibles.</p>
            <p className="mt-1 text-xs text-gray-500">Volvé a intentar más tarde.</p>
          </div>
        ) : (
          <>
            <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row" role="search">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" size={18} aria-hidden="true" />
                <input
                  type="search"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  maxLength={MAX_QUERY_LENGTH}
                  placeholder="Buscá dragón articulado, soporte auriculares…"
                  aria-label="Buscar modelos 3D"
                  enterKeyHint="search"
                  autoComplete="off"
                  className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft py-3.5 pl-11 pr-4 text-base text-white outline-none placeholder:text-gray-500 focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-stampa-orange px-6 py-3.5 text-sm font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:opacity-60"
              >
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
                Buscar
              </button>
            </form>

            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Fuente">
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Fuente</span>
                <button type="button" onClick={() => applyFilters({ source: "all" })} className={chipClass(source === "all")} aria-pressed={source === "all"}>Todas</button>
                {enabledProviders.map((provider) => (
                  <button key={provider.id} type="button" onClick={() => applyFilters({ source: provider.id })} className={chipClass(source === provider.id)} aria-pressed={source === provider.id}>
                    {provider.label}
                  </button>
                ))}
              </div>

              {freeOffered && (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Precio">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Precio</span>
                  <button
                    type="button"
                    disabled={!freeEnabled}
                    onClick={() => applyFilters({ freeOnly: !freeOnly })}
                    className={`${chipClass(freeOnly)} disabled:cursor-not-allowed disabled:opacity-40`}
                    aria-pressed={freeOnly}
                  >
                    Solo gratuitos
                  </button>
                </div>
              )}

              {commercialOffered.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Uso comercial">
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Uso comercial</span>
                    {[COMMERCIAL_OPTIONS[0], ...commercialOffered].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={!commercialEnabled(option.value)}
                        onClick={() => (isMember ? applyFilters({ commercial: option.value }) : option.value === "any" ? undefined : lockedFilterClick())}
                        className={`${chipClass(commercial === option.value)} inline-flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40`}
                        aria-pressed={commercial === option.value}
                      >
                        {!isMember && option.value !== "any" && <Lock size={11} aria-hidden="true" />}
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {commercialHint && <p className="text-xs text-gray-500">{commercialHint}</p>}
                </div>
              )}

              {availableSorts.length > 1 && (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Orden">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">Orden</span>
                  {availableSorts.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => (isMember || option === "relevance" ? applyFilters({ sort: option }) : lockedFilterClick())}
                      className={`${chipClass(sort === option)} inline-flex items-center gap-1`}
                      aria-pressed={sort === option}
                    >
                      {!isMember && option !== "relevance" && <Lock size={11} aria-hidden="true" />}
                      {SORT_LABELS[option]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {upsell && !isMember && (
              <div className="mt-4 flex flex-col gap-2 rounded-xl border border-stampa-orange/30 bg-stampa-orange/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="text-gray-200">Creá tu cuenta gratis para usar todos los filtros y ver más resultados.</p>
                <Link href="/registro" className="shrink-0 rounded-lg bg-stampa-orange px-4 py-2 text-center font-semibold text-neutral-950 hover:bg-stampa-orange-hover">Crear cuenta gratis</Link>
              </div>
            )}

            <div className="mt-6" aria-live="polite">
              {message && phase !== "error" && <p className="mb-4 rounded-xl border border-stampa-border bg-stampa-surface p-3 text-sm text-gray-300">{message}</p>}
              {partialNotice && (
                <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {partialNotice}
                </p>
              )}

              {phase === "idle" && (
                <div className="rounded-2xl border border-dashed border-stampa-border px-6 py-14 text-center">
                  <Search className="mx-auto mb-3 text-gray-600" size={28} aria-hidden="true" />
                  <p className="text-sm font-semibold text-white">Buscá un modelo para empezar</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
                    Vas a ver resultados de {enabledProviders.map((provider) => provider.label).join(" y ")}. Cada modelo te lleva a su página original.
                  </p>
                </div>
              )}

              {busy && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }, (_, index) => <ResultSkeleton key={index} />)}
                </div>
              )}

              {phase === "error" && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
                  <AlertTriangle className="mx-auto mb-2 text-red-400" size={24} aria-hidden="true" />
                  <p className="text-sm font-semibold text-white">{message ?? "Ninguna fuente respondió."}</p>
                  {sources.length > 0 && (
                    <p className="mt-1 text-xs text-gray-400">
                      {sources.map((entry) => `${MODEL_SOURCE_LABELS[entry.id]}: ${entry.status === "timeout" ? "sin respuesta a tiempo" : entry.status === "disabled" ? "no disponible" : "con error"}`).join(" · ")}
                    </p>
                  )}
                  {submitted && (
                    <button type="button" onClick={() => void runSearch({ query: submitted, ...current, cursor: null })} className="mt-4 rounded-xl border border-stampa-border px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10">
                      Reintentar
                    </button>
                  )}
                </div>
              )}

              {(phase === "done" || phase === "loadingMore") && results.length === 0 && (
                <div className="rounded-2xl border border-dashed border-stampa-border px-6 py-14 text-center">
                  <SearchX className="mx-auto mb-3 text-gray-600" size={28} aria-hidden="true" />
                  <p className="text-sm font-semibold text-white">No encontramos modelos para “{submitted}”</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">Probá con otras palabras, quitá algún filtro o elegí otra fuente.</p>
                </div>
              )}

              {results.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {results.map((result) => (
                    <ModelResultCard key={`${result.source}:${result.externalId}`} result={result} canCalculate={tier === "paid"} />
                  ))}
                </div>
              )}

              {results.length > 0 && (
                <div className="mt-6 flex flex-col items-center gap-3">
                  {nextCursor && (
                    <button
                      type="button"
                      disabled={phase === "loadingMore"}
                      onClick={() => submitted && void runSearch({ query: submitted, ...current, cursor: nextCursor })}
                      className="inline-flex items-center gap-2 rounded-xl border border-stampa-border bg-stampa-surface px-6 py-3 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60"
                    >
                      {phase === "loadingMore" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                      Ver más resultados
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
          </>
        )}
      </div>
    </div>
  );
}
