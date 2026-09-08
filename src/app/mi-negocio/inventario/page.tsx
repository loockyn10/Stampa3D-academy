"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, Factory, History, Loader2, Minus, Plus, RefreshCw, ShoppingBag, X } from "lucide-react";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { SectionTitle } from "@/components/ui/section-title";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { resolveBusinessCatalogStock, type BusinessCatalogItem, type BusinessInventoryMovement, type WorkshopProductSummary } from "@/lib/business/catalog";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { adjustBusinessInventoryAction, loadBusinessOperationsAction } from "../actions";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

export default function InventarioPage() {
  const { toast } = useAppFeedback();
  const [items, setItems] = useState<BusinessCatalogItem[]>([]);
  const [products, setProducts] = useState<WorkshopProductSummary[]>([]);
  const [movements, setMovements] = useState<BusinessInventoryMovement[]>([]);
  const [selected, setSelected] = useState<BusinessCatalogItem | null>(null);
  const [direction, setDirection] = useState<"add" | "subtract">("add");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adjustmentAttemptRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const result = await loadBusinessOperationsAction();
    if (!result.success) { setError(result.error); setItems([]); setProducts([]); setMovements([]); }
    else { setError(null); setItems(result.items); setProducts(result.products); setMovements(result.movements); }
    setLoading(false);
  }, []);
  useEffect(() => {
    let active = true;
    void loadBusinessOperationsAction().then((result) => {
      if (!active) return;
      if (!result.success) { setError(result.error); setItems([]); setProducts([]); setMovements([]); }
      else { setError(null); setItems(result.items); setProducts(result.products); setMovements(result.movements); }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const activeItems = useMemo(() => items.filter((item) => item.is_active), [items]);
  const selectedStock = selected ? resolveBusinessCatalogStock(selected, products) : null;
  const selectedMovements = selected ? movements.filter((movement) => movement.catalog_item_id === selected.id).slice(0, 12) : [];
  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio/inventario", title: "Inventario comercial" }, mode: selected ? "adjust_inventory" : "inventory",
    selectedEntity: selected ? { type: "business_inventory_item", id: selected.id, name: selected.name, facts: [{ label: "Stock", value: resolveBusinessCatalogStock(selected, products) ?? "No disponible" }, { label: "Origen", value: selected.source_type === "manufactured" ? "Fabricado" : "Reventa" }] } : null,
    visibleEntities: items.slice(0, 20).map((item, index) => ({ type: "business_inventory_item", id: item.id, name: item.name, position: index + 1, facts: [{ label: "Origen", value: item.source_type === "manufactured" ? "Fabricado" : "Reventa" }, { label: "Stock", value: resolveBusinessCatalogStock(item, products) ?? "No disponible" }, { label: "Precio", value: Number(item.sale_price) }, { label: "Estado", value: item.is_active ? "Activo" : "Inactivo" }] })),
    formState: selected ? { kind: "formDraft", formType: "inventory_adjustment", fields: [{ label: "Operación", value: direction === "add" ? "Sumar" : "Restar" }, { label: "Cantidad", value: Number(quantity) || 0 }, { label: "Motivo", value: reason || "Sin completar" }] } : null,
    pageData: { kind: "pageFacts", facts: [{ label: "Ítems activos", value: activeItems.length }, { label: "Ítems inactivos", value: items.length - activeItems.length }] }, uiState: { loading, ...(selected ? { activeDialog: "Ajustar inventario" } : {}) },
  }), [activeItems.length, direction, items, loading, products, quantity, reason, selected]);
  usePublishStampyScreenContext(stampyContext);

  const openAdjustment = (item: BusinessCatalogItem) => { setSelected(item); setDirection("add"); setQuantity("1"); setReason(""); adjustmentAttemptRef.current = null; };
  const closeAdjustment = () => { if (!saving) setSelected(null); };
  const saveAdjustment = async () => {
    if (!selected || saving) return;
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount <= 0) return toast.error("Ingresá una cantidad entera mayor a cero.");
    if (!reason.trim()) return toast.error("Indicá el motivo para dejar trazabilidad.");
    if (direction === "subtract" && selectedStock !== null && amount > selectedStock) return toast.error("No hay stock suficiente para ese ajuste.");
    adjustmentAttemptRef.current ??= crypto.randomUUID();
    setSaving(true);
    let result: Awaited<ReturnType<typeof adjustBusinessInventoryAction>>;
    try {
      result = await adjustBusinessInventoryAction({ idempotencyKey: adjustmentAttemptRef.current, catalogItemId: selected.id, quantityDelta: direction === "add" ? amount : -amount, reason });
    } catch {
      setSaving(false);
      toast.error("No recibimos la respuesta. Reintentá: el mismo ajuste no se aplicará dos veces.");
      return;
    }
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success(`Inventario actualizado: ${result.newQuantity} unidades${result.replayed ? " (ajuste ya aplicado)" : ""}.`);
    adjustmentAttemptRef.current = null;
    setSelected(null);
    setLoading(true);
    await load();
  };

  return <div className="pb-24">
    <Link href="/mi-negocio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white"><ArrowLeft size={14} /> Mi Negocio</Link>
    <SectionTitle eyebrow="Mi Negocio" title="Inventario comercial" action={<button type="button" onClick={() => { setLoading(true); void load(); }} disabled={loading} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-stampa-border bg-white/5 px-4 text-xs font-bold text-gray-300 hover:bg-white/10 sm:w-auto"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Actualizar</button>} />
    <p className="mb-6 max-w-3xl text-sm leading-6 text-gray-400">Los fabricados toman unidades terminadas de Stock. Los de reventa usan inventario comercial propio. Todo ajuste manual exige cantidad y motivo.</p>
    {error && <Card className="mb-5 border-red-500/25 p-4 text-sm text-red-300">No se pudo cargar el inventario: {error}</Card>}
    {loading ? <div className="flex min-h-48 items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div> : items.length === 0 && !error ? <Card className="p-10 text-center"><Boxes size={30} className="mx-auto text-stampa-orange" /><h2 className="mt-4 text-lg font-bold text-white">No hay productos en el catálogo</h2><Link href="/mi-negocio/catalogo" className="mt-4 inline-block text-sm font-bold text-stampa-orange">Ir al catálogo →</Link></Card> : <div className="grid gap-3">{items.map((item) => {
      const stock = resolveBusinessCatalogStock(item, products);
      const sourceActive = item.source_type === "resale" || products.some((product) => product.id === item.source_product_id && product.is_active);
      return <Card key={item.id} className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1.5fr)_0.8fr_0.7fr_auto] sm:items-center">
        <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-bold text-white">{item.name}</p><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${item.is_active && sourceActive ? "bg-emerald-500/10 text-emerald-300" : "bg-white/5 text-gray-500"}`}>{item.is_active && sourceActive ? "Activo" : "Inactivo"}</span></div><p className="mt-1 truncate text-xs text-gray-500">{item.sku || "Sin SKU"} · {item.barcode || "Sin código de barras"}</p></div>
        <div className="flex items-center gap-2 text-xs text-gray-300">{item.source_type === "manufactured" ? <Factory size={15} className="text-cyan-300" /> : <ShoppingBag size={15} className="text-violet-300" />}{item.source_type === "manufactured" ? "Fabricado" : "Reventa"}</div>
        <div><p className={`text-lg font-black ${stock === null || stock === 0 ? "text-red-300" : "text-white"}`}>{stock === null ? "—" : `${stock} u.`}</p><p className="text-xs text-gray-500">{money.format(Number(item.sale_price))}</p></div>
        <button type="button" onClick={() => openAdjustment(item)} disabled={stock === null || !item.is_active || !sourceActive} className="min-h-11 rounded-xl border border-stampa-border px-4 text-xs font-bold text-white hover:bg-white/5 disabled:opacity-40">Ajustar</button>
      </Card>;
    })}</div>}

    <Dialog open={selected !== null} onClose={closeAdjustment} labelledBy="inventory-adjustment-title" panelClassName="max-w-lg rounded-2xl border border-stampa-border bg-stampa-surface">
      {selected && <><div className="flex items-start justify-between border-b border-stampa-border p-5"><div><h2 id="inventory-adjustment-title" className="text-lg font-bold text-white">Ajustar {selected.name}</h2><p className="mt-1 text-sm text-gray-500">Stock actual: {selectedStock ?? "no disponible"} unidades</p></div><button type="button" onClick={closeAdjustment} className="rounded-lg p-2 text-gray-500"><X size={18} /></button></div>
      <div className="space-y-4 p-5"><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { setDirection("add"); adjustmentAttemptRef.current = null; }} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-bold ${direction === "add" ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-stampa-border text-gray-400"}`}><Plus size={16} /> Sumar</button><button type="button" onClick={() => { setDirection("subtract"); adjustmentAttemptRef.current = null; }} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-bold ${direction === "subtract" ? "border-red-400/50 bg-red-400/10 text-red-200" : "border-stampa-border text-gray-400"}`}><Minus size={16} /> Restar</button></div>
      <label className="block text-xs font-semibold text-gray-300">Cantidad<input type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(event) => { setQuantity(event.target.value); adjustmentAttemptRef.current = null; }} className="mt-1.5 min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 text-sm text-white" /></label>
      <label className="block text-xs font-semibold text-gray-300">Motivo<textarea value={reason} onChange={(event) => { setReason(event.target.value); adjustmentAttemptRef.current = null; }} maxLength={300} rows={3} placeholder="Ej.: conteo físico, reposición, unidad dañada" className="mt-1.5 w-full resize-none rounded-xl border border-stampa-border bg-stampa-bg-soft p-3 text-sm text-white" /></label>
      <button type="button" disabled={saving} onClick={() => void saveAdjustment()} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-stampa-orange text-sm font-black text-white disabled:opacity-50">{saving && <Loader2 size={16} className="animate-spin" />} Confirmar ajuste</button></div>
      <div className="border-t border-stampa-border p-5"><h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-400"><History size={15} /> Últimos movimientos</h3>{selectedMovements.length === 0 ? <p className="mt-3 text-xs text-gray-500">Sin movimientos comerciales registrados.</p> : <div className="mt-3 max-h-44 space-y-2 overflow-y-auto">{selectedMovements.map((movement) => <div key={movement.id} className="flex items-start justify-between gap-3 rounded-xl bg-white/[0.03] p-3"><div><p className="text-xs font-semibold text-gray-300">{movement.reason || "Movimiento de inventario"}</p><p className="mt-1 text-[11px] text-gray-500">{dateTime.format(new Date(movement.created_at))}</p></div><p className={`text-sm font-black ${movement.quantity_delta > 0 ? "text-emerald-300" : "text-red-300"}`}>{movement.quantity_delta > 0 ? "+" : ""}{movement.quantity_delta}</p></div>)}</div>}</div></>}
    </Dialog>
  </div>;
}
