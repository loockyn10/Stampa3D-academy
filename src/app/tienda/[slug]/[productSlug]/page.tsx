import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PackageOpen } from "lucide-react";
import { PublicProductContact, PublicStorefrontFooter } from "@/components/business/PublicStorefrontShell";
import { PublicStorefrontCartProvider } from "@/components/business/PublicStorefrontCart";
import { loadPublicStorefront, loadPublicStorefrontCheckoutStatus, loadPublicStorefrontProduct } from "@/lib/business/storefront";
import { createClient } from "@/utils/supabase/server";

type ProductPageProps = { params: Promise<{ slug: string; productSlug: string }> };
const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

async function getPublicData(slug: string, productSlug: string) {
  const supabase = await createClient();
  return Promise.all([loadPublicStorefront(supabase, slug), loadPublicStorefrontProduct(supabase, slug, productSlug), loadPublicStorefrontCheckoutStatus(supabase, slug)]);
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const [store, product] = await getPublicData(slug, productSlug);
  if (!store || !product) return { title: "Producto no disponible | Stampa", robots: { index: false, follow: false } };
  const description = product.description || `${product.name} en ${store.name}. ${money.format(product.price)}.`;
  return { title: `${product.name} | ${store.name}`, description, openGraph: { title: product.name, description, type: "website", ...(product.imageUrl ? { images: [product.imageUrl] } : {}) } };
}

export default async function PublicProductPage({ params }: ProductPageProps) {
  const { slug, productSlug } = await params;
  const [store, product, checkout] = await getPublicData(slug, productSlug);
  if (!store || !product) notFound();
  return <PublicStorefrontCartProvider store={store} checkout={checkout}><main className="min-h-screen bg-[#111] text-white">
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-9"><Link href={`/tienda/${store.slug}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-neutral-400 hover:text-white"><ArrowLeft size={17} /> Volver a {store.name}</Link>
      <div className="mt-4 grid overflow-hidden rounded-3xl border border-white/10 bg-neutral-900 shadow-2xl shadow-black/20 md:grid-cols-2">
        <div className="relative aspect-square bg-neutral-800">{product.imageUrl ? <Image unoptimized priority src={product.imageUrl} alt={product.name} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" /> : <div className="flex h-full items-center justify-center text-neutral-600"><PackageOpen size={56} /></div>}</div>
        <div className="flex flex-col justify-center p-5 sm:p-8"><p className="text-xs font-black uppercase tracking-wider text-orange-400">{product.category}</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{product.name}</h1><span className={`mt-4 w-fit rounded-full px-3 py-1.5 text-xs font-black ${product.available ? "bg-emerald-500/10 text-emerald-300" : "bg-white/5 text-neutral-500"}`}>{product.available ? "Disponible" : "Sin stock"}</span>{product.description && <p className="mt-6 whitespace-pre-line text-sm leading-7 text-neutral-400">{product.description}</p>}<p className="mt-7 text-3xl font-black">{money.format(product.price)}</p><div className="mt-5"><PublicProductContact store={store} product={product} checkoutEnabled={checkout.enabled} /></div><p className="mt-3 text-center text-[11px] text-neutral-600">{checkout.enabled ? "El precio y el stock se validan nuevamente antes de reservar." : "La consulta no genera una compra ni reserva automática."}</p></div>
      </div>
    </div>
    <PublicStorefrontFooter store={store} />
  </main></PublicStorefrontCartProvider>;
}
