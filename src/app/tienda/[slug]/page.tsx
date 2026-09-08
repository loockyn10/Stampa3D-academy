import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicStorefrontFooter, PublicStorefrontHeader, PublicStorefrontProductCard } from "@/components/business/PublicStorefrontShell";
import { loadPublicStorefront, loadPublicStorefrontProducts } from "@/lib/business/storefront";
import { createClient } from "@/utils/supabase/server";

type StorePageProps = { params: Promise<{ slug: string }> };

async function getStore(slug: string) {
  const supabase = await createClient();
  return loadPublicStorefront(supabase, slug);
}

export async function generateMetadata({ params }: StorePageProps): Promise<Metadata> {
  const { slug } = await params;
  const store = await getStore(slug);
  if (!store) return { title: "Tienda no disponible | Stampa", robots: { index: false, follow: false } };
  return {
    title: `${store.name} | Tienda en Stampa`, description: store.description || `Conocé los productos de ${store.name}.`,
    openGraph: { title: store.name, description: store.description || `Tienda de ${store.name} en Stampa`, type: "website", ...(store.bannerUrl || store.logoUrl ? { images: [store.bannerUrl || store.logoUrl!] } : {}) },
  };
}

export default async function PublicStorefrontPage({ params }: StorePageProps) {
  const { slug } = await params;
  const supabase = await createClient();
  const [store, products] = await Promise.all([loadPublicStorefront(supabase, slug), loadPublicStorefrontProducts(supabase, slug)]);
  if (!store) notFound();
  const categories = [...new Set(products.map((product) => product.category))];
  return <main className="min-h-screen bg-[#111] text-white">
    <PublicStorefrontHeader store={store} />
    <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-9 sm:px-6 sm:pt-12">
      {categories.length > 1 && <nav aria-label="Categorías" className="mb-6 flex gap-2 overflow-x-auto pb-1">{categories.map((category) => <a key={category} href={`#${encodeURIComponent(category)}`} className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-neutral-300">{category}</a>)}</nav>}
      {products.length === 0 ? <div className="rounded-2xl border border-white/10 bg-neutral-900 p-10 text-center"><h2 className="text-lg font-bold">Todavía no hay productos publicados</h2><p className="mt-2 text-sm text-neutral-500">Volvé pronto para conocer las novedades.</p></div> : <div className="space-y-10">{categories.map((category) => <section key={category} id={encodeURIComponent(category)} className="scroll-mt-5"><h2 className="mb-4 text-lg font-black text-white">{category}</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">{products.filter((product) => product.category === category).map((product) => <PublicStorefrontProductCard key={product.slug} store={store} product={product} />)}</div></section>)}</div>}
    </div>
    <PublicStorefrontFooter store={store} />
  </main>;
}
