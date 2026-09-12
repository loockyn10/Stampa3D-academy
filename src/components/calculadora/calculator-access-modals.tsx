"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, ChevronLeft, Loader2, LockKeyhole, Search, X } from "lucide-react";
import { PrinterCatalogImage } from "@/components/printers/PrinterCatalogImage";
import { buildCalculatorAuthHref } from "@/lib/calculator/guest-draft";
import type { CalculatorFilamentCatalogItem, CalculatorPrinterCatalogItem } from "@/lib/calculator/catalog-types";

function ModalFrame({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-6" onMouseDown={onClose}>
      <section className="flex max-h-[min(90dvh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-stampa-surface shadow-2xl" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-label={title}>
        {children}
      </section>
    </div>,
    document.body,
  );
}

export function CalculatorSignupModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalFrame onClose={onClose} title="Personalizá tus cálculos">
      <div className="relative p-6 text-center sm:p-8">
        <button onClick={onClose} className="absolute right-4 top-4 rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-white" aria-label="Cerrar"><X size={18} /></button>
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-stampa-orange/10 text-stampa-orange"><LockKeyhole size={22} /></span>
        <h2 className="text-xl font-bold text-white">Personalizá tus cálculos</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-400">Creá una cuenta gratis para calcular con tus propias impresoras y filamentos.</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href={buildCalculatorAuthHref("/registro")} className="rounded-xl bg-stampa-orange px-5 py-3 text-sm font-bold text-white hover:bg-stampa-orange-hover">Crear cuenta gratis</Link>
          <Link href={buildCalculatorAuthHref("/login")} className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">Ya tengo cuenta</Link>
        </div>
      </div>
    </ModalFrame>
  );
}

export function CalculatorPersonalizationModal({
  printers,
  filaments,
  initialPrinterId,
  initialFilamentId,
  onClose,
  onSaved,
}: {
  printers: CalculatorPrinterCatalogItem[];
  filaments: CalculatorFilamentCatalogItem[];
  initialPrinterId?: string | null;
  initialFilamentId?: string | null;
  onClose: () => void;
  onSaved: (printerId: string | null, filamentId: string | null, skipped: boolean) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [search, setSearch] = useState("");
  const [printerId, setPrinterId] = useState(initialPrinterId ?? "");
  const [filamentId, setFilamentId] = useState(initialFilamentId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedSearch = search.trim().toLocaleLowerCase("es");
  const visiblePrinters = useMemo(() => printers.filter((printer) => [printer.display_name, printer.brand, printer.model, printer.name].some((value) => value?.toLocaleLowerCase("es").includes(normalizedSearch))), [normalizedSearch, printers]);
  const visibleFilaments = useMemo(() => filaments.filter((filament) => [filament.display_name, filament.brand, filament.filament_type, filament.name, filament.color].some((value) => value?.toLocaleLowerCase("es").includes(normalizedSearch))), [filaments, normalizedSearch]);

  const persist = async (skipped: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/calculator/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultPrinterTemplateId: skipped ? null : printerId,
          defaultFilamentTemplateId: skipped ? null : filamentId,
          onboardingStatus: skipped ? "skipped" : "completed",
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "No pudimos guardar tu configuración.");
      onSaved(skipped ? null : printerId, skipped ? null : filamentId, skipped);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No pudimos guardar tu configuración.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} title="Personalizar calculadora">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-stampa-orange">Paso {step} de 2</p>
          <h2 className="mt-1 text-lg font-bold text-white">{step === 1 ? "¿Qué impresora usás?" : "¿Qué filamento usás normalmente?"}</h2>
          <p className="mt-1 text-xs text-gray-400">{step === 1 ? "Elegila una vez y Stampa la tendrá en cuenta automáticamente en tus cálculos." : "Elegí el material que querés usar como base para tus cálculos."}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-white" aria-label="Cerrar"><X size={18} /></button>
      </header>
      <div className="border-b border-white/10 p-4 sm:px-6">
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={step === 1 ? "Buscar marca o modelo..." : "Buscar marca, material o color..."} className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white outline-none focus:border-stampa-orange/60" />
        </label>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2 sm:p-6">
        {step === 1 ? visiblePrinters.map((printer) => {
          const selected = printerId === printer.id;
          return <button key={printer.id} onClick={() => setPrinterId(printer.id)} className={`overflow-hidden rounded-xl border text-left transition ${selected ? "border-stampa-orange bg-stampa-orange/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}>
            <PrinterCatalogImage imagePath={printer.image_path} alt={[printer.brand, printer.model || printer.name].filter(Boolean).join(" ")} className="h-28 w-full" />
            <span className="flex items-center justify-between gap-3 p-3"><span><span className="block text-xs text-gray-500">{printer.brand || "Impresora"}</span><span className="block text-sm font-semibold text-white">{printer.model || printer.name || printer.display_name}</span></span>{selected && <Check className="text-stampa-orange" size={18} />}</span>
          </button>;
        }) : visibleFilaments.map((filament) => {
          const selected = filamentId === filament.id;
          return <button key={filament.id} onClick={() => setFilamentId(filament.id)} className={`flex items-center justify-between gap-3 rounded-xl border p-4 text-left transition ${selected ? "border-stampa-orange bg-stampa-orange/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}>
            <span className="flex min-w-0 items-center gap-3"><span className="h-8 w-8 shrink-0 rounded-full border border-white/15" style={{ backgroundColor: filament.color_hex || "#737373" }} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-white">{filament.display_name}</span><span className="block text-xs text-gray-500">{filament.color || "Color sin especificar"} · {filament.default_total_grams} g · ${filament.default_purchase_price}</span></span></span>{selected && <Check className="shrink-0 text-stampa-orange" size={18} />}
          </button>;
        })}
      </div>
      <footer className="border-t border-white/10 bg-stampa-bg-soft p-4 sm:px-6">
        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button disabled={saving} onClick={() => void persist(true)} className="text-xs font-semibold text-gray-500 hover:text-white">Ahora no</button>
          <div className="flex gap-2">
            {step === 2 && <button onClick={() => { setStep(1); setSearch(""); }} className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-gray-300"><ChevronLeft size={15} /> Atrás</button>}
            {step === 1 ? <button disabled={!printerId} onClick={() => { setStep(2); setSearch(""); }} className="rounded-xl bg-stampa-orange px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">Continuar</button> : <button disabled={!filamentId || saving} onClick={() => void persist(false)} className="inline-flex items-center gap-2 rounded-xl bg-stampa-orange px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">{saving && <Loader2 className="animate-spin" size={15} />} Usar esta configuración</button>}
          </div>
        </div>
      </footer>
    </ModalFrame>
  );
}
