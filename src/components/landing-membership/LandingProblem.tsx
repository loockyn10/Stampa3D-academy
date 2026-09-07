import { Check, X } from "lucide-react";
import { LandingSectionHeading } from "./LandingSectionHeading";

const problems = [
  "Cobrar a ojo sin conocer el margen.",
  "Tardar demasiado en preparar un presupuesto.",
  "Quedarte sin filamento durante un trabajo.",
  "Aprender con tutoriales desordenados.",
  "Perder material mediante prueba y error.",
] as const;

const changes = [
  "Definir precios desde costos concretos.",
  "Preparar propuestas claras en minutos.",
  "Revisar el stock antes de producir.",
  "Seguir una ruta de aprendizaje ordenada.",
  "Tomar decisiones con información del taller.",
] as const;

export function LandingProblem() {
  return (
    <section id="problema" className="relative scroll-mt-24 overflow-hidden bg-stampa-bg py-24">
      <div className="absolute left-1/2 top-1/2 hidden h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-stampa-orange/10 blur-[150px] md:block" aria-hidden="true" />
      <div className="container relative z-10 mx-auto px-5 md:px-6">
        <LandingSectionHeading
          eyebrow="El problema"
          title="La diferencia entre un hobby y un negocio"
          description="La impresora puede funcionar perfecto y, aun así, el taller perder tiempo y material por falta de un sistema."
        />

        <div className="mx-auto mt-14 flex max-w-5xl flex-col gap-6 lg:flex-row">
          <article className="w-full rounded-3xl border border-zinc-800 bg-black/20 p-7 md:p-10 lg:w-1/2">
            <h3 className="flex items-center gap-3 text-2xl font-bold text-zinc-300">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
                <X className="h-4 w-4 text-zinc-500" />
              </span>
              Sin un sistema
            </h3>
            <ul className="mt-8 space-y-5">
              {problems.map((problem) => (
                <li key={problem} className="flex items-start gap-3 text-zinc-400">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500/10">
                    <X className="h-3 w-3 text-red-400" />
                  </span>
                  {problem}
                </li>
              ))}
            </ul>
          </article>

          <article className="relative w-full overflow-hidden rounded-3xl border border-stampa-orange/40 bg-zinc-900/65 p-7 md:p-10 lg:w-1/2">
            <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-stampa-orange/10 blur-3xl" aria-hidden="true" />
            <h3 className="relative flex items-center gap-3 text-2xl font-bold text-white">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-stampa-orange/50 bg-stampa-orange/20">
                <Check className="h-4 w-4 text-orange-400" />
              </span>
              Con Academia Stampa
            </h3>
            <ul className="relative mt-8 space-y-5">
              {changes.map((change) => (
                <li key={change} className="flex items-start gap-3 text-zinc-200">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10">
                    <Check className="h-3 w-3 text-emerald-400" />
                  </span>
                  {change}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
