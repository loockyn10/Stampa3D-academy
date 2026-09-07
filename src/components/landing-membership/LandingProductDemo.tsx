"use client";

import {
  BookOpen,
  Calculator,
  CheckCircle2,
  Database,
  FileText,
  PackageCheck,
} from "lucide-react";

import { LandingSectionHeading } from "@/components/landing-membership/LandingSectionHeading";
import AccordionGallery, {
  type AccordionGalleryItem,
} from "@/components/ui/accordion-gallery/AccordionGallery";

function PreviewWindow({ children }: { children: React.ReactNode }) {
  return (
    <span className="block h-full bg-[#0d0d10] p-4 pb-24 sm:p-7 sm:pb-24 lg:p-8 lg:pb-24">
      <span className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/75" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300/75" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/75" />
        </span>
        <span className="text-[10px] font-medium tracking-wide text-zinc-600">
          ACADEMIA STAMPA
        </span>
      </span>
      {children}
    </span>
  );
}

function AcademyPreview() {
  return (
    <PreviewWindow>
      <span className="mb-5 flex items-center gap-3 text-blue-300">
        <span className="rounded-xl border border-blue-400/20 bg-blue-400/10 p-2.5">
          <BookOpen className="h-5 w-5" />
        </span>
        <span className="text-lg font-bold text-white">Tu ruta de aprendizaje</span>
      </span>
      <span className="block rounded-2xl border border-white/10 bg-zinc-900/90 p-5 shadow-xl">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">
          Módulo 2 · Calibración y slicing
        </span>
        <span className="block text-xl font-bold text-white">
          Configuración de retracciones
        </span>
        <span className="mt-5 block h-2 overflow-hidden rounded-full bg-black/50">
          <span className="block h-full w-[68%] rounded-full bg-gradient-to-r from-blue-600 to-blue-300" />
        </span>
        <span className="mt-2 block text-right text-xs font-semibold text-blue-300">
          68% completado
        </span>
      </span>
      <span className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-200">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        La próxima clase ya está lista para vos
      </span>
    </PreviewWindow>
  );
}

function CalculatorPreview() {
  return (
    <PreviewWindow>
      <span className="mb-5 flex items-center gap-3 text-emerald-300">
        <span className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-2.5">
          <Calculator className="h-5 w-5" />
        </span>
        <span className="text-lg font-bold text-white">Cálculo de costos</span>
      </span>
      <span className="grid grid-cols-2 gap-3">
        <span className="rounded-xl border border-white/10 bg-zinc-900/90 p-4">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Material
          </span>
          <span className="mt-1 block text-xl font-bold text-white">135 g</span>
          <span className="mt-1 block text-xs text-zinc-500">PLA Negro</span>
        </span>
        <span className="rounded-xl border border-white/10 bg-zinc-900/90 p-4">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Tiempo
          </span>
          <span className="mt-1 block text-xl font-bold text-white">4h 20m</span>
          <span className="mt-1 block text-xs text-zinc-500">Impresión total</span>
        </span>
      </span>
      <span className="mt-4 block rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/15 to-emerald-950/20 p-5 text-center">
        <span className="block text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-300">
          Precio de venta sugerido
        </span>
        <span className="mt-1 block text-4xl font-black text-white">$18.700</span>
      </span>
    </PreviewWindow>
  );
}

function InventoryPreview() {
  const filaments = [
    { name: "PLA Negro", brand: "GST3D", amount: "742 g", color: "bg-zinc-950" },
    { name: "PLA Blanco", brand: "Grilon3", amount: "1000 g", color: "bg-white" },
    { name: "PETG Rojo", brand: "Sin stock", amount: "0 g", color: "bg-red-600" },
  ];

  return (
    <PreviewWindow>
      <span className="mb-5 flex items-center gap-3 text-orange-300">
        <span className="rounded-xl border border-orange-400/20 bg-orange-400/10 p-2.5">
          <Database className="h-5 w-5" />
        </span>
        <span className="text-lg font-bold text-white">Inventario en tiempo real</span>
      </span>
      <span className="space-y-3">
        {filaments.map((filament) => (
          <span
            key={filament.name}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900/90 p-4"
          >
            <span className="flex items-center gap-3">
              <span className={`h-4 w-4 rounded-full border border-white/30 ${filament.color}`} />
              <span>
                <span className="block text-sm font-bold text-white">{filament.name}</span>
                <span className="block text-xs text-zinc-500">{filament.brand}</span>
              </span>
            </span>
            <span className={filament.amount === "0 g" ? "font-bold text-red-400" : "font-bold text-orange-300"}>
              {filament.amount}
            </span>
          </span>
        ))}
      </span>
    </PreviewWindow>
  );
}

function QuotePreview() {
  return (
    <PreviewWindow>
      <span className="mb-5 flex items-center gap-3 text-violet-300">
        <span className="rounded-xl border border-violet-400/20 bg-violet-400/10 p-2.5">
          <FileText className="h-5 w-5" />
        </span>
        <span className="text-lg font-bold text-white">Presupuesto #PRE-0042</span>
      </span>
      <span className="block rounded-2xl border border-white/10 bg-zinc-900/90 p-5 shadow-xl">
        <span className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-xs text-zinc-500">Cliente</span>
            <span className="block text-lg font-bold text-white">Taller Racing SRL</span>
          </span>
          <span className="rounded-md border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-xs font-bold text-violet-200">
            Enviado
          </span>
        </span>
        <span className="my-5 block space-y-3 border-y border-white/10 py-4 text-sm">
          <span className="flex justify-between gap-3 text-zinc-400">
            <span>5 × Soporte motor PETG</span>
            <span className="font-medium text-white">$45.000</span>
          </span>
          <span className="flex justify-between gap-3 text-zinc-400">
            <span>12 × Tapa protectora PLA</span>
            <span className="font-medium text-white">$70.000</span>
          </span>
        </span>
        <span className="flex items-end justify-between">
          <span className="flex items-center gap-2 text-sm text-zinc-400">
            <PackageCheck className="h-4 w-4" /> Total
          </span>
          <span className="text-3xl font-black text-white">$115.000</span>
        </span>
      </span>
    </PreviewWindow>
  );
}

const galleryItems: AccordionGalleryItem[] = [
  {
    label: "Academia",
    description: "Sabé exactamente qué aprender después.",
    content: <AcademyPreview />,
  },
  {
    label: "Calculadora",
    description: "Conocé el costo y margen de cada trabajo.",
    content: <CalculatorPreview />,
  },
  {
    label: "Inventario",
    description: "Evitá comenzar trabajos sin material suficiente.",
    content: <InventoryPreview />,
  },
  {
    label: "Presupuestos",
    description: "Enviá propuestas profesionales en minutos.",
    content: <QuotePreview />,
  },
];

export function LandingProductDemo() {
  return (
    <section
      id="plataforma"
      className="relative overflow-hidden border-b border-stampa-border bg-stampa-bg py-20 md:py-28"
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-72 -translate-y-1/2 bg-orange-500/5 blur-3xl" />
      <div className="container relative mx-auto px-4 sm:px-6">
        <LandingSectionHeading
          title="Así funciona tu taller dentro de Stampa"
          description="Explorá cómo formación, costos, materiales y presupuestos trabajan conectados dentro de la misma plataforma."
        />

        <div className="mx-auto mt-12 max-w-6xl md:mt-16">
          <AccordionGallery
            items={galleryItems}
            defaultIndex={0}
            height={510}
            gap={12}
            radius={22}
            expandRatio={0.62}
            duration={0.55}
            ease="power3.out"
            tilt={2.5}
          />
          <p className="mt-5 text-center text-xs font-medium text-zinc-500">
            Tocá cada herramienta para explorar cómo se conecta con tu taller.
          </p>
        </div>
      </div>
    </section>
  );
}
