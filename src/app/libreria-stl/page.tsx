"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { StlGroupCard } from "@/components/stl/StlGroupCard";
import { StlModelCard } from "@/components/stl/StlModelCard";
import {
  buildGroupSummaries,
  modelHref,
  resolveGroupSegment,
  UNGROUPED_GROUP_SLUG,
  type StlGroupRow,
} from "@/lib/stl/library";
import { fetchStlLibrary, firstDownloadableVariant, type StlLibraryModel, type StlLibraryVariant } from "@/lib/stl/queries";

export default function LibreriaStlPage() {
  const [supabase] = useState(() => createClient());
  const [groups, setGroups] = useState<StlGroupRow[]>([]);
  const [models, setModels] = useState<StlLibraryModel[]>([]);
  const [variants, setVariants] = useState<StlLibraryVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchStlLibrary(supabase);
        if (cancelled) return;
        if (result.error) {
          console.error("Error cargando Librería STL:", result.error);
          setLoadError(true);
        }
        setGroups(result.groups);
        setModels(result.models);
        setVariants(result.variants);
      } catch (err) {
        console.error("Error fetching STL data:", err);
        if (!cancelled) setLoadError(true);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const summaries = useMemo(() => buildGroupSummaries(groups, models), [groups, models]);

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const visibleGroupIds = new Set(summaries.map((summary) => summary.id));
    return models
      .filter((model) => model.category_id === null || visibleGroupIds.has(model.category_id))
      .filter((model) => {
        const groupName = groups.find((group) => group.id === model.category_id)?.name ?? "";
        return (
          model.title.toLowerCase().includes(term) ||
          groupName.toLowerCase().includes(term) ||
          (model.material_type ?? "").toLowerCase().includes(term)
        );
      });
  }, [groups, models, query, summaries]);

  const totalModels = useMemo(() => summaries.reduce((sum, summary) => sum + summary.modelCount, 0), [summaries]);

  const stampyScreenContext = useMemo<StampyScreenContext>(
    () => ({
      page: { section: "stl_library", route: "/libreria-stl", title: "Librería STL" },
      mode: "browse",
      visibleEntities: query
        ? searchResults.slice(0, 20).map((model, index) => ({
            type: "stl_model",
            id: String(model.id),
            name: model.title,
            position: index + 1,
            facts: [
              ...(model.difficulty ? [{ label: "Dificultad visible", value: String(model.difficulty) }] : []),
              ...(model.material_type ? [{ label: "Material recomendado visible", value: String(model.material_type) }] : []),
            ],
          }))
        : summaries.slice(0, 20).map((group, index) => ({
            type: "stl_group",
            id: String(group.id ?? UNGROUPED_GROUP_SLUG),
            name: group.name,
            position: index + 1,
            facts: [{ label: "Modelos publicados", value: group.modelCount }],
          })),
      pageData: {
        kind: "pageFacts",
        facts: [
          { label: "Grupos disponibles", value: summaries.length },
          { label: "Modelos disponibles", value: totalModels },
        ],
      },
      uiState: { loading, ...(query ? { searchQuery: query } : {}) },
    }),
    [loading, query, searchResults, summaries, totalModels],
  );

  usePublishStampyScreenContext(stampyScreenContext);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-stampa-orange" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="relative overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface p-6 sm:p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-stampa-orange/5 blur-3xl" />
        <div className="relative z-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-stampa-orange/20 bg-stampa-orange/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-400">
              <span className="text-[10px]">✨</span> Recursos para miembros
            </div>
            <h1 className="mb-2 text-3xl font-black tracking-tight text-white md:text-4xl">Librería STL</h1>
            <p className="text-sm text-gray-400">
              Elegí un grupo, mirá el modelo en 3D y descargalo listo para imprimir.
            </p>
          </div>
          <div className="w-full shrink-0 md:w-80">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar modelos o grupos..."
                className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft py-3 pl-10 pr-4 text-sm text-white transition-all focus:border-stampa-orange focus:outline-none focus:ring-1 focus:ring-stampa-orange"
              />
            </div>
          </div>
        </div>
      </div>

      {loadError && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          No pude cargar toda la librería. Probá recargar la página.
        </p>
      )}

      {query.trim() ? (
        searchResults.length === 0 ? (
          <EmptyBlock title="No hay resultados para tu búsqueda" text="Intentá con otras palabras clave o explorá los grupos." onReset={() => setQuery("")} />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {searchResults.map((model) => {
              const group = resolveGroupSegment(groups, model.category_id ?? UNGROUPED_GROUP_SLUG);
              const groupLike = { id: model.category_id, slug: group?.slug ?? null };
              return (
                <StlModelCard
                  key={model.id}
                  model={{ ...model, hasFile: Boolean(firstDownloadableVariant(variants, model.id)) }}
                  href={modelHref(groupLike, model.id)}
                  groupLabel={group?.name}
                />
              );
            })}
          </div>
        )
      ) : summaries.length === 0 ? (
        <EmptyBlock title="Todavía no hay grupos publicados" text="Cuando se carguen modelos, van a aparecer acá organizados por grupo." />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {summaries.map((group) => (
            <StlGroupCard key={group.id ?? group.slug} group={group} />
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-col items-center justify-between gap-6 rounded-2xl border border-stampa-border bg-stampa-surface p-6 md:flex-row">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-stampa-border bg-stampa-bg-soft">
            <span className="text-2xl">💡</span>
          </div>
          <div>
            <h4 className="mb-1 font-bold text-white">Usá estos archivos como punto de partida</h4>
            <p className="text-sm text-gray-400">
              Descargá el archivo, revisá la configuración recomendada y adaptalo a tu impresora y material.
            </p>
          </div>
        </div>
        <a
          href="/stampy"
          className="w-full shrink-0 rounded-xl border border-stampa-border bg-stampa-bg-soft px-6 py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-white/5 md:w-auto"
        >
          Preguntarle a Stampy
        </a>
      </div>
    </div>
  );
}

function EmptyBlock({ title, text, onReset }: { title: string; text: string; onReset?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-stampa-border bg-stampa-surface px-4 py-20">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-stampa-border bg-stampa-bg-soft">
        <span className="text-3xl opacity-50 grayscale">📁</span>
      </div>
      <h3 className="mb-2 text-center text-xl font-bold text-white">{title}</h3>
      <p className="mb-6 max-w-sm text-center text-sm font-medium text-gray-400">{text}</p>
      {onReset && (
        <button onClick={onReset} className="rounded-lg bg-stampa-orange px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-stampa-orange-hover">
          Ver grupos
        </button>
      )}
    </div>
  );
}
