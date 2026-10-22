"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Barcode,
  ChartNoAxesCombined,
  FileText,
  PackageCheck,
  ReceiptText,
  RefreshCcw,
  RefreshCw,
  ShoppingBag,
  Store,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { PageHeader, Panel, PanelEmpty, StatCard } from "@/components/ui/dashboard";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import type { BusinessMetrics } from "@/lib/business/metrics";
import type { BusinessOrderSummary } from "@/lib/business/orders";
import type { BusinessSaleSummary } from "@/lib/business/catalog";
import type { BusinessInventoryPeriod } from "@/lib/business/replenishment";
import {
  buildBusinessAlerts,
  formatComparison,
  recentSales,
  summarizePendingOrders,
  type PendingOrdersSummary,
} from "@/lib/business/dashboard";
import {
  loadBusinessMetricsAction,
  loadBusinessOrdersAction,
  loadBusinessSalesAction,
} from "@/app/mi-negocio/actions";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const moneyPrecise = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

interface BusinessTool {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

/** Las nueve herramientas originales, agrupadas por tarea. */
export const BUSINESS_TOOL_GROUPS: { title: string; tools: BusinessTool[] }[] = [
  {
    title: "Vender",
    tools: [
      { href: "/mi-negocio/venta-rapida", title: "Venta rápida", description: "Escaneá o buscá y confirmá la venta.", icon: Barcode },
      { href: "/mi-negocio/ventas", title: "Ventas", description: "Operaciones registradas y anulaciones.", icon: ReceiptText },
      { href: "/presupuestos", title: "Presupuestos", description: "Propuestas rápidas o profesionales.", icon: FileText },
      { href: "/mi-negocio/clientes", title: "Clientes", description: "Historial, cuenta corriente y cobros.", icon: Users },
    ],
  },
  {
    title: "Catálogo y stock comercial",
    tools: [
      { href: "/mi-negocio/catalogo", title: "Catálogo", description: "Fabricados y reventa, sin mezclar recetas.", icon: ShoppingBag },
      { href: "/mi-negocio/reposicion", title: "Reposición", description: "Showroom y compras a proveedor.", icon: RefreshCcw },
    ],
  },
  {
    title: "Venta online",
    tools: [
      { href: "/mi-negocio/tienda", title: "Mi Tienda", description: "Tu vidriera pública.", icon: Store },
      { href: "/mi-negocio/pedidos", title: "Pedidos online", description: "Pagos y pedidos de tu tienda.", icon: PackageCheck },
    ],
  },
  {
    title: "Analizar",
    tools: [
      { href: "/mi-negocio/metricas", title: "Métricas", description: "Facturación, ticket y más vendidos.", icon: ChartNoAxesCombined },
    ],
  },
];

type Loadable<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

export interface BusinessDashboardData {
  metrics: Loadable<BusinessMetrics>;
  sales: Loadable<BusinessSaleSummary[]>;
  pending: Loadable<PendingOrdersSummary>;
}

/** Portada de Mi Negocio: reutiliza las server actions existentes (mismas consultas y autorización). */
export function BusinessDashboard() {
  const [period, setPeriod] = useState<BusinessInventoryPeriod>("week");
  const [metrics, setMetrics] = useState<Loadable<BusinessMetrics>>({ status: "loading" });
  const [sales, setSales] = useState<Loadable<BusinessSaleSummary[]>>({ status: "loading" });
  const [pending, setPending] = useState<Loadable<PendingOrdersSummary>>({ status: "loading" });

  const loadMetrics = useCallback(async (selected: BusinessInventoryPeriod) => {
    setMetrics({ status: "loading" });
    const result = await loadBusinessMetricsAction(selected);
    setMetrics(result.success ? { status: "ready", data: result.metrics } : { status: "error", message: result.error });
  }, []);

  const loadActivity = useCallback(async () => {
    setSales({ status: "loading" });
    setPending({ status: "loading" });
    const [salesResult, ordersResult] = await Promise.all([loadBusinessSalesAction(), loadBusinessOrdersAction()]);
    setSales(salesResult.success ? { status: "ready", data: salesResult.sales } : { status: "error", message: salesResult.error });
    setPending(
      ordersResult.success
        ? { status: "ready", data: summarizePendingOrders(ordersResult.orders as BusinessOrderSummary[]) }
        : { status: "error", message: ordersResult.error },
    );
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadMetrics(period));
  }, [loadMetrics, period]);

  useEffect(() => {
    void Promise.resolve().then(loadActivity);
  }, [loadActivity]);

  const metricsData = metrics.status === "ready" ? metrics.data : null;
  const pendingData = pending.status === "ready" ? pending.data : null;
  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio", title: "Mi Negocio" },
    mode: "hub",
    visibleEntities: BUSINESS_TOOL_GROUPS.flatMap((group) => group.tools).map((tool, index) => ({
      type: "business_area",
      id: tool.title.toLowerCase(),
      name: tool.title,
      position: index + 1,
    })),
    pageData: {
      kind: "pageFacts",
      facts: [
        { label: "Período", value: period === "week" ? "Semana actual" : "Mes actual" },
        ...(metricsData
          ? [
              { label: "Facturación del período (ventas confirmadas)", value: metricsData.revenue },
              { label: "Ventas del período", value: metricsData.salesCount },
              { label: "Ticket promedio", value: metricsData.averageTicket },
            ]
          : []),
        ...(pendingData ? [{ label: "Pedidos online pendientes (no son ventas)", value: pendingData.total }] : []),
        { label: "Áreas disponibles", value: "Catálogo, Venta rápida, Ventas, Clientes, Reposición, Métricas, Presupuestos, Mi Tienda y Pedidos online" },
      ],
    },
    uiState: { loading: metrics.status === "loading", activeTab: period === "week" ? "Semana" : "Mes" },
  }), [metrics.status, metricsData, pendingData, period]);
  usePublishStampyScreenContext(stampyContext);

  return (
    <BusinessDashboardView
      period={period}
      onPeriodChange={setPeriod}
      data={{ metrics, sales, pending }}
      onRetry={() => {
        void loadMetrics(period);
        void loadActivity();
      }}
    />
  );
}

export function BusinessDashboardView({
  period,
  onPeriodChange,
  data,
  onRetry,
}: {
  period: BusinessInventoryPeriod;
  onPeriodChange: (period: BusinessInventoryPeriod) => void;
  data: BusinessDashboardData;
  onRetry: () => void;
}) {
  const metrics = data.metrics.status === "ready" ? data.metrics.data : null;
  const pending = data.pending.status === "ready" ? data.pending.data : null;
  const sales = data.sales.status === "ready" ? data.sales.data : null;
  const metricsLoading = data.metrics.status === "loading";
  const anyError = data.metrics.status === "error" || data.sales.status === "error" || data.pending.status === "error";
  const comparison = formatComparison(metrics?.comparison.revenuePercent);
  const alerts = buildBusinessAlerts({ metrics, pending, formatMoney: (value) => moneyPrecise.format(value) });
  const latestSales = sales ? recentSales(sales) : [];
  const hasNoActivity = sales !== null && sales.length === 0 && pending !== null && pending.total === 0;
  const periodLabel = period === "week" ? "esta semana" : "este mes";

  return (
    <div className="pb-24">
      <PageHeader
        title="Mi Negocio"
        description="Ventas, clientes, pedidos y facturación. La producción y el stock fabricado siguen en Mi Taller."
        actions={
          <div role="group" aria-label="Período" className="flex rounded-xl border border-stampa-border bg-stampa-surface p-1">
            {(["week", "month"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => onPeriodChange(value)}
                className={`min-h-9 rounded-lg px-4 text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange ${
                  period === value ? "bg-stampa-orange text-neutral-950" : "text-gray-400 hover:text-white"
                }`}
              >
                {value === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
        }
      />

      {anyError && (
        <div role="alert" className="mb-4 flex flex-col gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between">
          <span>Parte del resumen no se pudo cargar. Las herramientas siguen disponibles.</span>
          <button type="button" onClick={onRetry} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-400/30 px-3 text-xs font-bold text-red-100 hover:bg-red-500/10">
            <RefreshCw size={14} aria-hidden="true" /> Reintentar
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ventas del período" value={metrics?.salesCount ?? "—"} hint={`Confirmadas ${periodLabel}`} icon={ReceiptText} href="/mi-negocio/ventas" loading={metricsLoading} />
        <StatCard
          label="Facturación"
          value={metrics ? money.format(metrics.revenue) : "—"}
          hint={comparison ? (
            <span className={`inline-flex items-center gap-1 ${comparison.tone === "up" ? "text-emerald-400" : comparison.tone === "down" ? "text-red-300" : ""}`}>
              {comparison.tone === "up" && <TrendingUp size={12} aria-hidden="true" />}
              {comparison.tone === "down" && <TrendingDown size={12} aria-hidden="true" />}
              {comparison.label}
            </span>
          ) : "Sin anuladas ni pedidos pendientes"}
          icon={Wallet}
          tone="green"
          href="/mi-negocio/metricas"
          loading={metricsLoading}
        />
        <StatCard
          label="Pedidos pendientes"
          value={pending?.total ?? "—"}
          hint="Esperando pago o revisión"
          icon={PackageCheck}
          tone={pending && pending.paymentReview > 0 ? "red" : pending && pending.total > 0 ? "orange" : "neutral"}
          href="/mi-negocio/pedidos"
          loading={data.pending.status === "loading"}
        />
        <StatCard label="Ticket promedio" value={metrics ? money.format(metrics.averageTicket) : "—"} hint={`Por venta ${periodLabel}`} icon={ChartNoAxesCombined} href="/mi-negocio/metricas" loading={metricsLoading} />
      </div>

      <nav aria-label="Acciones rápidas" className="mt-4 grid grid-cols-3 gap-2">
        <QuickAction href="/mi-negocio/venta-rapida" icon={Barcode} label="Venta rápida" primary />
        <QuickAction href="/presupuestos?action=new" icon={FileText} label="Nuevo presupuesto" />
        <QuickAction href="/mi-negocio/pedidos" icon={PackageCheck} label="Consultar pedidos" />
      </nav>

      {hasNoActivity ? (
        <section className="mt-5 rounded-2xl border border-stampa-orange/20 bg-gradient-to-br from-stampa-orange/10 to-transparent p-4 sm:p-5" aria-labelledby="business-onboarding-title">
          <h2 id="business-onboarding-title" className="text-base font-bold text-white">Empezá a vender con Stampa</h2>
          <p className="mt-1 text-sm text-gray-400">Todavía no registraste ventas. Estos son los primeros pasos:</p>
          <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <OnboardingStep n={1} href="/mi-negocio/catalogo" title="Armá tu catálogo" text="Vinculá productos de Mi Taller o cargá artículos de reventa." />
            <OnboardingStep n={2} href="/mi-negocio/venta-rapida" title="Registrá una venta" text="Venta rápida descuenta stock y guarda el pago." />
            <OnboardingStep n={3} href="/mi-negocio/tienda" title="Publicá tu tienda" text="Compartí una vidriera con los productos que elijas." />
          </ol>
        </section>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Ventas recientes" icon={ReceiptText} className="lg:col-span-2" action={latestSales.length > 0 ? { href: "/mi-negocio/ventas", label: "Ver todas" } : undefined}>
            {data.sales.status === "loading" ? (
              <RowsSkeleton rows={4} />
            ) : data.sales.status === "error" ? (
              <p className="text-sm text-gray-500">No pudimos cargar las ventas.</p>
            ) : latestSales.length === 0 ? (
              <PanelEmpty action={{ href: "/mi-negocio/venta-rapida", label: "Registrar una venta" }}>Todavía no hay ventas registradas.</PanelEmpty>
            ) : (
              <ul className="divide-y divide-stampa-border">
                {latestSales.map((sale) => {
                  const voided = sale.status === "voided";
                  const firstItem = sale.items[0]?.product_name_snapshot;
                  const more = sale.items.length > 1 ? ` y ${sale.items.length - 1} más` : "";
                  return (
                    <li key={sale.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-semibold ${voided ? "text-gray-500 line-through" : "text-white"}`}>
                          #{sale.sale_number} · {firstItem ? `${firstItem}${more}` : "Venta"}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {shortDate.format(new Date(sale.created_at))}
                          {sale.client_name ? ` · ${sale.client_name}` : ""}
                          {sale.is_online_sale ? " · Online" : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-bold tabular-nums ${voided ? "text-gray-500 line-through" : "text-white"}`}>{moneyPrecise.format(sale.total)}</p>
                        {voided ? (
                          <span className="text-[10px] font-bold uppercase text-gray-500">Anulada</span>
                        ) : sale.debtAmount > 0 ? (
                          <span className="text-[10px] font-bold uppercase text-yellow-300">A cuenta {money.format(sale.debtAmount)}</span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Requiere atención" icon={AlertTriangle}>
            {data.pending.status === "loading" || metricsLoading ? (
              <RowsSkeleton rows={2} />
            ) : alerts.length === 0 ? (
              <p className="rounded-xl bg-emerald-500/5 px-3 py-3 text-sm text-emerald-300">Sin pagos para revisar ni saldos pendientes.</p>
            ) : (
              <ul className="space-y-2">
                {alerts.map((alert) => (
                  <li key={alert.id}>
                    <Link
                      href={alert.href}
                      className={`block rounded-xl border px-3 py-2.5 transition-colors hover:bg-white/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange ${
                        alert.tone === "red" ? "border-red-500/25" : alert.tone === "yellow" ? "border-yellow-500/25" : "border-stampa-border"
                      }`}
                    >
                      <p className={`text-sm font-semibold ${alert.tone === "red" ? "text-red-200" : alert.tone === "yellow" ? "text-yellow-200" : "text-white"}`}>{alert.title}</p>
                      <p className="mt-0.5 text-xs leading-snug text-gray-500">{alert.description}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {pending && pending.list.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-stampa-border pt-3">
                {pending.list.map((order) => (
                  <li key={order.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-gray-300">#{order.order_number} · {order.buyer_name}</span>
                    <span className="shrink-0 tabular-nums text-gray-400">{moneyPrecise.format(order.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Más vendidos ${periodLabel}`} icon={Trophy} className="lg:col-span-1" action={{ href: "/mi-negocio/metricas", label: "Métricas" }}>
            {metricsLoading ? (
              <RowsSkeleton rows={3} />
            ) : !metrics || metrics.topProducts.length === 0 ? (
              <p className="text-sm text-gray-500">Sin ventas confirmadas {periodLabel}.</p>
            ) : (
              <ol className="space-y-2">
                {metrics.topProducts.slice(0, 5).map((product, index) => (
                  <li key={product.catalogItemId} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/5 text-[11px] font-bold text-gray-400">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{product.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">{product.units} u.</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <ToolsPanel className="lg:col-span-2" />
        </div>
      )}

      {hasNoActivity && <ToolsPanel className="mt-4" />}
    </div>
  );
}

function ToolsPanel({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="business-tools-title" className={`min-w-0 rounded-2xl border border-stampa-border bg-stampa-surface p-4 sm:p-5 ${className}`}>
      <h2 id="business-tools-title" className="mb-3 text-sm font-bold text-white">Herramientas</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {BUSINESS_TOOL_GROUPS.map((group) => (
          <div key={group.title} className="min-w-0">
            <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">{group.title}</h3>
            <ul className="space-y-1">
              {group.tools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <li key={tool.href}>
                    <Link href={tool.href} className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stampa-orange/10 text-stampa-orange" aria-hidden="true">
                        <Icon size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-white">{tool.title}</span>
                        <span className="block truncate text-xs text-gray-500">{tool.description}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuickAction({ href, icon: Icon, label, primary = false }: { href: string; icon: LucideIcon; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-center text-xs font-bold leading-tight transition-colors sm:min-h-11 sm:flex-row sm:gap-2 sm:px-3 sm:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange ${
        primary ? "bg-stampa-orange text-neutral-950 hover:bg-stampa-orange-hover" : "border border-stampa-border bg-stampa-surface text-white hover:bg-white/5"
      }`}
    >
      <Icon size={16} aria-hidden="true" /> {label}
    </Link>
  );
}

function OnboardingStep({ n, href, title, text }: { n: number; href: string; title: string; text: string }) {
  return (
    <li>
      <Link href={href} className="block h-full rounded-xl border border-stampa-border bg-stampa-surface p-3 transition-colors hover:border-stampa-orange/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange">
        <span className="block text-sm font-semibold text-white">{n}. {title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-gray-400">{text}</span>
      </Link>
    </li>
  );
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-9 animate-pulse rounded-lg bg-white/5" />
      ))}
    </div>
  );
}
