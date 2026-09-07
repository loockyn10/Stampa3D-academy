import { CheckCircle2 } from "lucide-react";
import { LandingSectionHeading } from "./LandingSectionHeading";
import { outcomes } from "./landing-content";

export function LandingResults() {
  return (
    <section id="resultados" className="scroll-mt-24 border-y border-stampa-border bg-zinc-950/60 py-24">
      <div className="container mx-auto px-5 md:px-6">
        <LandingSectionHeading
          eyebrow="Resultados concretos"
          title="Qué vas a poder hacer con Stampa"
          description="El objetivo no es sumar más información: es usarla para trabajar con mayor claridad y organización."
        />

        <ul className="mx-auto mt-14 grid max-w-5xl gap-4 md:grid-cols-2">
          {outcomes.map((outcome, index) => (
            <li
              key={outcome}
              className="stampa-card-interactive flex items-center gap-4 rounded-2xl border border-stampa-border bg-stampa-bg/80 p-5 text-zinc-200"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              </span>
              <span className="font-medium">{outcome}</span>
              <span className="ml-auto font-mono text-xs text-zinc-600">0{index + 1}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
