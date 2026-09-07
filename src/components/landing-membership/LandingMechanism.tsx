import { ArrowRight, BookOpenCheck, BriefcaseBusiness, Boxes } from "lucide-react";
import { LandingSectionHeading } from "./LandingSectionHeading";
import { mechanismSteps } from "./landing-content";

const icons = [BookOpenCheck, Boxes, BriefcaseBusiness] as const;

export function LandingMechanism() {
  return (
    <section
      id="mecanismo"
      className="scroll-mt-24 border-y border-stampa-border bg-zinc-950/60 py-24"
    >
      <div className="container mx-auto px-5 md:px-6">
        <LandingSectionHeading
          eyebrow="El mecanismo"
          title="El sistema Stampa para convertir conocimiento en un taller organizado"
          description="Tres etapas conectadas para que aprender no quede separado de producir, presupuestar y vender."
        />

        <ol className="relative mx-auto mt-16 grid max-w-6xl gap-6 lg:grid-cols-3">
          <div className="absolute left-[16.66%] right-[16.66%] top-10 hidden h-px bg-gradient-to-r from-transparent via-orange-500/70 to-transparent lg:block" aria-hidden="true" />
          {mechanismSteps.map((step, index) => {
            const Icon = icons[index];
            return (
              <li key={step.number} className="relative">
                <article className="stampa-card-interactive h-full rounded-3xl border border-stampa-border bg-stampa-bg/90 p-7 md:p-8">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold tracking-[0.18em] text-orange-400">
                      PASO {step.number}
                    </span>
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-stampa-orange/25 bg-stampa-orange/10 text-orange-400">
                      <Icon className="h-6 w-6" />
                    </span>
                  </div>
                  <h3 className="mt-8 text-2xl font-bold text-white">{step.title}</h3>
                  <p className="mt-4 leading-relaxed text-zinc-400">{step.description}</p>
                </article>
                {index < mechanismSteps.length - 1 ? (
                  <ArrowRight className="absolute -right-4 top-8 z-10 hidden h-8 w-8 rounded-full border border-stampa-orange/30 bg-stampa-bg p-1.5 text-orange-400 lg:block" aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
