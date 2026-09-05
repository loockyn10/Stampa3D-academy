import { BookOpen, BrainCircuit, ChartNoAxesCombined, Wrench } from "lucide-react";

const VALUE_ITEMS = [
  {
    label: "Aprender",
    description: "Cursos y talleres.",
    icon: BookOpen,
  },
  {
    label: "Resolver",
    description: "Stampy + IA.",
    icon: BrainCircuit,
  },
  {
    label: "Gestionar",
    description: "Taller y negocio.",
    icon: Wrench,
  },
  {
    label: "Crecer",
    description: "Entendé qué funciona y qué mejorar.",
    icon: ChartNoAxesCombined,
  },
];

export function LandingV2ValueStrip() {
  return (
    <section id="areas" aria-label="Lo que integra Academia Stampa" className="relative scroll-mt-24 px-5 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-7xl border-y border-white/[0.08]">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          {VALUE_ITEMS.map(({ label, description, icon: Icon }, index) => (
            <div
              key={label}
              className={`flex min-h-28 items-start gap-3.5 py-6 sm:px-6 lg:min-h-32 lg:py-8 ${
                index % 2 === 1 ? "sm:border-l sm:border-white/[0.08]" : ""
              } ${index > 1 ? "border-t border-white/[0.08] lg:border-t-0" : ""} ${
                index > 0 ? "lg:border-l lg:border-white/[0.08]" : ""
              }`}
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stampa-orange/[0.08] text-stampa-orange">
                <Icon size={15} strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-200">{label}</p>
                <p className="mt-2 max-w-[15rem] text-sm leading-5 text-zinc-400/80">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
