"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Barcode, Loader2, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { BarcodeScanner } from "@/components/business/BarcodeScanner";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { SectionTitle } from "@/components/ui/section-title";
import { useAppFeedback } from "@/components/ui/app-feedback";
import {
  addBusinessCartItem,
  buildBusinessSaleFingerprint,
  calculateBusinessCartTotal,
  findCatalogItemByBarcode,
  setBusinessCartQuantity,
  toBusinessCartItem,
  type BusinessCartItem,
} from "@/lib/business/cart";
import type { BusinessCatalogItem, BusinessClientSummary, WorkshopProductSummary } from "@/lib/business/catalog";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { confirmBusinessSaleAction, loadBusinessOperationsAction } from "../actions";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const SALE_ATTEMPT_STORAGE_KEY = "stampa:quick-sale-attempt";

export default function VentaRapidaPage() {
  const { toast, confirmAction } = useAppFeedback();
  const [items, setItems] = useState<BusinessCatalogItem[]>([]);
  const [products, setProducts] = useState<WorkshopProductSummary[]>([]);
  const [clients, setClients] = useState<BusinessClientSummary[]>([]);
  const [cart, setCart] = useState<BusinessCartItem[]>([]);
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saleAttemptRef = useRef<{ key: string; fingerprint: string } | null>(null);

  const load = useCallback(async () => {
    const result = await loadBusinessOperationsAction();
    if (!result.success) {
      setError(result.error);
      setItems([]);
      setProducts([]);
      setClients([]);
    } else {
      setError(null);
      setItems(result.items);
      setProducts(result.products);
      setClients(result.clients);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void loadBusinessOperationsAction().then((result) => {
      if (!active) return;
      if (!result.success) { setError(result.error); setItems([]); setProducts([]); setClients([]); }
      else { setError(null); setItems(result.items); setProducts(result.products); setClients(result.clients); }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const available = useMemo(() => items.flatMap((item) => {
    const cartItem = toBusinessCartItem(item, products);
    return cartItem && cartItem.availableStock > 0 ? [cartItem] : [];
  }), [items, products]);
  const results = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es-AR");
    if (!needle) return [];
    return available.filter((item) => [item.name, item.sku, item.barcode].some((value) => value?.toLocaleLowerCase("es-AR").includes(needle))).slice(0, 12);
  }, [available, search]);
  const total = useMemo(() => calculateBusinessCartTotal(cart), [cart]);
  const selectedClient = clients.find((client) => client.id === clientId) ?? null;

  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio/venta-rapida", title: "Venta rápida" },
    mode: "quick_sale",
    visibleEntities: available.slice(0, 20).map((item, index) => ({
      type: "business_inventory_item", id: item.catalogItemId, name: item.name, position: index + 1,
      facts: [{ label: "Stock", value: item.availableStock }, { label: "Precio", value: item.unitPrice }],
    })),
    formState: {
      kind: "formDraft", formType: "quick_sale",
      fields: [{ label: "Total", value: total }, { label: "Cliente", value: selectedClient?.name ?? "Sin cliente" }, { label: "Unidades", value: cart.reduce((sum, item) => sum + item.quantity, 0) }],
      items: cart.map((item, index) => ({ type: "sale_cart_item", id: item.catalogItemId, name: item.name, position: index + 1, facts: [{ label: "Cantidad", value: item.quantity }, { label: "Precio unitario", value: item.unitPrice }] })),
    },
    uiState: { loading, searchQuery: search, ...(scannerOpen ? { activeDialog: "Escáner de código de barras" } : {}) },
  }), [available, cart, loading, scannerOpen, search, selectedClient?.name, total]);
  usePublishStampyScreenContext(stampyContext);

  const addToCart = useCallback((item: BusinessCartItem) => {
    const result = addBusinessCartItem(cart, item);
    setCart(result.cart);
    if (!result.success) toast.error(result.error);
  }, [cart, toast]);

  const changeQuantity = (catalogItemId: string, quantity: number) => {
    const result = setBusinessCartQuantity(cart, catalogItemId, quantity);
    setCart(result.cart);
    if (!result.success) toast.error(result.error);
  };

  const handleBarcode = useCallback((barcode: string) => {
    const catalogItem = findCatalogItemByBarcode(items, barcode);
    if (!catalogItem) return toast.error(`Producto no encontrado: no hay un artículo activo con el código ${barcode}.`);
    const cartItem = toBusinessCartItem(catalogItem, products);
    if (!cartItem) return toast.error("El producto no tiene una fuente de stock disponible.");
    addToCart(cartItem);
  }, [addToCart, items, products, toast]);

  const confirmSale = async () => {
    if (cart.length === 0 || submitting) return;
    const confirmed = await confirmAction({
      title: "Confirmar venta",
      description: `Se registrará una venta por ${money.format(total)} y se descontará el inventario correspondiente.`,
      confirmLabel: "Registrar venta",
    });
    if (!confirmed) return;
    const fingerprint = buildBusinessSaleFingerprint(cart, clientId || null);
    if (saleAttemptRef.current?.fingerprint !== fingerprint) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(SALE_ATTEMPT_STORAGE_KEY) || "null") as { fingerprint?: string; key?: string } | null;
        const key = stored?.fingerprint === fingerprint && stored.key ? stored.key : crypto.randomUUID();
        saleAttemptRef.current = { fingerprint, key };
        sessionStorage.setItem(SALE_ATTEMPT_STORAGE_KEY, JSON.stringify(saleAttemptRef.current));
      } catch {
        saleAttemptRef.current = { fingerprint, key: crypto.randomUUID() };
      }
    }
    setSubmitting(true);
    let result: Awaited<ReturnType<typeof confirmBusinessSaleAction>>;
    try {
      result = await confirmBusinessSaleAction({
        idempotencyKey: saleAttemptRef.current.key,
        clientId: clientId || null,
        items: cart.map((item) => ({ catalogItemId: item.catalogItemId, quantity: item.quantity })),
      });
    } catch {
      setSubmitting(false);
      toast.error("No recibimos la respuesta. Reintentá: la misma venta no se registrará dos veces.");
      return;
    }
    setSubmitting(false);
    if (!result.success) return toast.error(result.error);
    toast.success(`Venta N.º ${result.saleNumber} registrada${result.replayed ? " (ya estaba procesada)" : ""}.`);
    saleAttemptRef.current = null;
    try { sessionStorage.removeItem(SALE_ATTEMPT_STORAGE_KEY); } catch { /* Storage can be disabled. */ }
    setCart([]);
    setClientId("");
    setSearch("");
    setLoading(true);
    await load();
  };

  return (
    <div className="pb-32">
      <Link href="/mi-negocio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white"><ArrowLeft size={14} /> Mi Negocio</Link>
      <SectionTitle eyebrow="Mi Negocio" title="Venta rápida" action={<Link href="/mi-negocio/ventas" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-stampa-border px-4 text-xs font-bold text-gray-300 hover:bg-white/5 sm:w-auto">Ver ventas</Link>} />
      <p className="mb-6 max-w-2xl text-sm leading-6 text-gray-400">Escaneá o buscá productos, armá el carrito y confirmá. El precio y el stock se validan otra vez al registrar la venta.</p>
      {error && <Card className="mb-5 border-red-500/25 p-4 text-sm text-red-300">No se pudo cargar la operación: {error}</Card>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
        <section className="min-w-0">
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3.5 text-gray-500" size={17} /><span className="sr-only">Buscar producto</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Producto, SKU o código" className="min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-surface pl-10 pr-3 text-sm text-white outline-none focus:border-stampa-orange" /></label>
            <button type="button" onClick={() => setScannerOpen(true)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-stampa-orange px-3 text-sm font-bold text-white min-[390px]:px-4"><Barcode size={18} /><span className="hidden min-[390px]:inline">Escanear</span></button>
          </div>
          {loading ? <div className="flex min-h-48 items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div> : search.trim() ? (
            <div className="mt-3 grid gap-2">
              {results.length === 0 ? <Card className="p-5 text-sm text-gray-400">No encontramos productos disponibles.</Card> : results.map((item) => (
                <button key={item.catalogItemId} type="button" onClick={() => addToCart(item)} className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-stampa-border bg-stampa-surface px-4 text-left hover:border-stampa-orange/40">
                  <span className="min-w-0"><span className="block truncate text-sm font-bold text-white">{item.name}</span><span className="block truncate text-xs text-gray-500">{item.sku || item.barcode || "Sin código"} · {item.availableStock} u.</span></span>
                  <span className="shrink-0 text-sm font-black text-stampa-orange">{money.format(item.unitPrice)}</span>
                </button>
              ))}
            </div>
          ) : <Card className="mt-3 p-7 text-center text-sm leading-6 text-gray-500">Buscá por nombre, SKU o código, o abrí la cámara para escanear.</Card>}
        </section>

        <Card className="h-fit overflow-hidden">
          <div className="flex items-center justify-between border-b border-stampa-border p-4"><h2 className="flex items-center gap-2 text-sm font-bold text-white"><ShoppingCart size={18} className="text-stampa-orange" /> Carrito</h2><span className="text-xs text-gray-500">{cart.reduce((sum, item) => sum + item.quantity, 0)} u.</span></div>
          <div className="max-h-[42dvh] divide-y divide-stampa-border overflow-y-auto">
            {cart.length === 0 ? <p className="p-8 text-center text-sm text-gray-500">Todavía no agregaste productos.</p> : cart.map((item) => (
              <div key={item.catalogItemId} className="p-4">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-white">{item.name}</p><p className="mt-1 text-xs text-gray-500">{money.format(item.unitPrice)} c/u · stock {item.availableStock}</p></div><button type="button" onClick={() => setCart((current) => current.filter((candidate) => candidate.catalogItemId !== item.catalogItemId))} aria-label={`Quitar ${item.name}`} className="rounded-lg p-2 text-gray-500 hover:bg-red-500/10 hover:text-red-300"><Trash2 size={16} /></button></div>
                <div className="mt-3 flex items-center justify-between"><div className="flex items-center rounded-xl border border-stampa-border"><button type="button" disabled={item.quantity <= 1} onClick={() => changeQuantity(item.catalogItemId, item.quantity - 1)} className="flex h-10 w-10 items-center justify-center disabled:opacity-30"><Minus size={15} /></button><span className="w-9 text-center text-sm font-bold text-white">{item.quantity}</span><button type="button" disabled={item.quantity >= item.availableStock} onClick={() => changeQuantity(item.catalogItemId, item.quantity + 1)} className="flex h-10 w-10 items-center justify-center disabled:opacity-30"><Plus size={15} /></button></div><p className="text-sm font-black text-white">{money.format(item.unitPrice * item.quantity)}</p></div>
              </div>
            ))}
          </div>
          <div className="space-y-4 border-t border-stampa-border p-4">
            <label className="block text-xs font-semibold text-gray-400">Cliente opcional<select value={clientId} onChange={(event) => setClientId(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 text-sm text-white"><option value="">Sin cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <div className="flex items-end justify-between"><span className="text-sm text-gray-400">Total</span><span className="text-2xl font-black text-white">{money.format(total)}</span></div>
            <button type="button" disabled={cart.length === 0 || submitting} onClick={() => void confirmSale()} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-stampa-orange px-4 text-sm font-black text-white disabled:opacity-45">{submitting && <Loader2 size={17} className="animate-spin" />} Confirmar venta</button>
          </div>
        </Card>
      </div>

      <Dialog open={scannerOpen} onClose={() => setScannerOpen(false)} labelledBy="barcode-scanner-title" panelClassName="max-w-lg rounded-2xl border border-stampa-border bg-stampa-surface">
        <div className="p-5"><h2 id="barcode-scanner-title" className="text-lg font-bold text-white">Escanear producto</h2><p className="mt-1 text-sm text-gray-400">Cada lectura agrega una unidad, sin superar el stock disponible.</p></div>
        <div className="px-4 pb-4 sm:px-5"><BarcodeScanner onDetected={handleBarcode} /></div>
        <div className="border-t border-stampa-border p-4"><button type="button" onClick={() => setScannerOpen(false)} className="min-h-11 w-full rounded-xl border border-stampa-border text-sm font-bold text-gray-300">Cerrar</button></div>
      </Dialog>
    </div>
  );
}
