"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, Loader2, PackageCheck, Settings2, ShoppingBasket, X } from "lucide-react";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { SectionTitle } from "@/components/ui/section-title";
import { useAppFeedback } from "@/components/ui/app-feedback";
import {
  calculatePurchaseSuggestion,
  calculateShowroomReplenishment,
  getBusinessPeriodLabel,
  soldWeightKg,
  type BusinessInventoryPeriod,
  type BusinessReplenishmentItem,
  type BusinessReplenishmentWorkspace,
} from "@/lib/business/replenishment";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import {
  configureBusinessLocationsAction,
  loadBusinessReplenishmentAction,
  replenishBusinessShowroomAction,
  saveBusinessInventoryPolicyAction,
} from "../actions";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

function optionalInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

export default function ReposicionPage() {
  const { toast } = useAppFeedback();
  const [tab, setTab] = useState<"showroom" | "purchases">("showroom");
  const [period, setPeriod] = useState<BusinessInventoryPeriod>("week");
  const [workspace, setWorkspace] = useState<BusinessReplenishmentWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activationOpen, setActivationOpen] = useState(false);
  const [initialLocation, setInitialLocation] = useState<"warehouse" | "showroom">("warehouse");
  const [configuring, setConfiguring] = useState(false);
  const [editing, setEditing] = useState<BusinessReplenishmentItem | null>(null);
  const [target, setTarget] = useState("");
  const [minimum, setMinimum] = useState("");
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [replenishingId, setReplenishingId] = useState<string | null>(null);
  const operationRef = useRef<string | null>(null);

  const load = useCallback(async (selectedPeriod: BusinessInventoryPeriod) => {
    setLoading(true);
    const result = await loadBusinessReplenishmentAction(selectedPeriod);
    if (result.success) { setWorkspace(result.workspace); setError(null); }
    else { setWorkspace(null); setError(result.error); }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void loadBusinessReplenishmentAction(period).then((result) => {
      if (!active) return;
      if (result.success) { setWorkspace(result.workspace); setError(null); }
      else { setWorkspace(null); setError(result.error); }
      setLoading(false);
    });
    return () => { active = false; };
  }, [period]);

  const suggestions = useMemo(() => (workspace?.items ?? []).flatMap((item) => {
    const replenishment = calculateShowroomReplenishment(item);
    return replenishment.needed > 0 ? [{ item, ...replenishment }] : [];
  }).sort((a, b) => b.needed - a.needed), [workspace]);
  const movableSuggestions = suggestions.filter((suggestion) => suggestion.movable > 0);
  const bulkUnits = movableSuggestions.reduce((sum, suggestion) => sum + suggestion.movable, 0);

  const purchaseRows = useMemo(() => (workspace?.items ?? []).map((item) => ({
    item,
    purchase: calculatePurchaseSuggestion(item.stockMinimum, item.totalStock),
    kilograms: soldWeightKg(item.soldUnits, item.unitWeightGrams),
  })).sort((a, b) => b.item.soldUnits - a.item.soldUnits), [workspace]);
  const invoiced = purchaseRows.reduce((sum, row) => sum + row.item.soldTotal, 0);
  const filamentKg = purchaseRows.reduce((sum, row) => sum + (row.kilograms ?? 0), 0);
  const otherUnits = purchaseRows.reduce((sum, row) => sum + (row.kilograms === null ? row.item.soldUnits : 0), 0);

  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio/reposicion", title: "Reposición" },
    mode: tab === "showroom" ? "showroom_replenishment" : "purchase_summary",
    visibleEntities: tab === "showroom"
      ? suggestions.slice(0, 20).map((row, index) => ({ type: "business_replenishment_item", id: row.item.catalogItemId, name: row.item.name, position: index + 1, facts: [{ label: "Showroom", value: row.item.showroom }, { label: "Depósito", value: row.item.warehouse }, { label: "Reposición sugerida", value: row.movable }] }))
      : purchaseRows.slice(0, 20).map((row, index) => ({ type: "business_replenishment_item", id: row.item.catalogItemId, name: row.item.name, position: index + 1, facts: [{ label: "Vendidas", value: row.item.soldUnits }, { label: "Stock total", value: row.item.totalStock }, { label: "Compra sugerida", value: row.purchase ?? "Sin mínimo" }] })),
    pageData: { kind: "pageFacts", facts: tab === "showroom"
      ? [{ label: "Productos para reponer", value: suggestions.length }, { label: "Unidades que pueden moverse", value: bulkUnits }]
      : [{ label: "Período", value: getBusinessPeriodLabel(period) }, { label: "Facturado", value: invoiced }, { label: "Kilogramos vendidos", value: filamentKg }, { label: "Otros productos vendidos", value: otherUnits }] },
    uiState: { loading, activeTab: tab === "showroom" ? "Showroom" : "Compras" },
  }), [bulkUnits, filamentKg, invoiced, loading, otherUnits, period, purchaseRows, suggestions, tab]);
  usePublishStampyScreenContext(stampyContext);

  const activate = async (location: "warehouse" | "showroom" | "keep" = initialLocation) => {
    setConfiguring(true);
    const result = await configureBusinessLocationsAction({ enabled: true, initialLocation: location });
    setConfiguring(false);
    if (!result.success) return toast.error(result.error);
    toast.success("Showroom configurado sin cambiar tu stock total.");
    setActivationOpen(false); setLoading(true); await load(period);
  };

  const disable = async () => {
    setConfiguring(true);
    const result = await configureBusinessLocationsAction({ enabled: false });
    setConfiguring(false);
    if (!result.success) return toast.error(result.error);
    toast.success("Showroom desactivado. Catálogo y Venta rápida vuelven al stock total.");
    setLoading(true); await load(period);
  };

  const openPolicy = (item: BusinessReplenishmentItem) => {
    setEditing(item); setTarget(item.showroomTarget?.toString() ?? ""); setMinimum(item.stockMinimum?.toString() ?? ""); setWeight(item.unitWeightGrams?.toString() ?? "");
  };

  const savePolicy = async () => {
    if (!editing) return;
    const showroomTarget = optionalInteger(target); const stockMinimum = optionalInteger(minimum); const unitWeightGrams = optionalInteger(weight);
    if ([showroomTarget, stockMinimum, unitWeightGrams].some(Number.isNaN)) return toast.error("Usá números enteros positivos o dejá el campo vacío.");
    setSaving(true);
    const result = await saveBusinessInventoryPolicyAction({ catalogItemId: editing.catalogItemId, showroomTarget, stockMinimum, unitWeightGrams });
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success("Configuración guardada."); setEditing(null); setLoading(true); await load(period);
  };

  const replenish = async (ids: string[]) => {
    operationRef.current ??= crypto.randomUUID();
    setReplenishingId(ids.length === 1 ? ids[0] : "bulk");
    const result = await replenishBusinessShowroomAction({ catalogItemIds: ids, idempotencyKey: operationRef.current });
    setReplenishingId(null);
    if (!result.success) return toast.error(result.error);
    toast.success(`${result.movedUnits} unidades movidas al showroom${result.replayed ? " (ya aplicado)" : ""}.`);
    operationRef.current = null; setBulkOpen(false); setLoading(true); await load(period);
  };

  return <div className="pb-28">
    <Link href="/mi-negocio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white"><ArrowLeft size={14} /> Mi Negocio</Link>
    <SectionTitle eyebrow="Mi Negocio" title="Reposición" action={workspace?.enabled ? <button type="button" onClick={() => void disable()} disabled={configuring} className="min-h-10 rounded-xl border border-stampa-border px-3 text-xs font-bold text-gray-400 hover:text-white disabled:opacity-50">Desactivar showroom</button> : undefined} />
    <p className="mb-6 max-w-2xl text-sm leading-6 text-gray-400">Mové lo necesario al lugar donde vendés y revisá tus compras sin convertir el inventario en algo complicado.</p>
    {error && <Card className="mb-5 border-red-500/25 p-4 text-sm text-red-300">No se pudo cargar Reposición: {error}</Card>}
    {loading ? <div className="flex min-h-56 items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div> : !workspace?.enabled ? <Card className="mx-auto max-w-2xl p-7 text-center sm:p-10"><Boxes size={34} className="mx-auto text-stampa-orange" /><h2 className="mt-4 text-xl font-black text-white">¿Tenés mercadería exhibida y stock guardado?</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-gray-400">Stampa puede decirte qué llevar del depósito al showroom cada día. Si no lo necesitás, Catálogo y Venta rápida siguen funcionando como siempre.</p><button type="button" disabled={configuring} onClick={() => workspace?.initialized ? void activate("keep") : setActivationOpen(true)} className="mt-6 min-h-12 rounded-xl bg-stampa-orange px-6 text-sm font-black text-white disabled:opacity-50">{workspace?.initialized ? "Volver a activar showroom" : "Configurar showroom"}</button></Card> : <>
      <div className="mb-5 grid grid-cols-2 rounded-xl border border-stampa-border bg-stampa-surface p-1"><button onClick={() => setTab("showroom")} className={`min-h-11 rounded-lg text-sm font-bold ${tab === "showroom" ? "bg-stampa-orange text-white" : "text-gray-400"}`}>Showroom</button><button onClick={() => setTab("purchases")} className={`min-h-11 rounded-lg text-sm font-bold ${tab === "purchases" ? "bg-stampa-orange text-white" : "text-gray-400"}`}>Compras</button></div>
      {tab === "showroom" ? <section>
        <div className="mb-4 flex flex-col gap-3 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between"><div><h2 className="font-black text-white">Para reponer hoy</h2><p className="mt-1 text-xs text-gray-500">Sólo aparecen productos con objetivo pendiente.</p></div>{movableSuggestions.length > 0 && <button onClick={() => setBulkOpen(true)} className="min-h-11 rounded-xl bg-stampa-orange px-4 text-sm font-black text-white">Reponer todo</button>}</div>
        {suggestions.length === 0 ? <Card className="p-8 text-center"><PackageCheck className="mx-auto text-emerald-300" /><p className="mt-3 font-bold text-white">El showroom está completo</p><p className="mt-1 text-sm text-gray-500">O todavía no definiste objetivos para tus productos.</p></Card> : <div className="grid gap-3 lg:grid-cols-2">{suggestions.map(({ item, movable, remainingShortage }) => <Card key={item.catalogItemId} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-black text-white">{item.name}</h3><p className="mt-1 text-xs text-gray-500">Showroom {item.showroom} / {item.showroomTarget} · Depósito {item.warehouse}</p></div><button onClick={() => openPolicy(item)} aria-label={`Configurar ${item.name}`} className="rounded-lg p-2 text-gray-500 hover:bg-white/5"><Settings2 size={16} /></button></div><div className="mt-4 flex items-end justify-between gap-4"><div><p className="text-xs text-gray-500">Mover</p><p className="text-2xl font-black text-stampa-orange">{movable} u.</p>{remainingShortage > 0 && <p className="mt-1 text-xs text-amber-300">Faltan {remainingShortage} para completar</p>}</div><button disabled={movable === 0 || replenishingId !== null} onClick={() => { operationRef.current=null; void replenish([item.catalogItemId]); }} className="min-h-11 rounded-xl border border-stampa-orange/40 bg-stampa-orange/10 px-4 text-xs font-black text-orange-200 disabled:opacity-40">{replenishingId === item.catalogItemId ? "Reponiendo..." : "Reponer"}</button></div></Card>)}</div>}
        <div className="mt-5"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Configurar objetivos</p><div className="flex flex-wrap gap-2">{workspace.items.map((item) => <button key={item.catalogItemId} onClick={() => openPolicy(item)} className="rounded-lg border border-stampa-border px-3 py-2 text-xs text-gray-400 hover:text-white">{item.name}{item.showroomTarget === null ? " · definir objetivo" : ` · objetivo ${item.showroomTarget}`}</button>)}</div></div>
      </section> : <section>
        <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-black text-white">{getBusinessPeriodLabel(period)}</h2><p className="mt-1 text-xs text-gray-500">Ventas completadas · lunes a domingo · {workspace.timezone}</p></div><div className="flex rounded-lg border border-stampa-border p-1"><button onClick={() => { setLoading(true); setPeriod("week"); }} className={`rounded-md px-3 py-2 text-xs font-bold ${period === "week" ? "bg-white/10 text-white" : "text-gray-500"}`}>Semana</button><button onClick={() => { setLoading(true); setPeriod("month"); }} className={`rounded-md px-3 py-2 text-xs font-bold ${period === "month" ? "bg-white/10 text-white" : "text-gray-500"}`}>Mes</button></div></div>
        <div className="mb-4 grid gap-3 sm:grid-cols-3"><Card className="p-4"><p className="text-xs text-gray-500">Filamento vendido</p><p className="mt-1 text-xl font-black text-white">{filamentKg.toLocaleString("es-AR")} kg</p></Card><Card className="p-4"><p className="text-xs text-gray-500">Otros productos</p><p className="mt-1 text-xl font-black text-white">{otherUnits} u.</p></Card><Card className="p-4"><p className="text-xs text-gray-500">Facturado</p><p className="mt-1 text-xl font-black text-white">{money.format(invoiced)}</p></Card></div>
        <div className="grid gap-3">{purchaseRows.map(({ item, purchase, kilograms }) => <Card key={item.catalogItemId} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(7rem,0.7fr))_auto] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-black text-white">{item.name}</p><p className="text-xs text-gray-500">{item.category}</p></div><div><p className="text-[10px] uppercase text-gray-500">Vendiste</p><p className="text-sm font-bold text-gray-200">{kilograms === null ? `${item.soldUnits} u.` : `${kilograms.toLocaleString("es-AR")} kg`}</p></div><div><p className="text-[10px] uppercase text-gray-500">Stock total</p><p className="text-sm font-bold text-gray-200">{item.totalStock} u.</p></div><div><p className="text-[10px] uppercase text-gray-500">Sugerencia</p><p className={`text-sm font-bold ${purchase && purchase > 0 ? "text-amber-300" : "text-emerald-300"}`}>{purchase === null ? "Sin mínimo" : purchase > 0 ? `Comprar ${purchase}` : "No hace falta"}</p></div><button onClick={() => openPolicy(item)} className="min-h-9 rounded-lg border border-stampa-border px-3 text-xs font-bold text-gray-400">Configurar</button></Card>)}</div>
      </section>}
    </>}

    <Dialog open={activationOpen} onClose={() => setActivationOpen(false)} labelledBy="activate-showroom-title" panelClassName="max-w-lg rounded-2xl border border-stampa-border bg-stampa-surface"><div className="flex items-start justify-between border-b border-stampa-border p-5"><div><h2 id="activate-showroom-title" className="text-lg font-black text-white">¿Dónde está tu stock actual?</h2><p className="mt-1 text-sm text-gray-500">Lo ubicamos sin sumar ni quitar unidades.</p></div><button onClick={() => setActivationOpen(false)} className="p-2 text-gray-500"><X size={18} /></button></div><div className="grid gap-3 p-5"><button onClick={() => setInitialLocation("warehouse")} className={`rounded-xl border p-4 text-left ${initialLocation === "warehouse" ? "border-stampa-orange bg-stampa-orange/10" : "border-stampa-border"}`}><p className="font-bold text-white">Todo en depósito</p><p className="mt-1 text-xs text-gray-500">La opción habitual para empezar a reponer.</p></button><button onClick={() => setInitialLocation("showroom")} className={`rounded-xl border p-4 text-left ${initialLocation === "showroom" ? "border-stampa-orange bg-stampa-orange/10" : "border-stampa-border"}`}><p className="font-bold text-white">Todo en showroom</p><p className="mt-1 text-xs text-gray-500">Si hoy toda la mercadería está exhibida.</p></button><button disabled={configuring} onClick={() => void activate()} className="mt-2 min-h-12 rounded-xl bg-stampa-orange text-sm font-black text-white disabled:opacity-50">{configuring ? "Configurando..." : "Activar showroom"}</button></div></Dialog>

    <Dialog open={editing !== null} onClose={() => setEditing(null)} labelledBy="policy-title" panelClassName="max-w-lg rounded-2xl border border-stampa-border bg-stampa-surface">{editing && <><div className="flex items-start justify-between border-b border-stampa-border p-5"><div><h2 id="policy-title" className="font-black text-white">{editing.name}</h2><p className="mt-1 text-xs text-gray-500">Cada dato es opcional y cumple una función distinta.</p></div><button onClick={() => setEditing(null)} className="p-2 text-gray-500"><X size={18} /></button></div><div className="space-y-4 p-5"><label className="block text-xs font-bold text-gray-300">Objetivo showroom<input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Ej.: 6" className="mt-1.5 min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 text-white" /><span className="mt-1 block font-normal text-gray-500">Cuántas unidades querés exhibir.</span></label><label className="block text-xs font-bold text-gray-300">Stock mínimo<input inputMode="numeric" value={minimum} onChange={(e) => setMinimum(e.target.value)} placeholder="Ej.: 10" className="mt-1.5 min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 text-white" /><span className="mt-1 block font-normal text-gray-500">Reserva total que querés conservar.</span></label><label className="block text-xs font-bold text-gray-300">Peso por unidad en gramos<input inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Ej.: 1000" className="mt-1.5 min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 text-white" /><span className="mt-1 block font-normal text-gray-500">Sólo si querés ver equivalencias en kg.</span></label><button disabled={saving} onClick={() => void savePolicy()} className="min-h-12 w-full rounded-xl bg-stampa-orange text-sm font-black text-white disabled:opacity-50">{saving ? "Guardando..." : "Guardar"}</button></div></>}</Dialog>

    <Dialog open={bulkOpen} onClose={() => setBulkOpen(false)} labelledBy="bulk-title" panelClassName="max-w-md rounded-2xl border border-stampa-border bg-stampa-surface"><div className="p-5"><ShoppingBasket className="text-stampa-orange" /><h2 id="bulk-title" className="mt-3 text-lg font-black text-white">Confirmar reposición</h2><p className="mt-2 text-sm text-gray-400">Vas a mover <strong className="text-white">{bulkUnits} unidades</strong> de <strong className="text-white">{movableSuggestions.length} productos</strong> al showroom.</p><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={() => setBulkOpen(false)} className="min-h-11 rounded-xl border border-stampa-border text-sm font-bold text-gray-300">Cancelar</button><button disabled={replenishingId !== null} onClick={() => { operationRef.current=null; void replenish(movableSuggestions.map(({ item }) => item.catalogItemId)); }} className="min-h-11 rounded-xl bg-stampa-orange text-sm font-black text-white disabled:opacity-50">Confirmar</button></div></div></Dialog>
  </div>;
}
