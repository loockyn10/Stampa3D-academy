"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Boxes, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { StlBreadcrumb } from "@/components/stl/StlBreadcrumb";
import { StlDownloadButton } from "@/components/stl/StlDownloadButton";
import { StlDifficultyBadge } from "@/components/stl/StlDifficultyBadge";
import {
  formatStlDimensions,
  getStlViewerSupport,
  groupHref,
  modelHref,
  resolveGroupSegment,
  type StlDimensions,
  type StlGroupRow,
} from "@/lib/stl/library";
import { normalizeModel, type StlLibraryModel, type StlLibraryVariant } from "@/lib/stl/queries";

// El viewer (three + STLLoader) solo se carga en el detalle, nunca en las cards.
const Model3DViewer = dynamic(() => import("@/components/stl/Model3DViewer").then((mod) => mod.Model3DViewer), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl border border-stampa-border bg-stampa-bg-soft sm:aspect-video">
      <Loader2 className="h-7 w-7 animate-spin text-stampa-orange" />
    </div>
  ),
});

interface PageProps {
  params: Promise<{ group: string; model: string }>;
}

const MODEL_COLUMNS =
  "id, name, title, description, difficulty, material_type, estimated_print_time, thumbnail_url, category_id, is_active, created_at";

export default function LibreriaStlModelPage({ params }: PageProps) {
  const { group: groupSegment, model: modelSegment } = use(params);
  const segment = decodeURIComponent(groupSegment);
  const modelId = decodeURIComponent(modelSegment);
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [groups, setGroups] = useState<StlGroupRow[]>([]);
  const [model, setModel] = useState<StlLibraryModel | null>(null);
  const [variant, setVariant] = useState<StlLibraryVariant | null>(null);
  const [loading, setLoading] = useState(true);
  const [dimensions, setDimensions] = useState<StlDimensions | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [groupsRes, modelRes] = await Promise.all([
          supabase
            .from("stl_categories")
            .select("id, name, slug, description, thumbnail_url, sort_order, is_active")
            .eq("is_active", true),
          supabase.from("stl_models").select(MODEL_COLUMNS).eq("id", modelId).eq("is_active", true).maybeSingle(),
        ]);
        if (cancelled) return;
        setGroups((groupsRes.data ?? []) as StlGroupRow[]);

        const loadedModel = modelRes.data ? normalizeModel(modelRes.data as StlLibraryModel) : null;
        setModel(loadedModel);

        if (loadedModel) {
          const { data: variantRows } = await supabase
            .from("stl_variants")
            .select("id, model_id, file_url, is_active")
            .eq("model_id", loadedModel.id)
            .eq("is_active", true)
            .not("file_url", "is", null)
            .order("created_at")
            .limit(1);
          if (cancelled) return;
          setVariant(((variantRows ?? [])[0] ?? null) as StlLibraryVariant | null);
        }
      } catch (err) {
        console.error("Error fetching STL model:", err);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [modelId, supabase]);

  // El modelo debe pertenecer a un grupo público (o no tener grupo -> "Otros modelos").
  const modelGroup = useMemo(() => {
    if (!model) return null;
    return resolveGroupSegment(groups, model.category_id ?? "otros-modelos");
  }, [groups, model]);
  const requestedGroup = useMemo(() => resolveGroupSegment(groups, segment), [groups, segment]);

  // Link viejo / grupo equivocado: redirigir al grupo canónico del modelo.
  const canonicalHref = model && modelGroup ? modelHref(modelGroup, model.id) : null;
  const isCanonical = Boolean(model && modelGroup && requestedGroup && requestedGroup.id === modelGroup.id);
  useEffect(() => {
    if (!loading && canonicalHref && !isCanonical) router.replace(canonicalHref);
  }, [canonicalHref, isCanonical, loading, router]);

  const viewerSupport = getStlViewerSupport(variant?.file_url);

  const stampyScreenContext = useMemo<StampyScreenContext>(
    () => ({
      page: { section: "stl_library", route: "/libreria-stl", title: model ? `Librería STL · ${model.title}` : "Librería STL" },
      mode: "detail",
      visibleEntities: model
        ? [
            {
              type: "stl_model",
              id: String(model.id),
              name: model.title,
              position: 1,
              facts: [
                ...(modelGroup ? [{ label: "Grupo visible", value: modelGroup.name }] : []),
                ...(model.difficulty ? [{ label: "Dificultad visible", value: String(model.difficulty) }] : []),
                ...(model.material_type ? [{ label: "Material recomendado visible", value: String(model.material_type) }] : []),
                { label: "Archivo disponible", value: Boolean(variant) },
              ],
            },
          ]
        : [],
      uiState: { loading },
    }),
    [loading, model, modelGroup, variant],
  );

  usePublishStampyScreenContext(stampyScreenContext);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-stampa-orange" />
      </div>
    );
  }

  if (!model || !modelGroup) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-xl font-bold text-white">No encontramos ese modelo</h1>
        <p className="max-w-sm text-sm text-gray-400">Puede que el link esté desactualizado o que el modelo ya no esté disponible.</p>
        <Link href="/libreria-stl" className="inline-flex items-center gap-2 rounded-xl bg-stampa-orange px-5 py-2.5 text-sm font-bold text-white hover:bg-stampa-orange-hover">
          <ArrowLeft size={16} /> Volver a la Librería STL
        </Link>
      </div>
    );
  }

  const backHref = groupHref(modelGroup);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <div className="flex flex-col gap-3">
        <StlBreadcrumb
          items={[
            { label: "Librería STL", href: "/libreria-stl" },
            { label: modelGroup.name, href: backHref },
            { label: model.title },
          ]}
        />
        <Link href={backHref} className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-gray-500 transition-colors hover:text-stampa-orange">
          <ArrowLeft size={14} /> {modelGroup.name}
        </Link>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {variant && viewerSupport.supported ? (
            <Model3DViewer key={variant.id} variantId={variant.id} onDimensions={setDimensions} />
          ) : (
            <div className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-stampa-border bg-stampa-bg-soft px-6 text-center sm:aspect-video">
              {model.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={model.thumbnail_url} alt={model.title} className="absolute inset-0 h-full w-full object-cover opacity-40" />
              ) : null}
              <Boxes size={40} className="relative text-gray-500" />
              <p className="relative max-w-xs text-xs text-gray-400">
                {viewerSupport.supported ? "Este modelo todavía no tiene archivo." : viewerSupport.reason}
              </p>
            </div>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-5 rounded-2xl border border-stampa-border bg-stampa-surface p-5 sm:p-6">
          <div>
            <p className="mb-1.5 truncate text-[10px] font-bold uppercase tracking-wider text-stampa-orange">{modelGroup.name}</p>
            <h1 className="break-words text-2xl font-black leading-tight tracking-tight text-white">{model.title}</h1>
            <div className="mt-3">
              <StlDifficultyBadge difficulty={model.difficulty} />
            </div>
          </div>

          {model.description && <p className="whitespace-pre-line break-words text-sm text-gray-400">{model.description}</p>}

          <dl className="grid grid-cols-2 gap-2">
            <Fact label="Material" value={model.material_type} />
            <Fact label="Tiempo Imp." value={model.estimated_print_time} />
            {dimensions && (
              <div className="col-span-2 rounded-lg border border-stampa-border bg-stampa-bg-soft p-2.5">
                <dt className="mb-0.5 text-[10px] font-medium text-gray-500">Dimensiones (X × Y × Z)</dt>
                <dd className="text-xs font-bold text-white">
                  {formatStlDimensions(dimensions)} <span className="font-medium text-gray-500">· unidades del archivo</span>
                </dd>
              </div>
            )}
          </dl>

          <StlDownloadButton variantId={variant?.id ?? null} />
        </aside>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 rounded-lg border border-stampa-border bg-stampa-bg-soft p-2.5">
      <dt className="mb-0.5 text-[10px] font-medium text-gray-500">{label}</dt>
      <dd className="truncate text-xs font-bold text-white">{value || "-"}</dd>
    </div>
  );
}
