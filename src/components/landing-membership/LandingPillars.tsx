import { BookOpenCheck, Bot, Boxes, Check, Factory, LineChart } from "lucide-react";
import { LandingSectionHeading } from "./LandingSectionHeading";
import { pillars } from "./landing-content";

const pillarIcons = [BookOpenCheck, LineChart, Factory, Bot] as const;

export function LandingPillars() {
  return (
    <section id="pilares" className="scroll-mt-24 bg-stampa-bg py-24 text-white">
      <div className="container mx-auto px-5 md:px-6">
        <LandingSectionHeading
          eyebrow="Cuatro pilares"
          title="No es solamente un curso. Es un sistema para construir tu taller."
          description="Cada parte cumple una función distinta y se conecta con la siguiente para acompañarte desde la primera impresión hasta la gestión diaria."
        />

        <div className="mt-16 grid gap-6 lg:grid-cols-2">
          {pillars.map((pillar, index) => {
            const Icon = pillarIcons[index];
            return (
              <article
                key={pillar.key}
                className="group relative overflow-hidden rounded-3xl border border-stampa-border bg-zinc-900/50 p-7 transition-all duration-300 hover:border-stampa-orange/40 hover:bg-zinc-900 md:p-9"
              >
                <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-stampa-orange/5 blur-3xl transition-colors group-hover:bg-stampa-orange/10" aria-hidden="true" />
                <div className="relative flex items-start gap-5">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-stampa-orange/25 bg-stampa-orange/10 text-orange-400 transition-transform group-hover:scale-105">
                    <Icon className="h-7 w-7" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-orange-400">{pillar.result}</p>
                    <h3 className="mt-1 text-3xl font-bold text-white">{pillar.name}</h3>
                  </div>
                </div>

                <p className="relative mt-6 leading-relaxed text-zinc-400">
                  {pillar.description}
                </p>

                <ul className="relative mt-7 grid gap-3 sm:grid-cols-2">
                  {pillar.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-zinc-200">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
                      {feature}
                    </li>
                  ))}
                </ul>

                {"roadmap" in pillar ? (
                  <div className="relative mt-8 rounded-2xl border border-white/8 bg-black/20 p-5">
                    <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                      <Boxes className="h-4 w-4 text-orange-400" />
                      Ruta formativa
                    </div>
                    <ol className="grid gap-3 sm:grid-cols-2">
                      {pillar.roadmap.map((step, stepIndex) => (
                        <li key={step} className="flex items-center gap-3 text-sm text-zinc-300">
                          <span className="font-mono text-xs text-orange-400">0{stepIndex + 1}</span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
