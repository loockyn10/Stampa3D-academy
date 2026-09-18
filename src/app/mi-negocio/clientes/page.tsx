"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, HandCoins, Loader2, Pencil, Search, Users, Wallet } from "lucide-react";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { SectionTitle } from "@/components/ui/section-title";
import { useAppFeedback } from "@/components/ui/app-feedback";
import type { BusinessCustomerLedgerMovement, BusinessCustomerOverview, BusinessCustomerRecord } from "@/lib/business/customers";
import type { BusinessSaleSummary } from "@/lib/business/catalog";
import type { SalePaymentMethod } from "@/lib/business/payments";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import {
  loadBusinessClientDetailAction,
  loadBusinessClientsOverviewAction,
  registerCustomerPaymentAction,
  updateBusinessClientAction,
} from "../actions";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });
const INPUT_CLASS = "min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-surface px-3 text-sm text-white outline-none focus:border-stampa-orange";

const MOVEMENT_LABEL: Record<BusinessCustomerLedgerMovement["movement_type"], string> = {
  sale_debt: "Venta a cuenta corriente",
  payment: "Cobro",
  sale_reversal: "Reverso por anulación",
  adjustment: "Ajuste",
};

export default function ClientesPage() {
  const [clients, setClients] = useState<BusinessCustomerOverview[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (term?: string) => {
    const result = await loadBusinessClientsOverviewAction(term);
    if (result.success) { setClients(result.clients); setError(null); } else { setClients([]); setError(result.error); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setLoading(true); void load(search); }, 300);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio/clientes", title: "Clientes" },
    mode: selectedId ? "detail" : "list",
    visibleEntities: clients.slice(0, 20).map((client, index) => ({
      type: "business_client", id: client.clientId, name: client.name, position: index + 1,
      facts: [{ label: "Saldo pendiente", value: client.balance }, { label: "Total comprado", value: client.totalPurchased }],
    })),
    pageData: { kind: "pageFacts", facts: [{ label: "Clientes visibles", value: clients.length }] },
    uiState: { loading, searchQuery: search },
  }), [clients, loading, search, selectedId]);
  usePublishStampyScreenContext(stampyContext);

  return <div className="pb-24">
    <Link href="/mi-negocio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white"><ArrowLeft size={14} /> Mi Negocio</Link>
    <SectionTitle eyebrow="Mi Negocio" title="Clientes" />
    <p className="mb-6 max-w-2xl text-sm leading-6 text-gray-400">Historial de compras y cuenta corriente por cliente.</p>

    <label className="relative mb-5 block max-w-md"><Search className="absolute left-3 top-3.5 text-gray-500" size={17} /><span className="sr-only">Buscar cliente</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, teléfono o email" className={`pl-10 ${INPUT_CLASS}`} /></label>

    {error && <Card className="mb-5 border-red-500/25 p-4 text-sm text-red-300">No se pudieron cargar los clientes: {error}</Card>}
    {loading ? <div className="flex min-h-48 items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div> : clients.length === 0 ? (
      <Card className="p-10 text-center"><Users size={30} className="mx-auto text-stampa-orange" /><h2 className="mt-4 text-lg font-bold text-white">{search ? "No encontramos clientes" : "Todavía no cargaste clientes"}</h2><p className="mt-2 text-sm text-gray-500">Podés crear uno rápido desde Venta rápida.</p></Card>
    ) : (
      <div className="grid gap-3">
        {clients.map((client) => (
          <button key={client.clientId} type="button" onClick={() => setSelectedId(client.clientId)} className="grid gap-2 rounded-2xl border border-stampa-border bg-stampa-surface p-4 text-left hover:border-stampa-orange/35 sm:grid-cols-[1.2fr_1fr_0.8fr_0.8fr] sm:items-center">
            <span><span className="block text-sm font-bold text-white">{client.name}</span>{client.phone && <span className="block text-xs text-gray-500">{client.phone}</span>}</span>
            <span><span className="block text-xs text-gray-500">Última compra</span><span className="text-sm text-gray-300">{client.lastSaleAt ? dateTime.format(new Date(client.lastSaleAt)) : "Sin compras"}</span></span>
            <span><span className="block text-xs text-gray-500">Total comprado</span><span className="text-sm font-bold text-white">{money.format(client.totalPurchased)}</span></span>
            <span><span className="block text-xs text-gray-500">Saldo pendiente</span><span className={`text-sm font-black ${client.balance > 0 ? "text-amber-300" : "text-emerald-300"}`}>{money.format(client.balance)}</span></span>
          </button>
        ))}
      </div>
    )}

    <ClientDetailDialog
      clientId={selectedId}
      onClose={() => setSelectedId(null)}
      onChanged={() => void load(search)}
    />
  </div>;
}

function ClientDetailDialog({ clientId, onClose, onChanged }: { clientId: string | null; onClose: () => void; onChanged: () => void }) {
  const { toast } = useAppFeedback();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<BusinessCustomerRecord | null>(null);
  const [sales, setSales] = useState<BusinessSaleSummary[]>([]);
  const [movements, setMovements] = useState<BusinessCustomerLedgerMovement[]>([]);
  const [balance, setBalance] = useState(0);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    setLoading(true);
    setEditing(false);
    void loadBusinessClientDetailAction(clientId).then((result) => {
      if (!active) return;
      if (result.success) {
        setClient(result.client);
        setSales(result.sales);
        setMovements(result.movements);
        setBalance(result.balance);
        setForm({ name: result.client.name, phone: result.client.phone || "", email: result.client.email || "", notes: result.client.notes || "" });
      } else {
        toast.error(result.error);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [clientId, toast]);

  const totalPurchased = useMemo(() => sales.filter((sale) => sale.status === "completed").reduce((sum, sale) => sum + sale.total, 0), [sales]);
  const lastSaleAt = sales[0]?.created_at ?? null;

  const handleSave = async () => {
    if (!client || !clientId) return;
    if (!form.name.trim()) return toast.error("El nombre del cliente es obligatorio.");
    setSaving(true);
    const result = await updateBusinessClientAction({ clientId, ...form });
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success("Cliente actualizado.");
    setClient({ ...client, name: form.name, phone: form.phone || null, email: form.email || null, notes: form.notes || null });
    setEditing(false);
    onChanged();
  };

  return (
    <Dialog open={clientId !== null} onClose={onClose} labelledBy="client-detail-title" panelClassName="max-w-xl rounded-2xl border border-stampa-border bg-stampa-surface">
      {loading ? <div className="flex min-h-56 items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div> : client && (
        <>
          <div className="flex items-start justify-between gap-4 border-b border-stampa-border p-5">
            <div>
              <h2 id="client-detail-title" className="text-lg font-bold text-white">{client.name}</h2>
              <p className="mt-1 text-sm text-gray-500">{client.phone || "Sin teléfono"} {client.email ? `· ${client.email}` : ""}</p>
            </div>
            <button type="button" onClick={() => setEditing((value) => !value)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-stampa-border px-3 text-xs font-bold text-gray-300 hover:bg-white/5"><Pencil size={13} /> {editing ? "Cancelar" : "Editar"}</button>
          </div>

          {editing ? (
            <div className="grid gap-3 border-b border-stampa-border p-5">
              <label className="block text-xs font-semibold text-gray-400">Nombre *<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={`mt-1.5 ${INPUT_CLASS}`} /></label>
              <label className="block text-xs font-semibold text-gray-400">Teléfono<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={`mt-1.5 ${INPUT_CLASS}`} /></label>
              <label className="block text-xs font-semibold text-gray-400">Email<input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={`mt-1.5 ${INPUT_CLASS}`} /></label>
              <label className="block text-xs font-semibold text-gray-400">Notas<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={`mt-1.5 ${INPUT_CLASS}`} /></label>
              <button type="button" disabled={saving} onClick={() => void handleSave()} className="min-h-11 rounded-xl bg-stampa-orange text-sm font-black text-white disabled:opacity-50">{saving ? "Guardando..." : "Guardar cambios"}</button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 border-b border-stampa-border p-5 text-center">
              <div><p className="text-xs text-gray-500">Total comprado</p><p className="mt-1 text-sm font-black text-white">{money.format(totalPurchased)}</p></div>
              <div><p className="text-xs text-gray-500">Última compra</p><p className="mt-1 text-sm font-bold text-gray-300">{lastSaleAt ? dateTime.format(new Date(lastSaleAt)) : "—"}</p></div>
              <div><p className="text-xs text-gray-500">Saldo pendiente</p><p className={`mt-1 text-sm font-black ${balance > 0 ? "text-amber-300" : "text-emerald-300"}`}>{money.format(balance)}</p></div>
            </div>
          )}

          <div className="border-b border-stampa-border p-5">
            <button type="button" disabled={balance <= 0} onClick={() => setPaymentOpen(true)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><HandCoins size={16} /> {balance > 0 ? "Registrar cobro" : "Sin saldo pendiente"}</button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            <div className="p-5">
              <h3 className="text-sm font-bold text-white">Movimientos de cuenta corriente</h3>
              {movements.length === 0 ? <p className="mt-2 text-sm text-gray-500">Sin movimientos todavía.</p> : (
                <div className="mt-2 divide-y divide-stampa-border">
                  {movements.map((movement) => (
                    <div key={movement.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0"><p className="truncate text-gray-300">{MOVEMENT_LABEL[movement.movement_type]}{movement.note ? ` · ${movement.note}` : ""}</p><p className="text-xs text-gray-500">{dateTime.format(new Date(movement.created_at))}</p></div>
                      <span className={`shrink-0 font-bold ${movement.delta > 0 ? "text-amber-300" : "text-emerald-300"}`}>{movement.delta > 0 ? "+" : ""}{money.format(movement.delta)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-stampa-border p-5">
              <h3 className="text-sm font-bold text-white">Historial de ventas</h3>
              {sales.length === 0 ? <p className="mt-2 text-sm text-gray-500">Sin ventas todavía.</p> : (
                <div className="mt-2 divide-y divide-stampa-border">
                  {sales.map((sale) => (
                    <div key={sale.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0"><p className="text-gray-300">Venta N.º {sale.sale_number}{sale.status === "voided" ? " · Anulada" : ""}</p><p className="text-xs text-gray-500">{dateTime.format(new Date(sale.created_at))}</p></div>
                      <span className="shrink-0 font-bold text-white">{money.format(sale.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {client && (
        <RegisterPaymentDialog
          open={paymentOpen}
          clientId={client.id}
          balance={balance}
          onClose={() => setPaymentOpen(false)}
          onRegistered={(newBalance) => { setBalance(newBalance); setPaymentOpen(false); onChanged(); }}
        />
      )}
    </Dialog>
  );
}

function RegisterPaymentDialog({ open, clientId, balance, onClose, onRegistered }: {
  open: boolean;
  clientId: string;
  balance: number;
  onClose: () => void;
  onRegistered: (newBalance: number) => void;
}) {
  const { toast } = useAppFeedback();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<SalePaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setAmount(balance > 0 ? String(balance) : ""); setMethod("cash"); setNote(""); }
  }, [open, balance]);

  const handleSave = async () => {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return toast.error("Ingresá un monto mayor a cero.");
    setSaving(true);
    const result = await registerCustomerPaymentAction({ clientId, amount: parsedAmount, method, note });
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success("Cobro registrado.");
    onRegistered(result.newBalance);
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="register-payment-title" panelClassName="max-w-sm rounded-2xl border border-stampa-border bg-stampa-surface">
      <div className="p-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300"><Wallet size={18} /></span>
        <h2 id="register-payment-title" className="mt-3 text-lg font-black text-white">Registrar cobro</h2>
        <p className="mt-1 text-sm text-gray-400">Saldo pendiente: {money.format(balance)}</p>
        <div className="mt-4 grid gap-3">
          <label className="block text-xs font-semibold text-gray-400">Monto<input type="number" min={0} step="0.01" max={balance} value={amount} onChange={(event) => setAmount(event.target.value)} className={`mt-1.5 ${INPUT_CLASS}`} /></label>
          <div>
            <span className="block text-xs font-semibold text-gray-400">Método</span>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {(["cash", "transfer"] as const).map((option) => (
                <button key={option} type="button" onClick={() => setMethod(option)} className={`min-h-10 rounded-xl border px-2 text-xs font-bold ${method === option ? "border-stampa-orange bg-stampa-orange/10 text-stampa-orange" : "border-stampa-border text-gray-400"}`}>{option === "cash" ? "Efectivo" : "Transferencia"}</button>
              ))}
            </div>
          </div>
          <label className="block text-xs font-semibold text-gray-400">Nota<input value={note} onChange={(event) => setNote(event.target.value)} className={`mt-1.5 ${INPUT_CLASS}`} /></label>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-xl border border-stampa-border text-sm font-bold text-gray-300 disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-black text-white disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />} Registrar</button>
        </div>
      </div>
    </Dialog>
  );
}
