"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2, Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import type { PublicStorefront, PublicStorefrontCheckoutStatus, PublicStorefrontProduct } from "@/lib/business/storefront";

type CartLine = { product: PublicStorefrontProduct; quantity: number };
type CartContextValue = { add(product: PublicStorefrontProduct): void; open(): void };
const CartContext = createContext<CartContextValue | null>(null);
const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

export function PublicStorefrontCartProvider({ store, checkout, children }: { store: PublicStorefront; checkout: PublicStorefrontCheckoutStatus; children: ReactNode }) {
  const storageKey = `stampa-cart:${store.slug}`;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const [attempt, setAttempt] = useState<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]") as CartLine[];
        setLines(Array.isArray(parsed) ? parsed.filter((line) => line?.product?.slug && Number.isInteger(line.quantity) && line.quantity > 0) : []);
      } catch { setLines([]); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);
  useEffect(() => { if (lines.length) localStorage.setItem(storageKey, JSON.stringify(lines)); else localStorage.removeItem(storageKey); }, [lines, storageKey]);

  const update = (slug: string, quantity: number) => {
    setAttempt(null);
    setLines((current) => quantity <= 0 ? current.filter((line) => line.product.slug !== slug) : current.map((line) => line.product.slug === slug ? { ...line, quantity: Math.min(99, quantity) } : line));
  };
  const context = useMemo<CartContextValue>(() => ({
    add(product) {
      setAttempt(null); setError(null); setOpen(true);
      setLines((current) => current.some((line) => line.product.slug === product.slug)
        ? current.map((line) => line.product.slug === product.slug ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line)
        : [...current, { product, quantity: 1 }]);
    },
    open() { setOpen(true); },
  }), []);
  const subtotal = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  const checkoutNow = async () => {
    setError(null);
    const signature = JSON.stringify({ buyer, items: lines.map((line) => [line.product.slug, line.quantity]) });
    const idempotencyKey = attempt?.signature === signature ? attempt.key : crypto.randomUUID();
    setAttempt({ signature, key: idempotencyKey }); setSubmitting(true);
    try {
      const response = await fetch(`/api/business/storefront/${encodeURIComponent(store.slug)}/checkout`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey, buyer, items: lines.map((line) => ({ productSlug: line.product.slug, quantity: line.quantity })) }),
      });
      const result = await response.json() as { checkoutUrl?: string; error?: string; retryable?: boolean };
      if (!response.ok || !result.checkoutUrl) throw new Error(result.error || "No pudimos iniciar el pago.");
      window.location.assign(result.checkoutUrl);
    } catch (checkoutError) { setError(checkoutError instanceof Error ? checkoutError.message : "No pudimos iniciar el pago."); }
    finally { setSubmitting(false); }
  };

  return <CartContext.Provider value={context}>{children}
    {checkout.enabled && lines.length > 0 && <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-orange-500 px-5 text-sm font-black text-white shadow-2xl shadow-black/40 sm:right-7" aria-label="Abrir carrito"><ShoppingCart size={19} /> {lines.reduce((sum, line) => sum + line.quantity, 0)}</button>}
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy="storefront-cart-title" panelClassName="max-w-lg rounded-3xl border border-white/10 bg-neutral-950 text-white">
      <div className="flex items-center justify-between border-b border-white/10 p-5"><div><h2 id="storefront-cart-title" className="text-xl font-black">Tu pedido</h2><p className="text-xs text-neutral-500">Comprás únicamente en {store.name}</p></div><button type="button" onClick={() => setOpen(false)} className="rounded-full p-2 text-neutral-400 hover:bg-white/5" aria-label="Cerrar carrito"><X /></button></div>
      <div className="max-h-[45vh] space-y-3 overflow-y-auto p-5">{lines.length === 0 ? <p className="py-8 text-center text-sm text-neutral-500">El carrito está vacío.</p> : lines.map((line) => <div key={line.product.slug} className="flex items-center gap-3 rounded-2xl bg-white/5 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{line.product.name}</p><p className="text-xs text-neutral-400">{money.format(line.product.price)} c/u</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => update(line.product.slug, line.quantity - 1)} className="rounded-lg border border-white/10 p-2" aria-label="Restar unidad"><Minus size={14} /></button><span className="w-6 text-center text-sm font-bold">{line.quantity}</span><button type="button" onClick={() => update(line.product.slug, line.quantity + 1)} className="rounded-lg border border-white/10 p-2" aria-label="Sumar unidad"><Plus size={14} /></button><button type="button" onClick={() => update(line.product.slug, 0)} className="p-2 text-red-300" aria-label="Quitar producto"><Trash2 size={15} /></button></div></div>)}</div>
      {lines.length > 0 && <div className="border-t border-white/10 p-5"><div className="mb-4 flex justify-between text-base font-black"><span>Total</span><span>{money.format(subtotal)}</span></div><div className="grid gap-3"><input required value={buyer.name} onChange={(event) => { setAttempt(null); setBuyer({ ...buyer, name: event.target.value }); }} placeholder="Nombre y apellido" maxLength={120} className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-orange-400" /><input required type="email" value={buyer.email} onChange={(event) => { setAttempt(null); setBuyer({ ...buyer, email: event.target.value }); }} placeholder="Email" maxLength={254} className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-orange-400" /><input value={buyer.phone} onChange={(event) => { setAttempt(null); setBuyer({ ...buyer, phone: event.target.value }); }} placeholder="Teléfono (opcional)" maxLength={40} className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-orange-400" /></div>{checkout.testMode && <p className="mt-3 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200">Pago en entorno de prueba. No se realizarán cobros reales.</p>}{error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}<button type="button" disabled={submitting || !buyer.name.trim() || !buyer.email.trim()} onClick={() => void checkoutNow()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 text-sm font-black disabled:opacity-50">{submitting && <Loader2 size={17} className="animate-spin" />} Ir a pagar</button></div>}
    </Dialog>
  </CartContext.Provider>;
}

export function AddToStorefrontCartButton({ product }: { product: PublicStorefrontProduct }) {
  const cart = useContext(CartContext);
  if (!cart || !product.available) return null;
  return <button type="button" onClick={() => cart.add(product)} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-black text-white hover:bg-orange-400"><ShoppingCart size={18} /> Agregar al carrito</button>;
}
