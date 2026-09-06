import Image from "next/image";
import {
  BookOpen,
  Bot,
  Boxes,
  Calculator,
  CheckCircle2,
  LayoutDashboard,
  Package,
} from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const TOUR_NAVIGATION = [
  { label: "Inicio", icon: LayoutDashboard, active: true },
  { label: "Academia", icon: BookOpen, active: false },
  { label: "Stampy", icon: Bot, active: false },
  { label: "Calculadora", icon: Calculator, active: false },
  { label: "Stock", icon: Boxes, active: false },
  { label: "Productos", icon: Package, active: false },
];

export function LandingV2PlatformTour() {
  return (
    <section className="px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-36">
      <div className="mx-auto max-w-7xl">
        <LandingV2SectionHeading
          eyebrow="La plataforma por dentro"
          title="Aprender y trabajar, sin cambiar de contexto."
          description="La experiencia conecta tu progreso con las herramientas que usás todos los días en el taller."
          align="center"
        />

        {/* Visual principal aislado para una futura interacción Scroll Expand. */}
        <div className="relative mt-14 sm:mt-16">
          <div aria-hidden="true" className="absolute inset-x-[12%] -top-10 h-32 rounded-full bg-stampa-orange/10 blur-[90px]" />
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.12] bg-[#111113] shadow-[0_35px_100px_-35px_rgba(0,0,0,0.9)] sm:rounded-[2rem]">
            <div className="flex h-11 items-center justify-between border-b border-white/[0.08] bg-[#1d1d20] px-4 sm:h-13 sm:px-6">
              <div className="flex gap-1.5" aria-hidden="true">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </div>
              <p className="text-[9px] font-medium text-zinc-600 sm:text-[10px]">Academia Stampa</p>
            </div>

            <div className="grid min-h-[470px] md:grid-cols-[190px_1fr]">
              <aside className="hidden border-r border-white/[0.08] bg-[#151517] p-5 md:block">
                <div className="flex items-center gap-2.5 px-2">
                  <Image src="/favicon.svg" alt="" width={30} height={30} className="h-8 w-8 object-contain" />
                  <div>
                    <p className="text-xs font-bold text-white">Stampa</p>
                    <p className="text-[9px] text-zinc-600">Todo tu mundo 3D</p>
                  </div>
                </div>
                <div className="mt-8 space-y-1.5">
                  {TOUR_NAVIGATION.map(({ label, icon: Icon, active }) => (
                    <div key={label} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[11px] font-medium ${active ? "bg-stampa-orange/10 text-stampa-orange" : "text-zinc-600"}`}>
                      <Icon size={14} />
                      {label}
                    </div>
                  ))}
                </div>
              </aside>

              <div className="min-w-0 bg-[#19191b] p-4 sm:p-7 lg:p-9">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-stampa-orange">Tu espacio</p>
                    <h3 className="mt-2 text-xl font-bold text-white sm:text-2xl">Un punto de partida para cada día.</h3>
                  </div>
                  <p className="text-xs text-zinc-600">Contenido ficticio de demostración</p>
                </div>

                <div className="mt-7 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
                  <div className="rounded-2xl border border-white/[0.08] bg-[#222225] p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs text-zinc-500">Seguís aprendiendo</p>
                        <p className="mt-1.5 font-bold text-white">Impresión 3D desde cero</p>
                      </div>
                      <BookOpen size={20} className="text-stampa-orange" />
                    </div>
                    <div className="mt-8 h-2 rounded-full bg-white/[0.06]">
                      <div className="h-full w-[62%] rounded-full bg-stampa-orange" />
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-500">
                      <CheckCircle2 size={12} className="text-emerald-400" />
                      Tu avance queda en un mismo lugar
                    </div>
                  </div>

                  <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-5">
                    <div className="flex items-center gap-2 text-cyan-300">
                      <Bot size={17} />
                      <span className="text-xs font-bold">Stampy</span>
                    </div>
                    <p className="mt-5 text-sm leading-6 text-zinc-300">¿Querés seguir la clase o resolver primero un problema de impresión?</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Calcular", "Revisá un costo"],
                    ["Organizar", "Actualizá tu stock"],
                    ["Avanzar", "Volvé a tu ruta"],
                  ].map(([title, detail]) => (
                    <div key={title} className="border-l border-white/[0.1] px-4 py-3">
                      <p className="text-sm font-bold text-zinc-200">{title}</p>
                      <p className="mt-1 text-[11px] text-zinc-600">{detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
