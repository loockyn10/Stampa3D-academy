"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Check, Copy, ExternalLink, Loader2, Store } from "lucide-react";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import { normalizeStorefrontSlug } from "@/lib/business/storefront";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { loadBusinessStorefrontWorkspaceAction, saveBusinessStorefrontAction } from "../actions";

const inputClass = "mt-1.5 min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 text-sm text-white outline-none focus:border-stampa-orange";
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://academia-stampa.com").replace(/\/$/, "");

export default function BusinessStorefrontSettingsPage() {
  const { toast } = useAppFeedback();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", description: "", logoUrl: "", bannerUrl: "", whatsapp: "", publicEmail: "", isActive: false });

  useEffect(() => {
    let active = true;
    void loadBusinessStorefrontWorkspaceAction().then((result) => {
      if (!active) return;
      if (!result.success) setError(result.error);
      else {
        setUserId(result.userId);
        if (result.storefront) setForm({
          name: result.storefront.name, slug: result.storefront.slug, description: result.storefront.description || "",
          logoUrl: result.storefront.logo_url || "", bannerUrl: result.storefront.banner_url || "",
          whatsapp: result.storefront.whatsapp || "", publicEmail: result.storefront.public_email || "", isActive: result.storefront.is_active,
        });
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const normalizedSlug = normalizeStorefrontSlug(form.slug);
  const publicUrl = normalizedSlug ? `${APP_URL}/tienda/${normalizedSlug}` : "";
  const stampyContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "business", route: "/mi-negocio/tienda", title: "Mi Tienda" }, mode: "storefront_settings",
    formState: { kind: "formDraft", formType: "storefront_settings", fields: [
      { label: "Nombre comercial", value: form.name || "Sin completar" }, { label: "Slug", value: normalizedSlug || "Sin completar" },
      { label: "Estado", value: form.isActive ? "Activa" : "Inactiva" }, { label: "WhatsApp configurado", value: Boolean(form.whatsapp) },
      { label: "Email público configurado", value: Boolean(form.publicEmail) },
    ] }, uiState: { loading },
  }), [form.isActive, form.name, form.publicEmail, form.whatsapp, loading, normalizedSlug]);
  usePublishStampyScreenContext(stampyContext);

  const save = async () => {
    setSaving(true);
    const result = await saveBusinessStorefrontAction({ ...form, slug: normalizedSlug });
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    setForm((current) => ({ ...current, slug: result.slug }));
    toast.success("Configuración de la tienda guardada.");
  };

  const copyLink = async () => {
    if (!publicUrl) return;
    try { await navigator.clipboard.writeText(publicUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { toast.error("No pudimos copiar el enlace. Podés seleccionarlo manualmente."); }
  };

  if (loading) return <div className="flex min-h-64 items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div>;

  return <div className="pb-24">
    <Link href="/mi-negocio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-white"><ArrowLeft size={14} /> Mi Negocio</Link>
    <SectionTitle eyebrow="Mi Negocio" title="Mi Tienda" />
    <p className="mb-6 max-w-2xl text-sm leading-6 text-gray-400">Configurá una vidriera pública para compartir tu catálogo. En esta etapa las consultas se resuelven por WhatsApp o email; no hay checkout.</p>
    {error && <Card className="mb-5 border-red-500/25 p-4 text-sm text-red-300">No se pudo cargar la tienda: {error}</Card>}

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="overflow-hidden">
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <label className="text-xs font-semibold text-gray-300">Nombre comercial<input value={form.name} maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value, ...(!form.slug ? { slug: normalizeStorefrontSlug(event.target.value) } : {}) })} className={inputClass} placeholder="Mi taller 3D" /></label>
          <label className="text-xs font-semibold text-gray-300">Slug público<input value={form.slug} maxLength={60} onChange={(event) => setForm({ ...form, slug: normalizeStorefrontSlug(event.target.value) })} className={inputClass} placeholder="mi-taller-3d" /><span className="mt-1 block truncate text-[11px] text-gray-500">/tienda/{normalizedSlug || "tu-slug"}</span></label>
          <label className="text-xs font-semibold text-gray-300">WhatsApp público<input value={form.whatsapp} onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} className={inputClass} inputMode="tel" placeholder="5491112345678" /><span className="mt-1 block text-[11px] text-gray-500">Incluí código de país, sólo números.</span></label>
          <label className="text-xs font-semibold text-gray-300">Email público<input type="email" value={form.publicEmail} maxLength={254} onChange={(event) => setForm({ ...form, publicEmail: event.target.value })} className={inputClass} placeholder="ventas@mitaller.com" /></label>
          <label className="text-xs font-semibold text-gray-300 sm:col-span-2">Descripción<textarea value={form.description} maxLength={600} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} className={`${inputClass} resize-none py-3`} placeholder="Contá qué hacés y qué tipo de productos ofrecés." /></label>
        </div>

        <div className="grid gap-5 border-t border-stampa-border p-5 md:grid-cols-2">
          <div><p className="mb-2 text-xs font-semibold text-gray-300">Logo</p><FileUploadDropzone bucket="business-storefront-assets" pathPrefix={`${userId || "pending"}/logo`} accept=".jpg,.jpeg,.png,.webp" maxSizeMb={5} publicBucket imageEditor={{ aspectRatio: 1, outputWidth: 800, outputHeight: 800, quality: 0.9, outputType: "preserve", cropShape: "circle" }} onUploaded={(logoUrl) => setForm((current) => ({ ...current, logoUrl }))} label="Subir logo" />{form.logoUrl && <div className="mt-3 flex items-center gap-3"><Image unoptimized src={form.logoUrl} width={52} height={52} alt="Vista previa del logo" className="h-13 w-13 rounded-full border border-stampa-border object-cover" /><button type="button" onClick={() => setForm({ ...form, logoUrl: "" })} className="text-xs font-bold text-red-300">Quitar</button></div>}</div>
          <div><p className="mb-2 text-xs font-semibold text-gray-300">Banner opcional</p><FileUploadDropzone bucket="business-storefront-assets" pathPrefix={`${userId || "pending"}/banner`} accept=".jpg,.jpeg,.png,.webp" maxSizeMb={5} publicBucket imageEditor={{ aspectRatio: 16 / 9, outputWidth: 1600, outputHeight: 900, quality: 0.88, outputType: "preserve" }} onUploaded={(bannerUrl) => setForm((current) => ({ ...current, bannerUrl }))} label="Subir banner" />{form.bannerUrl && <div className="mt-3"><Image unoptimized src={form.bannerUrl} width={320} height={180} alt="Vista previa del banner" className="aspect-video w-full rounded-xl border border-stampa-border object-cover" /><button type="button" onClick={() => setForm({ ...form, bannerUrl: "" })} className="mt-2 text-xs font-bold text-red-300">Quitar</button></div>}</div>
        </div>

        <div className="flex flex-col gap-4 border-t border-stampa-border p-5 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-3 text-sm font-bold text-white"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-5 w-5 accent-orange-500" /> Tienda pública activa</label>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stampa-orange px-5 text-sm font-black text-white disabled:opacity-50">{saving && <Loader2 size={16} className="animate-spin" />} Guardar tienda</button>
        </div>
      </Card>

      <aside className="space-y-4">
        <Card className="p-5"><Store className="text-stampa-orange" size={23} /><h2 className="mt-3 text-sm font-bold text-white">Enlace compartible</h2>{publicUrl ? <><div className="mt-3 break-all rounded-xl bg-black/20 p-3 text-xs text-gray-300">{publicUrl}</div><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => void copyLink()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stampa-border text-xs font-bold text-white">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copiado" : "Copiar"}</button><Link href={`/tienda/${normalizedSlug}`} target="_blank" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stampa-border text-xs font-bold text-white"><ExternalLink size={15} /> Abrir</Link></div></> : <p className="mt-3 text-xs leading-5 text-gray-500">Completá un slug para generar el enlace.</p>}</Card>
        <Card className="p-5 text-xs leading-5 text-gray-500"><p className="font-bold text-gray-300">Publicación controlada</p><p className="mt-2">Activar la tienda no publica productos automáticamente. Elegí cuáles mostrar desde Catálogo.</p><Link href="/mi-negocio/catalogo" className="mt-3 inline-block font-bold text-stampa-orange">Gestionar productos →</Link></Card>
      </aside>
    </div>
  </div>;
}
