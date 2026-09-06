import Image from "next/image";
import {
  Archive,
  BookOpen,
  Bot,
  Boxes,
  Calculator,
  Check,
  ChevronRight,
  CirclePlay,
  FileText,
  Home,
  Package,
  Sparkles,
} from "lucide-react";

const APP_NAVIGATION = [
  { label: "Inicio", icon: Home, active: false },
  { label: "Stampy IA", icon: Sparkles, active: false },
  { label: "Academia", icon: BookOpen, active: true },
  { label: "Calculadora", icon: Calculator, active: false },
  { label: "Presupuestos", icon: FileText, active: false },
  { label: "Productos", icon: Package, active: false },
  { label: "Stock", icon: Archive, active: false },
];

export function LandingV2ProductPreview() {
  return (
    <div id="producto" className="relative mx-auto w-full max-w-3xl scroll-mt-24 lg:mx-0 xl:-mr-6 xl:w-[calc(100%+1.5rem)] xl:max-w-none">
      <div
        aria-hidden="true"
        className="absolute -inset-8 -z-10 rounded-[3rem] bg-[radial-gradient(circle_at_70%_40%,rgba(255,120,10,0.13),transparent_60%)] blur-2xl"
      />

      {/* Componente aislado para una futura interacción Scroll Expand. */}
      <div className="relative overflow-hidden rounded-[1.35rem] border border-white/[0.13] bg-[#111113] shadow-[0_32px_90px_-28px_rgba(0,0,0,0.95)] sm:rounded-[1.75rem]">
        <div className="flex h-10 items-center justify-between border-b border-white/[0.08] bg-[#1d1d20] px-3 sm:h-12 sm:px-4">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-[#ff6b5f] sm:h-2.5 sm:w-2.5" />
            <span className="h-2 w-2 rounded-full bg-[#f6bf4f] sm:h-2.5 sm:w-2.5" />
            <span className="h-2 w-2 rounded-full bg-[#65c466] sm:h-2.5 sm:w-2.5" />
          </div>
          <div className="flex items-center gap-2 text-[9px] font-medium text-zinc-500 sm:text-[10px]">
            <span className="hidden sm:inline">academia.stampa3d.com</span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Online
          </div>
        </div>

        <div className="grid min-h-[390px] grid-cols-1 sm:min-h-[430px] md:grid-cols-[150px_1fr]">
          <aside className="hidden border-r border-white/[0.08] bg-[#161618] px-3 py-5 md:block">
            <div className="mb-7 flex items-center gap-2 px-2">
              <Image src="/favicon.svg" alt="" width={27} height={27} className="h-7 w-7 object-contain" />
              <div>
                <p className="text-[11px] font-bold leading-none text-white">Stampa</p>
                <p className="mt-1 text-[8px] text-zinc-600">Academia 3D</p>
              </div>
            </div>
            <div className="space-y-1">
              {APP_NAVIGATION.map(({ label, icon: Icon, active }) => (
                <div
                  key={label}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[9px] font-medium ${
                    active ? "bg-stampa-orange/10 text-stampa-orange" : "text-zinc-600"
                  }`}
                >
                  <Icon size={12} />
                  {label}
                </div>
              ))}
            </div>
          </aside>

          <div className="relative min-w-0 bg-[#18181a] p-4 sm:p-5 lg:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-stampa-orange">Buen día, Maker</p>
                <h2 className="mt-1.5 text-lg font-bold tracking-tight text-white sm:text-xl">¿Qué querés resolver hoy?</h2>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[9px] font-bold text-zinc-300">
                MS
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[1.32fr_0.68fr]">
              <div id="preview-academia" className="rounded-xl border border-white/[0.09] bg-[#222225] p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stampa-orange/10 text-stampa-orange">
                    <CirclePlay size={17} />
                  </div>
                  <span className="rounded-full border border-white/[0.08] px-2 py-1 text-[8px] font-semibold text-zinc-500">EN CURSO</span>
                </div>
                <p className="mt-4 text-[9px] font-medium text-zinc-500">Continuá aprendiendo</p>
                <h3 className="mt-1 text-sm font-bold leading-snug text-zinc-100">Fundamentos de impresión 3D</h3>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div className="h-full w-[68%] rounded-full bg-stampa-orange" />
                </div>
                <div className="mt-2 flex justify-between text-[8px] text-zinc-600">
                  <span>8 de 12 lecciones</span>
                  <span>68%</span>
                </div>
              </div>

              <div id="preview-herramientas" className="rounded-xl border border-white/[0.09] bg-[#222225] p-4">
                <div className="flex items-center justify-between">
                  <Boxes size={16} className="text-emerald-400" />
                  <span className="text-[8px] font-semibold text-emerald-400">Stock saludable</span>
                </div>
                <p className="mt-5 text-[9px] text-zinc-500">PLA Negro</p>
                <p className="mt-1 text-xl font-bold text-white">840 g</p>
                <div className="mt-3 flex items-center gap-1.5 text-[8px] text-zinc-500">
                  <Check size={10} className="text-emerald-400" />
                  Inventario actualizado
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 min-[430px]:grid-cols-3">
              {[
                ["Cursos activos", "3"],
                ["Productos", "18"],
                ["Presupuestos", "7"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
                  <p className="text-sm font-bold text-zinc-200">{value}</p>
                  <p className="mt-0.5 text-[8px] text-zinc-600">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        id="preview-stampy"
        className="relative -mt-10 ml-auto w-[min(90%,20rem)] rounded-2xl border border-cyan-400/20 bg-[#202326]/95 p-4 shadow-[0_24px_55px_-22px_rgba(0,0,0,0.95)] backdrop-blur sm:absolute sm:-bottom-8 sm:-right-4 sm:mt-0 sm:w-[19rem] lg:-right-7"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
            <Bot size={16} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-white">Stampy</p>
            <p className="text-[8px] text-cyan-300/70">Tu asistente de impresión 3D</p>
          </div>
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.7)]" />
        </div>
        <div className="mt-3 rounded-xl bg-white/[0.045] p-3 text-[10px] leading-4 text-zinc-300">
          Tu primera capa parece demasiado alta. Revisemos nivelación y offset antes de cambiar el perfil.
        </div>
        <div className="mt-3 flex items-center justify-end gap-1 text-[8px] font-semibold text-cyan-300">
          Ver recomendación <ChevronRight size={10} />
        </div>
      </div>
    </div>
  );
}
