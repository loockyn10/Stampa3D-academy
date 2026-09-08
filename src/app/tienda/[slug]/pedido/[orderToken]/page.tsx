import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock3, ShieldAlert, XCircle } from "lucide-react";
import { loadPublicBusinessOrder, normalizeStorefrontSlug } from "@/lib/business/storefront";
import { createClient } from "@/utils/supabase/server";

type PageProps = { params: Promise<{ slug: string; orderToken: string }> };
const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Estado del pedido | Stampa", robots: { index: false, follow: false } };

const statusCopy: Record<string, { title: string; detail: string; color: string; icon: typeof Clock3 }> = {
  paid: { title: "Pago confirmado", detail: "El vendedor ya recibió tu pedido.", color: "text-emerald-300", icon: CheckCircle2 },
  awaiting_payment: { title: "Esperando el pago", detail: "Si ya pagaste, la confirmación puede demorar unos instantes.", color: "text-amber-300", icon: Clock3 },
  payment_review: { title: "Pago en revisión", detail: "El pago fue recibido y requiere revisión antes de confirmar el pedido.", color: "text-amber-300", icon: ShieldAlert },
  expired: { title: "Pedido vencido", detail: "La reserva de stock fue liberada. Podés iniciar una nueva compra.", color: "text-neutral-300", icon: XCircle },
  cancelled: { title: "Pedido cancelado", detail: "No se confirmó el pago de este pedido.", color: "text-red-300", icon: XCircle },
  refunded: { title: "Pago devuelto", detail: "Mercado Pago informó la devolución del pago.", color: "text-neutral-300", icon: XCircle },
};

export default async function PublicOrderStatusPage({ params }: PageProps) {
  const { slug: rawSlug, orderToken } = await params;
  const slug = normalizeStorefrontSlug(rawSlug);
  if (!slug || !UUID.test(orderToken)) notFound();
  const order = await loadPublicBusinessOrder(await createClient(), slug, orderToken);
  if (!order) notFound();
  const copy = statusCopy[order.orderStatus] || statusCopy.awaiting_payment;
  const Icon = copy.icon;
  return <main className="min-h-screen bg-[#111] px-4 py-10 text-white sm:py-16"><section className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-neutral-900 shadow-2xl shadow-black/20"><div className="border-b border-white/10 p-6 text-center sm:p-8"><Icon className={`mx-auto ${copy.color}`} size={42} /><h1 className="mt-4 text-2xl font-black">{copy.title}</h1><p className="mt-2 text-sm leading-6 text-neutral-400">{copy.detail}</p><p className="mt-3 text-xs text-neutral-600">Pedido #{order.orderNumber}</p></div><div className="space-y-3 p-6">{order.items.map((item, index) => <div key={`${item.name}-${index}`} className="flex justify-between gap-4 text-sm"><span className="text-neutral-300">{item.quantity} × {item.name}</span><span className="font-bold">{money.format(item.subtotal)}</span></div>)}<div className="mt-4 flex justify-between border-t border-white/10 pt-4 text-lg font-black"><span>Total</span><span>{money.format(order.total)}</span></div><p className="pt-2 text-xs text-neutral-600">Comprador: {order.buyerName}</p><Link href={`/tienda/${slug}`} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/10 text-sm font-bold text-neutral-300 hover:bg-white/5">Volver a la tienda</Link></div></section></main>;
}
