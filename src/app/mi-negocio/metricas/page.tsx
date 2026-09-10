"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeDollarSign, Boxes, Loader2, ReceiptText, ShoppingBag, TrendingDown, TrendingUp } from "lucide-react";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import type { BusinessMetrics } from "@/lib/business/metrics";
import type { BusinessInventoryPeriod } from "@/lib/business/replenishment";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { loadBusinessMetricsAction } from "../actions";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

function Comparison({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[11px] text-gray-600">Sin período comparable</span>;
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${positive ? "text-emerald-300" : "text-amber-300"}`}><Icon size={13} /> {positive ? "+" : ""}{value.toLocaleString("es-AR")}% vs. período anterior</span>;
}

export default function MetricasPage() {
  const [period, setPeriod] = useState<BusinessInventoryPeriod>("week");
  const [metrics, setMetrics] = useState<BusinessMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadBusinessMetricsAction(period).then((result) => {
      if (!active) return;
      if (result.success) { setMetrics(result.metrics); setError(null); }
      else { setMetrics(null); setError(result.error); }
      setLoading(false);
    });
    return () => { active = false; };
  }, [period]);

  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio/metricas", title: "Métricas" },
    mode: period === "week" ? "weekly_metrics" : "monthly_metrics",
    visibleEntities: (metrics?.topProducts ?? []).map((item, index) => ({
      type: "business_metric_product",
      id: item.catalogItemId,
      name: item.name,
      position: index + 1,
      facts: [
        { label: "Unidades vendidas", value: item.units },
        { label: "Facturación", value: item.revenue },
        ...(item.kilograms !== null ? [{ label: "Kilogramos", value: item.kilograms }] : []),
      ],
    })),
    pageData: { kind: "pageFacts", facts: metrics ? [
      { label: "Período", value: period === "week" ? "Semana actual" : "Mes actual" },
      { label: "Facturación", value: metrics.revenue },
      { label: "Ventas", value: metrics.salesCount },
      { label: "Ticket promedio", value: metrics.averageTicket },
      { label: "Unidades vendidas", value: metrics.unitsSold },
      { label: "Kilogramos de productos con peso configurado", value: metrics.filamentKilograms },
    ] : [] },
    uiState: { loading, activeTab: period === "week" ? "Semana" : "Mes" },
  }), [loading, metrics, period]);
  usePublishStampyScreenContext(stampyContext);

  return <div className="pb-28">
    <Link href="/mi-negocio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white"><ArrowLeft size={14} /> Mi Negocio</Link>
    <SectionTitle eyebrow="Mi Negocio" title="Métricas" action={<div className="flex w-full rounded-xl border border-stampa-border bg-stampa-surface p-1 sm:w-auto"><button type="button" onClick={() => { if (period !== "week") { setLoading(true); setPeriod("week"); } }} className={`min-h-10 flex-1 rounded-lg px-4 text-xs font-bold ${period === "week" ? "bg-stampa-orange text-white" : "text-gray-500"}`}>Semana</button><button type="button" onClick={() => { if (period !== "month") { setLoading(true); setPeriod("month"); } }} className={`min-h-10 flex-1 rounded-lg px-4 text-xs font-bold ${period === "month" ? "bg-stampa-orange text-white" : "text-gray-500"}`}>Mes</button></div>} />
    <p className="mb-6 max-w-2xl text-sm leading-6 text-gray-400">Una vista simple de las ventas completadas. Las ventas anuladas y los pedidos reembolsados no cuentan.</p>
    {error && <Card className="mb-5 border-red-500/25 p-4 text-sm text-red-300">No se pudieron cargar las métricas: {error}</Card>}
    {loading ? <div className="flex min-h-56 items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div> : metrics && <>
      <div className="grid gap-3 min-[390px]:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4"><BadgeDollarSign size={20} className="text-stampa-orange" /><p className="mt-3 text-xs text-gray-500">Facturación</p><p className="mt-1 text-xl font-black text-white">{money.format(metrics.revenue)}</p><div className="mt-2"><Comparison value={metrics.comparison.revenuePercent} /></div></Card>
        <Card className="p-4"><ReceiptText size={20} className="text-cyan-300" /><p className="mt-3 text-xs text-gray-500">Ventas</p><p className="mt-1 text-xl font-black text-white">{metrics.salesCount}</p><div className="mt-2"><Comparison value={metrics.comparison.salesPercent} /></div></Card>
        <Card className="p-4"><ShoppingBag size={20} className="text-violet-300" /><p className="mt-3 text-xs text-gray-500">Ticket promedio</p><p className="mt-1 text-xl font-black text-white">{money.format(metrics.averageTicket)}</p></Card>
        <Card className="p-4"><Boxes size={20} className="text-emerald-300" /><p className="mt-3 text-xs text-gray-500">Productos vendidos</p><p className="mt-1 text-xl font-black text-white">{metrics.unitsSold} u.</p>{metrics.filamentKilograms > 0 && <p className="mt-2 text-xs font-bold text-emerald-300">{metrics.filamentKilograms.toLocaleString("es-AR")} kg con peso configurado</p>}</Card>
      </div>
      <section className="mt-7"><h2 className="font-black text-white">Productos más vendidos</h2><p className="mt-1 text-xs text-gray-500">Top 5 del período seleccionado.</p>{metrics.topProducts.length === 0 ? <Card className="mt-3 p-8 text-center text-sm text-gray-500">Todavía no hay ventas completadas en este período.</Card> : <div className="mt-3 grid gap-3">{metrics.topProducts.map((item, index) => <Card key={item.catalogItemId} className="grid gap-3 p-4 min-[390px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[390px]:items-center"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-stampa-orange/10 text-sm font-black text-stampa-orange">{index + 1}</span><div className="min-w-0"><p className="truncate text-sm font-black text-white">{item.name}</p><p className="mt-1 text-xs text-gray-500">{item.units} u.{item.kilograms !== null ? ` · ${item.kilograms.toLocaleString("es-AR")} kg` : ""}</p></div><p className="text-sm font-black text-white min-[390px]:text-right">{money.format(item.revenue)}</p></Card>)}</div>}</section>
    </>}
  </div>;
}
