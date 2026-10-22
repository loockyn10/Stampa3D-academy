"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Layers,
  Package,
  PackageX,
  Plus,
  Printer,
  RefreshCw,
  Warehouse,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { PageHeader, Panel, PanelEmpty, StatCard } from "@/components/ui/dashboard";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { formatGrams, type WorkshopSummary } from "@/lib/workshop/dashboard";
import { loadWorkshopSummary } from "@/lib/workshop/load-summary";
import { WORKSHOP_ROUTES } from "@/lib/workshop/routes";

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; summary: WorkshopSummary };

/**
 * Mi Taller → Dashboard. Solo lectura (RLS del usuario); las acciones llevan a los flujos existentes
 * (Registrar producción en Inventario, alta de producto en Productos). No escribe stock.
 */
export function WorkshopDashboard() {
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setState({ status: "error" });
      return;
    }
    const summary = await loadWorkshopSummary(supabase, user.id);
    setState(summary ? { status: "ready", summary } : { status: "error" });
  }, [supabase]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const summary = state.status === "ready" ? state.summary : null;
  const loading = state.status === "loading";

  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "workshop", route: "/mi-taller", title: "Mi Taller · Resumen" },
    mode: "dashboard",
    selectedEntity: null,
    visibleEntities: (summary?.attentionProducts ?? []).map((product, index) => ({
      type: "product",
      id: product.id,
      name: product.name,
      position: index + 1,
      facts: [
        { label: "Unidades terminadas", value: product.stockQuantity },
        { label: "Requiere recalcular", value: product.needsRecalculation },
      ],
    })),
    pageData: {
      kind: "pageFacts",
      facts: summary
        ? [
            { label: "Productos activos", value: summary.activeProducts },
            { label: "Unidades terminadas", value: summary.finishedUnits },
            { label: "Productos sin stock", value: summary.outOfStockProducts },
            { label: "Productos que requieren recalcular", value: summary.needsRecalculationProducts },
            { label: "Bobinas activas", value: summary.activeSpools },
            { label: "Bobinas agotadas", value: summary.emptySpools },
          ]
        : [],
    },
    uiState: { loading },
  }), [loading, summary]);
  usePublishStampyScreenContext(stampyContext);

  return (
    <WorkshopDashboardView
      summary={summary}
      loading={loading}
      error={state.status === "error"}
      onRetry={() => void load()}
    />
  );
}

/** Vista presentacional (sin acceso a datos): recibe el resumen ya calculado. */
export function WorkshopDashboardView({
  summary,
  loading,
  error,
  onRetry,
}: {
  summary: WorkshopSummary | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const isNewWorkshop = summary
    ? summary.activeProducts === 0 && summary.activeSpools === 0 && summary.printers === 0
    : false;

  return (
    <div className="pb-24">
      <PageHeader
        title="Mi Taller"
        description="Producción, inventario terminado, productos, filamentos e impresoras en un solo lugar."
        actions={
          <>
            <Link
              href={WORKSHOP_ROUTES.registerProduction}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-stampa-border bg-white/5 px-2.5 text-[13px] font-semibold text-white sm:flex-none sm:px-3 sm:text-sm transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
            >
              <ClipboardList size={15} aria-hidden="true" className="hidden min-[400px]:block" /> Registrar movimiento
            </Link>
            <Link
              href={WORKSHOP_ROUTES.newProduct}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-stampa-orange px-2.5 text-[13px] font-bold text-neutral-950 sm:flex-none sm:px-3 sm:text-sm transition-colors hover:bg-stampa-orange-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
            >
              <Plus size={15} aria-hidden="true" /> Nuevo producto
            </Link>
          </>
        }
      />

      {error && (
        <div role="alert" className="mb-5 flex flex-col gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between">
          <span>No pudimos cargar el resumen del taller. Tus datos no se modificaron.</span>
          <button type="button" onClick={onRetry} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-400/30 px-3 text-xs font-bold text-red-100 hover:bg-red-500/10">
            <RefreshCw size={14} aria-hidden="true" /> Reintentar
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Productos registrados"
          value={summary?.activeProducts ?? 0}
          hint="Productos activos"
          icon={Package}
          href={WORKSHOP_ROUTES.products}
          loading={loading}
        />
        <StatCard
          label="Unidades terminadas"
          value={summary?.finishedUnits ?? 0}
          hint={summary && summary.assemblableUnits > 0 ? `+${summary.assemblableUnits} armables con piezas` : "Listas para vender"}
          icon={Warehouse}
          tone="green"
          href={WORKSHOP_ROUTES.inventory}
          loading={loading}
        />
        <StatCard
          label="Productos sin stock"
          value={summary?.outOfStockProducts ?? 0}
          hint="Activos con 0 unidades"
          icon={PackageX}
          tone={summary && summary.outOfStockProducts > 0 ? "red" : "neutral"}
          href={WORKSHOP_ROUTES.inventoryOutOfStock}
          loading={loading}
        />
        <StatCard
          label="Costos desactualizados"
          value={summary?.needsRecalculationProducts ?? 0}
          hint="Requieren recalcular"
          icon={RefreshCw}
          tone={summary && summary.needsRecalculationProducts > 0 ? "yellow" : "neutral"}
          href={WORKSHOP_ROUTES.productsNeedingRecalculation}
          loading={loading}
        />
      </div>

      {summary && isNewWorkshop ? (
        <WorkshopOnboarding />
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Requiere tu atención" icon={AlertTriangle} className="lg:col-span-2" action={summary && summary.attentionProducts.length > 0 ? { href: WORKSHOP_ROUTES.inventory, label: "Ver inventario" } : undefined}>
            {loading ? (
              <ListSkeleton rows={3} />
            ) : !summary ? null : summary.attentionProducts.length === 0 && summary.emptySpools === 0 ? (
              summary.activeProducts === 0 ? (
                <PanelEmpty action={{ href: WORKSHOP_ROUTES.newProduct, label: "Crear mi primer producto" }}>
                  Todavía no cargaste productos. Definí su receta para calcular costos y controlar el stock.
                </PanelEmpty>
              ) : (
                <p className="flex items-center gap-2 rounded-xl bg-emerald-500/5 px-3 py-3 text-sm text-emerald-300">
                  <CheckCircle2 size={16} aria-hidden="true" /> Todo en orden: sin productos agotados, costos al día y sin bobinas vacías.
                </p>
              )
            ) : (
              <ul className="divide-y divide-stampa-border">
                {summary.attentionProducts.map((product) => (
                  <li key={product.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <ProductThumb url={product.imageUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{product.name}</p>
                      <div className="mt-0.5 flex flex-wrap gap-1.5">
                        {product.outOfStock && (
                          <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-300">Agotado</span>
                        )}
                        {product.outOfStock && product.assemblableUnits !== null && product.assemblableUnits > 0 && (
                          <span className="rounded-md bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-300">
                            {product.assemblableUnits} armables con piezas
                          </span>
                        )}
                        {product.needsRecalculation && (
                          <span className="rounded-md bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-yellow-300" title={product.reasons.join(" · ")}>
                            Recalcular costo
                          </span>
                        )}
                      </div>
                    </div>
                    <Link
                      href={product.needsRecalculation && !product.outOfStock ? WORKSHOP_ROUTES.editProduct(product.id) : WORKSHOP_ROUTES.inventory}
                      className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2 text-xs font-semibold text-gray-400 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
                      aria-label={`${product.needsRecalculation && !product.outOfStock ? "Revisar costo de" : "Ver stock de"} ${product.name}`}
                    >
                      {product.needsRecalculation && !product.outOfStock ? "Revisar" : "Ver stock"}
                    </Link>
                  </li>
                ))}
                {summary.emptySpools > 0 && (
                  <li className="flex items-center gap-3 py-2.5 last:pb-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-300" aria-hidden="true">
                      <Boxes size={16} />
                    </span>
                    <p className="min-w-0 flex-1 text-sm text-gray-300">
                      <strong className="text-white">{summary.emptySpools} {summary.emptySpools === 1 ? "bobina agotada" : "bobinas agotadas"}</strong>
                      <span className="block truncate text-xs text-gray-400">{summary.emptySpoolList.map((spool) => spool.name).join(", ")}</span>
                    </p>
                    <Link href={WORKSHOP_ROUTES.filaments} className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2 text-xs font-semibold text-gray-400 hover:bg-white/5 hover:text-white">
                      Ver bobinas
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </Panel>

          <Panel title="Filamentos" icon={Layers} action={{ href: WORKSHOP_ROUTES.filaments, label: "Gestionar" }}>
            {loading ? (
              <ListSkeleton rows={3} />
            ) : !summary ? null : summary.activeSpools === 0 ? (
              <PanelEmpty action={{ href: WORKSHOP_ROUTES.filaments, label: "Cargar bobinas" }}>
                Cargá tus bobinas para descontar material al producir.
              </PanelEmpty>
            ) : (
              <>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <MiniFact label="Bobinas activas" value={summary.activeSpools} />
                  <MiniFact label="Material" value={formatGrams(summary.availableGrams)} />
                  <MiniFact label="Agotadas" value={summary.emptySpools} tone={summary.emptySpools > 0 ? "red" : undefined} />
                </dl>
                <ul className="mt-3 space-y-2">
                  {summary.materials.slice(0, 4).map((material) => {
                    const share = summary.availableGrams > 0 ? Math.round((material.grams / summary.availableGrams) * 100) : 0;
                    return (
                      <li key={material.material}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-gray-300">{material.material}</span>
                          <span className="tabular-nums text-gray-400">{formatGrams(material.grams)} · {material.spools} {material.spools === 1 ? "bobina" : "bobinas"}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden="true">
                          <div className="h-full rounded-full bg-stampa-orange/70" style={{ width: `${share}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Panel>

          <Panel title="Inventario" icon={Warehouse} className="lg:col-span-2" action={{ href: WORKSHOP_ROUTES.inventory, label: "Abrir inventario" }}>
            {loading ? (
              <ListSkeleton rows={2} />
            ) : !summary ? null : summary.activeProducts === 0 ? (
              <PanelEmpty action={{ href: WORKSHOP_ROUTES.newProduct, label: "Nuevo producto" }}>
                Cuando registres producción, vas a ver acá tus unidades terminadas.
              </PanelEmpty>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <InventoryFact label="Con stock" value={summary.activeProducts - summary.outOfStockProducts} hint="productos con unidades terminadas" />
                <InventoryFact label="Agotados" value={summary.outOfStockProducts} hint="registrá producción o armá con piezas" tone={summary.outOfStockProducts > 0 ? "red" : undefined} />
                <InventoryFact
                  label="Armables"
                  value={summary.assemblableUnits}
                  hint={summary.assemblableProducts > 0 ? `unidades en ${summary.assemblableProducts} ${summary.assemblableProducts === 1 ? "producto" : "productos"} por partes` : "sin piezas suficientes para armar"}
                />
              </div>
            )}
          </Panel>

          <Panel title="Impresoras" icon={Printer} action={{ href: WORKSHOP_ROUTES.printers, label: "Gestionar" }}>
            {loading ? (
              <ListSkeleton rows={1} />
            ) : !summary ? null : summary.printers === 0 ? (
              <PanelEmpty action={{ href: WORKSHOP_ROUTES.printers, label: "Agregar impresora" }}>
                Agregá tu impresora para calcular electricidad y mantenimiento.
              </PanelEmpty>
            ) : (
              <p className="text-sm text-gray-400">
                <strong className="text-2xl font-bold tabular-nums text-white">{summary.printers}</strong>{" "}
                {summary.printers === 1 ? "impresora activa" : "impresoras activas"} para calcular costos de producción.
              </p>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function WorkshopOnboarding() {
  const steps = [
    { href: WORKSHOP_ROUTES.printers, icon: Printer, title: "Agregá tu impresora", text: "Consumo y mantenimiento para calcular costos." },
    { href: WORKSHOP_ROUTES.filaments, icon: Layers, title: "Cargá tus bobinas", text: "Una card por bobina física, con gramos disponibles." },
    { href: WORKSHOP_ROUTES.newProduct, icon: Package, title: "Creá un producto", text: "Receta, tiempo y precio con el mismo motor de la Calculadora." },
    { href: WORKSHOP_ROUTES.registerProduction, icon: ClipboardList, title: "Registrá producción", text: "Descuenta filamento y suma unidades terminadas." },
  ];
  return (
    <section className="mt-5 rounded-2xl border border-stampa-orange/20 bg-gradient-to-br from-stampa-orange/10 to-transparent p-4 sm:p-5" aria-labelledby="workshop-onboarding-title">
      <h2 id="workshop-onboarding-title" className="text-base font-bold text-white">Armá tu taller en 4 pasos</h2>
      <p className="mt-1 text-sm text-gray-400">Con estos datos Stampa calcula costos reales y controla tu stock.</p>
      <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.title}>
              <Link href={step.href} className="flex h-full gap-3 rounded-xl border border-stampa-border bg-stampa-surface p-3 transition-colors hover:border-stampa-orange/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stampa-orange/10 text-stampa-orange" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{index + 1}. {step.title}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-gray-400">{step.text}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ProductThumb({ url }: { url: string | null }) {
  if (!url) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stampa-border bg-white/5 text-gray-400" aria-hidden="true">
        <Package size={15} />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg border border-stampa-border object-cover" />;
}

function MiniFact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "red" }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={`mt-0.5 text-sm font-bold tabular-nums ${tone === "red" ? "text-red-300" : "text-white"}`}>{value}</dd>
    </div>
  );
}

function InventoryFact({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: "red" }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.03] px-3 py-3">
      <p className="truncate text-xs font-semibold text-gray-400">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${tone === "red" ? "text-red-300" : "text-white"}`}>{value}</p>
      <p className="hidden text-[11px] leading-snug text-gray-400 sm:block">{hint}</p>
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-lg bg-white/5" />
      ))}
    </div>
  );
}
