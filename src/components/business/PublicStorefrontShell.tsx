import Image from "next/image";
import Link from "next/link";
import { Mail, MessageCircle, PackageOpen, Store } from "lucide-react";
import { buildWhatsappProductUrl, type PublicStorefront, type PublicStorefrontProduct } from "@/lib/business/storefront";
import { AddToStorefrontCartButton } from "./PublicStorefrontCart";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

export function PublicStorefrontHeader({ store }: { store: PublicStorefront }) {
  return <>
    {store.bannerUrl && <div className="relative h-40 overflow-hidden bg-neutral-900 sm:h-60"><Image unoptimized priority src={store.bannerUrl} alt={`Portada de ${store.name}`} fill sizes="100vw" className="object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-[#111] via-black/10 to-transparent" /></div>}
    <header className={`mx-auto flex w-full max-w-6xl items-center gap-4 px-4 sm:px-6 ${store.bannerUrl ? "relative -mt-10" : "pt-8"}`}>
      {store.logoUrl ? <Image unoptimized src={store.logoUrl} alt={`Logo de ${store.name}`} width={88} height={88} className="h-20 w-20 shrink-0 rounded-2xl border-4 border-[#111] bg-neutral-900 object-cover shadow-xl sm:h-24 sm:w-24" /> : <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-4 border-[#111] bg-neutral-800 text-orange-400 shadow-xl sm:h-24 sm:w-24"><Store size={32} /></span>}
      <div className="min-w-0 pt-8"><h1 className="text-2xl font-black tracking-tight text-white sm:text-4xl">{store.name}</h1>{store.description && <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400 sm:text-base">{store.description}</p>}</div>
    </header>
  </>;
}

export function PublicProductContact({ store, product, checkoutEnabled = false }: { store: PublicStorefront; product: PublicStorefrontProduct; checkoutEnabled?: boolean }) {
  if (!product.available) return <span className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-white/5 px-4 text-sm font-bold text-neutral-500">Sin stock</span>;
  if (checkoutEnabled) return <AddToStorefrontCartButton product={product} />;
  if (store.whatsapp) return <a href={buildWhatsappProductUrl(store.whatsapp, product.name, store.name)} target="_blank" rel="noreferrer" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-white hover:bg-emerald-400"><MessageCircle size={18} /> Consultar por WhatsApp</a>;
  if (store.publicEmail) return <a href={`mailto:${store.publicEmail}?subject=${encodeURIComponent(`Consulta por ${product.name}`)}`} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-black text-white hover:bg-orange-400"><Mail size={18} /> Consultar</a>;
  return <span className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-white/10 px-4 text-center text-sm text-neutral-400">Contacto no configurado</span>;
}

export function PublicStorefrontProductCard({ store, product, checkoutEnabled = false }: { store: PublicStorefront; product: PublicStorefrontProduct; checkoutEnabled?: boolean }) {
  return <article className="group overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/80 shadow-xl shadow-black/10">
    <Link href={`/tienda/${store.slug}/${product.slug}`} className="block">
      <div className="relative aspect-square overflow-hidden bg-neutral-800">{product.imageUrl ? <Image unoptimized src={product.imageUrl} alt={product.name} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center text-neutral-600"><PackageOpen size={36} /></div>}<span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-black ${product.available ? "bg-emerald-500/90 text-white" : "bg-neutral-950/85 text-neutral-300"}`}>{product.available ? "Disponible" : "Sin stock"}</span></div>
      <div className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-orange-400">{product.category}</p><h2 className="mt-1 line-clamp-2 text-base font-bold text-white">{product.name}</h2>{product.description && <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-500">{product.description}</p>}<p className="mt-3 text-lg font-black text-white">{money.format(product.price)}</p></div>
    </Link>
    <div className="px-4 pb-4"><PublicProductContact store={store} product={product} checkoutEnabled={checkoutEnabled} /></div>
  </article>;
}

export function PublicStorefrontFooter({ store }: { store: PublicStorefront }) {
  return <footer className="mt-14 border-t border-white/10 px-4 py-8 text-center text-xs text-neutral-600"><p>Vidriera creada con <Link href="/landing" className="font-bold text-orange-400">Academia Stampa</Link></p>{store.publicEmail && <a href={`mailto:${store.publicEmail}`} className="mt-2 inline-block text-neutral-400 hover:text-white">{store.publicEmail}</a>}</footer>;
}
