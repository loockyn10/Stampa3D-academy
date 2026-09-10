"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ReceiptText, RefreshCw, Trash2, X } from "lucide-react";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { SectionTitle } from "@/components/ui/section-title";
import { useAppFeedback } from "@/components/ui/app-feedback";
import type { BusinessSaleSummary } from "@/lib/business/catalog";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { loadBusinessSalesAction, voidBusinessSaleAction } from "../actions";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

export default function VentasPage() {
  const { toast } = useAppFeedback();
  const [sales, setSales] = useState<BusinessSaleSummary[]>([]);
  const [selected, setSelected] = useState<BusinessSaleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("Error / prueba");
  const [voiding, setVoiding] = useState(false);
  const load = useCallback(async () => {
    const result = await loadBusinessSalesAction();
    if (result.success) { setSales(result.sales); setError(null); } else { setSales([]); setError(result.error); }
    setLoading(false);
  }, []);
  useEffect(() => {
    let active = true;
    void loadBusinessSalesAction().then((result) => {
      if (!active) return;
      if (result.success) { setSales(result.sales); setError(null); } else { setSales([]); setError(result.error); }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio/ventas", title: "Ventas" }, mode: selected ? "detail" : "history",
    selectedEntity: selected ? { type: "business_sale", id: selected.id, name: `Venta N.º ${selected.sale_number}`, facts: [{ label: "Total", value: selected.total }, { label: "Cliente", value: selected.client_name ?? "Sin cliente" }, { label: "Estado", value: selected.status }] } : null,
    visibleEntities: sales.slice(0, 20).map((sale, index) => ({ type: "business_sale", id: sale.id, name: `Venta N.º ${sale.sale_number}`, position: index + 1, facts: [{ label: "Total", value: sale.total }, { label: "Ítems", value: sale.items.length }] })),
    pageData: { kind: "pageFacts", facts: [{ label: "Ventas visibles", value: sales.length }] }, uiState: { loading, ...(selected ? { activeDialog: "Detalle de venta" } : {}) },
  }), [loading, sales, selected]);
  usePublishStampyScreenContext(stampyContext);

  const voidSale = async () => {
    if (!selected || voiding) return;
    setVoiding(true);
    const result = await voidBusinessSaleAction({ saleId: selected.id, reason: voidReason });
    setVoiding(false);
    if (!result.success) return toast.error(result.error);
    toast.success(`Venta eliminada. Se restauraron ${result.restoredUnits} unidades.`);
    setVoidDialogOpen(false);
    setSelected(null);
    setLoading(true);
    await load();
  };

  return <div className="pb-24">
    <Link href="/mi-negocio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white"><ArrowLeft size={14} /> Mi Negocio</Link>
    <SectionTitle eyebrow="Mi Negocio" title="Ventas" action={<div className="flex w-full gap-2 sm:w-auto"><Link href="/mi-negocio/venta-rapida" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-stampa-orange px-4 text-xs font-bold text-white">Nueva venta</Link><button type="button" onClick={() => { setLoading(true); void load(); }} className="flex min-h-11 w-11 items-center justify-center rounded-xl border border-stampa-border text-gray-300" aria-label="Actualizar ventas"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button></div>} />
    <p className="mb-6 text-sm leading-6 text-gray-400">Historial de ventas confirmadas con el precio y los productos guardados al momento de la operación.</p>
    {error && <Card className="mb-5 border-red-500/25 p-4 text-sm text-red-300">No se pudieron cargar las ventas: {error}</Card>}
    {loading ? <div className="flex min-h-48 items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div> : sales.length === 0 ? <Card className="p-10 text-center"><ReceiptText size={30} className="mx-auto text-stampa-orange" /><h2 className="mt-4 text-lg font-bold text-white">Todavía no registraste ventas</h2><Link href="/mi-negocio/venta-rapida" className="mt-4 inline-block text-sm font-bold text-stampa-orange">Abrir Venta rápida →</Link></Card> : <div className="grid gap-3">{sales.map((sale) => <button key={sale.id} type="button" onClick={() => setSelected(sale)} className={`grid gap-3 rounded-2xl border border-stampa-border bg-stampa-surface p-4 text-left hover:border-stampa-orange/35 sm:grid-cols-[0.8fr_1fr_1.5fr_0.8fr] sm:items-center ${sale.status === "voided" ? "opacity-55" : ""}`}><span><span className="block text-xs text-gray-500">Número</span><span className="text-sm font-bold text-white">#{sale.sale_number}</span>{sale.status === "voided" && <span className="mt-1 block text-[10px] font-black uppercase text-red-300">Anulada</span>}</span><span><span className="block text-xs text-gray-500">Fecha</span><span className="text-sm text-gray-300">{dateTime.format(new Date(sale.created_at))}</span></span><span className="min-w-0"><span className="block text-xs text-gray-500">Cliente · productos</span><span className="block truncate text-sm text-gray-300">{sale.client_name ?? "Sin cliente"} · {sale.items.reduce((sum, item) => sum + item.quantity, 0)} u.</span></span><span className="sm:text-right"><span className="block text-xs text-gray-500">Total</span><span className="text-sm font-black text-stampa-orange">{money.format(sale.total)}</span></span></button>)}</div>}
    <Dialog open={selected !== null} onClose={() => setSelected(null)} labelledBy="sale-detail-title" panelClassName="max-w-xl rounded-2xl border border-stampa-border bg-stampa-surface">
      {selected && <><div className="flex items-start justify-between gap-4 border-b border-stampa-border p-5"><div><h2 id="sale-detail-title" className="text-lg font-bold text-white">Venta N.º {selected.sale_number}</h2><p className="mt-1 text-sm text-gray-500">{dateTime.format(new Date(selected.created_at))} · {selected.client_name ?? "Sin cliente"}</p></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg p-2 text-gray-500 hover:bg-white/5"><X size={18} /></button></div><div className="divide-y divide-stampa-border">{selected.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 p-4"><div className="min-w-0"><p className="truncate text-sm font-bold text-white">{item.product_name_snapshot}</p><p className="text-xs text-gray-500">{item.quantity} × {money.format(item.unit_price)}</p></div><p className="shrink-0 text-sm font-bold text-white">{money.format(item.subtotal)}</p></div>)}</div>{selected.status === "voided" && <div className="border-t border-red-500/20 bg-red-500/5 px-5 py-3 text-xs text-red-200">Anulada{selected.void_reason ? ` · ${selected.void_reason}` : ""}</div>}<div className="flex items-end justify-between border-t border-stampa-border p-5"><div><p className="text-xs uppercase tracking-wide text-gray-500">Estado</p><p className={`mt-1 text-sm font-bold ${selected.status === "completed" ? "text-emerald-300" : "text-red-300"}`}>{selected.status === "completed" ? "Completada" : "Anulada"}</p></div><div className="text-right"><p className="text-xs text-gray-500">Total</p><p className="text-xl font-black text-white">{money.format(selected.total)}</p></div></div><div className="border-t border-stampa-border p-4"><button type="button" disabled={selected.status === "voided" || selected.is_online_sale} onClick={() => setVoidDialogOpen(true)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 text-sm font-bold text-red-300 disabled:cursor-not-allowed disabled:opacity-45"><Trash2 size={16} /> {selected.status === "voided" ? "Venta ya eliminada" : "Eliminar venta"}</button>{selected.is_online_sale && selected.status !== "voided" && <p className="mt-2 text-center text-xs leading-5 text-amber-200">Esta venta está asociada a un pedido online y no puede eliminarse desde acá.</p>}</div></>}
    </Dialog>
    <Dialog open={voidDialogOpen} onClose={() => setVoidDialogOpen(false)} labelledBy="void-sale-title" panelClassName="max-w-md rounded-2xl border border-stampa-border bg-stampa-surface"><div className="p-5"><Trash2 className="text-red-300" /><h2 id="void-sale-title" className="mt-3 text-lg font-black text-white">¿Eliminar esta venta?</h2><p className="mt-2 text-sm leading-6 text-gray-400">La venta dejará de contar en tus métricas y se restaurará el stock. No se borrará el historial.</p><label className="mt-5 block text-xs font-bold text-gray-300">Motivo<select value={voidReason} onChange={(event) => setVoidReason(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 text-sm text-white"><option>Error / prueba</option><option>Devolución</option><option>Otro</option></select></label><div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => setVoidDialogOpen(false)} className="min-h-11 rounded-xl border border-stampa-border text-sm font-bold text-gray-300">Cancelar</button><button type="button" disabled={voiding} onClick={() => void voidSale()} className="min-h-11 rounded-xl bg-red-500 text-sm font-black text-white disabled:opacity-50">{voiding ? "Eliminando..." : "Eliminar venta"}</button></div></div></Dialog>
  </div>;
}
