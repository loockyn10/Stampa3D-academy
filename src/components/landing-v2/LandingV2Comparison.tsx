import { Check, X } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const WITHOUT_STAMPA = [
  "Videos y respuestas sueltas",
  "No saber qué aprender después",
  "Costos calculados a ojo",
  "Stock y presupuestos separados",
  "Progreso difícil de seguir",
];

const WITH_STAMPA = [
  "Aprendizaje organizado por objetivos",
  "Stampy cuando aparece una duda",
  "Herramientas dentro del mismo espacio",
  "Stock, costos y presupuestos conectados",
  "Progreso centralizado",
];

export function LandingV2Comparison() {
  return (
    <section className="border-y border-white/[0.06] bg-[#1b1b1e] px-5 py-24 sm:px-8 sm:py-32 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <LandingV2SectionHeading
          eyebrow="Un cambio de forma de trabajar"
          title="Menos fragmentación. Más claridad para avanzar."
          align="center"
        />

        <div className="mt-14 grid overflow-hidden rounded-3xl border border-white/[0.09] bg-[#171719] lg:grid-cols-2">
          <div className="p-6 sm:p-9 lg:p-12">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Sin Stampa</p>
            <ul className="mt-7 space-y-4">
              {WITHOUT_STAMPA.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm leading-6 text-zinc-500 sm:text-base">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-zinc-600">
                    <X size={11} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative border-t border-white/[0.09] bg-[linear-gradient(145deg,rgba(255,120,10,0.08),transparent_55%)] p-6 sm:p-9 lg:border-l lg:border-t-0 lg:p-12">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-stampa-orange">Con Stampa</p>
            <ul className="mt-7 space-y-4">
              {WITH_STAMPA.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm leading-6 text-zinc-200 sm:text-base">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stampa-orange/12 text-stampa-orange">
                    <Check size={11} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
