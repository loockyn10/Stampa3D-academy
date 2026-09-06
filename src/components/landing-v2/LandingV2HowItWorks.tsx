import { Compass, Route, Sparkles } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const STEPS = [
  {
    number: "01",
    title: "Elegí qué querés conseguir.",
    description: "Partí de una meta: aprender, mejorar una impresión u ordenar tu taller.",
    icon: Compass,
  },
  {
    number: "02",
    title: "Seguí tu camino.",
    description: "Usá una ruta, una herramienta o una clase según lo que necesitás ahora.",
    icon: Route,
  },
  {
    number: "03",
    title: "Aprendé y resolvé acompañado.",
    description: "Volvé a Stampy, a tus herramientas y a la comunidad cada vez que lo necesites.",
    icon: Sparkles,
  },
];

export function LandingV2HowItWorks() {
  return (
    <section className="border-y border-white/[0.06] bg-[#1d1d20] px-5 py-24 sm:px-8 sm:py-32 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <LandingV2SectionHeading eyebrow="Cómo funciona" title="Un camino simple para seguir avanzando." />

        {/* Estructura aislada para un futuro Stepper. */}
        <ol className="relative mt-14 grid gap-10 lg:grid-cols-3 lg:gap-8">
          <div aria-hidden="true" className="absolute left-0 right-0 top-7 hidden border-t border-dashed border-white/10 lg:block" />
          {STEPS.map(({ number, title, description, icon: Icon }) => (
            <li key={number} className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-stampa-orange/25 bg-[#1d1d20] text-stampa-orange shadow-[0_0_0_8px_#1d1d20]">
                <Icon size={20} />
              </div>
              <p className="mt-8 font-mono text-[10px] font-bold tracking-[0.2em] text-stampa-orange">PASO {number}</p>
              <h3 className="mt-3 text-xl font-bold text-white sm:text-2xl">{title}</h3>
              <p className="mt-4 max-w-sm text-sm leading-6 text-zinc-500 sm:text-base sm:leading-7">{description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
