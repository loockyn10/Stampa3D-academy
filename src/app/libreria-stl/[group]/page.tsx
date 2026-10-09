"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { StlBreadcrumb } from "@/components/stl/StlBreadcrumb";
import { StlModelCard } from "@/components/stl/StlModelCard";
import { modelHref, modelsOfGroup, resolveGroupSegment, type StlGroupRow } from "@/lib/stl/library";
import { fetchStlLibrary, firstDownloadableVariant, type StlLibraryModel, type StlLibraryVariant } from "@/lib/stl/queries";

interface PageProps {
  params: Promise<{ group: string }>;
}

export default function LibreriaStlGroupPage({ params }: PageProps) {
  const { group: groupSegment } = use(params);
  const segment = decodeURIComponent(groupSegment);
  const [supabase] = useState(() => createClient());
  const [groups, setGroups] = useState<StlGroupRow[]>([]);
  const [models, setModels] = useState<StlLibraryModel[]>([]);
  const [variants, setVariants] = useState<StlLibraryVariant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchStlLibrary(supabase);
        if (cancelled) return;
        if (result.error) console.error("Error cargando grupo STL:", result.error);
        setGroups(result.groups);
        setModels(result.models);
        setVariants(result.variants);
      } catch (err) {
        console.error("Error fetching STL group:", err);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const group = useMemo(() => resolveGroupSegment(groups, segment), [groups, segment]);
  const groupModels = useMemo(() => (group ? modelsOfGroup(groups, models, group.id) : []), [group, groups, models]);

  const stampyScreenContext = useMemo<StampyScreenContext>(
    () => ({
      page: { section: "stl_library", route: "/libreria-stl", title: group ? `Librería STL · ${group.name}` : "Librería STL" },
      mode: "browse",
      visibleEntities: groupModels.slice(0, 20).map((model, index) => ({
        type: "stl_model",
        id: String(model.id),
        name: model.title,
        position: index + 1,
        facts: [
          ...(model.difficulty ? [{ label: "Dificultad visible", value: String(model.difficulty) }] : []),
          ...(model.material_type ? [{ label: "Material recomendado visible", value: String(model.material_type) }] : []),
        ],
      })),
      pageData: {
        kind: "pageFacts",
        facts: [
          ...(group ? [{ label: "Grupo", value: group.name }] : []),
          { label: "Modelos en el grupo", value: groupModels.length },
        ],
      },
      uiState: { loading },
    }),
    [group, groupModels, loading],
  );

  usePublishStampyScreenContext(stampyScreenContext);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-stampa-orange" />
      </div>
    );
  }

  if (!group || groupModels.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-xl font-bold text-white">
          {group ? "Este grupo todavía no tiene modelos" : "No encontramos ese grupo"}
        </h1>
        <p className="max-w-sm text-sm text-gray-400">
          {group ? "Volvé más tarde, estamos sumando modelos." : "Puede que el link esté desactualizado o que el grupo ya no esté disponible."}
        </p>
        <Link href="/libreria-stl" className="inline-flex items-center gap-2 rounded-xl bg-stampa-orange px-5 py-2.5 text-sm font-bold text-white hover:bg-stampa-orange-hover">
          <ArrowLeft size={16} /> Volver a la Librería STL
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      <div className="flex flex-col gap-3">
        <StlBreadcrumb items={[{ label: "Librería STL", href: "/libreria-stl" }, { label: group.name }]} />
        <Link href="/libreria-stl" className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-gray-500 transition-colors hover:text-stampa-orange">
          <ArrowLeft size={14} /> Librería STL
        </Link>
      </div>

      <div className="rounded-2xl border border-stampa-border bg-stampa-surface p-6 sm:p-8">
        <h1 className="mb-1 break-words text-2xl font-black tracking-tight text-white sm:text-3xl">{group.name}</h1>
        <p className="text-xs font-semibold text-stampa-orange">
          {groupModels.length} {groupModels.length === 1 ? "modelo" : "modelos"}
        </p>
        {group.description && <p className="mt-3 max-w-2xl text-sm text-gray-400">{group.description}</p>}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {groupModels.map((model) => (
          <StlModelCard
            key={model.id}
            model={{ ...model, hasFile: Boolean(firstDownloadableVariant(variants, model.id)) }}
            href={modelHref(group, model.id)}
          />
        ))}
      </div>
    </div>
  );
}
