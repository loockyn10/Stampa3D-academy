"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, PackageCheck, RefreshCw, X } from "lucide-react";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { SectionTitle } from "@/components/ui/section-title";
import type { BusinessOrderSummary } from "@/lib/business/orders";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { loadBusinessOrdersAction } from "../actions";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const dateTime = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });
const labels: Record<string, string> = { awaiting_payment: "Esperando pago", paid: "Pagado", cancelled: "Cancelado", expired: "Vencido", refunded: "Devuelto", partially_refunded: "Devolución parcial", payment_review: "Revisar pago" };

export default function BusinessOrdersPage() {
  const [orders, setOrders] = useState<BusinessOrderSummary[]>([]);
  const [selected, setSelected] = useState<BusinessOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const load = useCallback(async () => {
    setLoading(true); const result = await loadBusinessOrdersAction();
    if (result.success) { setOrders(result.orders); setError(null); } else { setOrders([]); setError(result.error); }
    setLoading(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio/pedidos", title: "Pedidos online" }, mode: selected ? "order_detail" : "orders",
    selectedEntity: selected ? { type: "business_order", id: selected.id, name: `Pedido ${selected.order_number}`, facts: [{ label: "Estado", value: labels[selected.status] || selected.status }, { label: "Total", value: selected.total }] } : null,
    visibleEntities: orders.slice(0, 20).map((order, index) => ({ type: "business_order", id: order.id, name: `Pedido ${order.order_number}`, position: index + 1, facts: [{ label: "Estado", value: labels[order.status] || order.status }, { label: "Total", value: order.total }] })),
    pageData: { kind: "pageFacts", facts: [{ label: "Pedidos visibles", value: orders.length }, { label: "Acciones financieras desde Stampy", value: "No disponibles" }] }, uiState: { loading },
  }), [loading, orders, selected]);
  usePublishStampyScreenContext(stampyContext);
  const visibleOrders = filter === "all" ? orders : orders.filter((order) => order.status === filter);
  return <div className="pb-24"><Link href="/mi-negocio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white"><ArrowLeft size={14} /> Mi Negocio</Link><SectionTitle eyebrow="Mi Negocio" title="Pedidos online" action={<button type="button" onClick={() => void load()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stampa-border px-4 text-xs font-bold text-gray-300"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Actualizar</button>} /><p className="mb-4 text-sm text-gray-400">Pedidos iniciados desde tu tienda. Una venta aparece recién cuando Mercado Pago confirma el pago.</p><label className="mb-6 block w-full max-w-xs text-xs font-bold text-gray-400">Estado<select value={filter} onChange={(event) => setFilter(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-surface px-3 text-sm text-white"><option value="all">Todos</option><option value="awaiting_payment">Esperando pago</option><option value="paid">Pagados</option><option value="payment_review">Requieren revisión</option><option value="expired">Vencidos</option><option value="cancelled">Cancelados</option><option value="refunded">Devueltos</option></select></label>{error && <Card className="mb-5 border-red-500/25 p-4 text-sm text-red-300">{error}</Card>}{loading ? <div className="flex min-h-48 items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div> : orders.length === 0 ? <Card className="p-10 text-center"><PackageCheck className="mx-auto text-stampa-orange" /><h2 className="mt-4 font-bold text-white">Todavía no hay pedidos online</h2></Card> : visibleOrders.length === 0 ? <Card className="p-8 text-center text-sm text-gray-500">No hay pedidos con ese estado.</Card> : <div className="grid gap-3">{visibleOrders.map((order) => <button key={order.id} type="button" onClick={() => setSelected(order)} className="grid gap-3 rounded-2xl border border-stampa-border bg-stampa-surface p-4 text-left sm:grid-cols-[.6fr_1fr_1.4fr_.8fr] sm:items-center"><span><small className="block text-gray-500">Pedido</small><b>#{order.order_number}</b></span><span><small className="block text-gray-500">Fecha</small>{dateTime.format(new Date(order.created_at))}</span><span className="min-w-0"><small className="block text-gray-500">Comprador · estado</small><span className="block truncate">{order.buyer_name} · {labels[order.status] || order.status}</span></span><b className="text-stampa-orange sm:text-right">{money.format(order.total)}</b></button>)}</div>}
    <Dialog open={selected !== null} onClose={() => setSelected(null)} labelledBy="order-detail-title" panelClassName="max-w-xl rounded-2xl border border-stampa-border bg-stampa-surface">{selected && <><div className="flex justify-between border-b border-stampa-border p-5"><div><h2 id="order-detail-title" className="font-bold">Pedido #{selected.order_number}</h2><p className="text-xs text-gray-500">{selected.buyer_name} · {selected.buyer_email}</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Cerrar"><X /></button></div><div className="divide-y divide-stampa-border">{selected.items.map((item) => <div key={item.id} className="flex justify-between p-4 text-sm"><span>{item.quantity} × {item.product_name_snapshot}</span><b>{money.format(item.subtotal)}</b></div>)}</div><div className="flex justify-between border-t border-stampa-border p-5"><span>{labels[selected.status] || selected.status}</span><b className="text-lg">{money.format(selected.total)}</b></div></>}</Dialog>
  </div>;
}
