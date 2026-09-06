import {
  BriefcaseBusiness,
  Box,
  Gauge,
  Printer,
  Rocket,
  SlidersHorizontal,
} from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const LEARNING_PATHS = [
  {
    goal: "Empezar desde cero",
    evidence: "Impresión 3D desde cero",
    description: "Entendé la máquina, los materiales y tu primera impresión.",
    icon: Rocket,
  },
  {
    goal: "Mejorar mis impresiones",
    evidence: "Calibración y criterios de calidad",
    description: "Comprendé por qué aparece un problema antes de copiar ajustes.",
    icon: Gauge,
  },
  {
    goal: "Bambu Studio",
    evidence: "Flujo para impresoras Bambu Lab",
    description: "Ordená perfiles, preparación y mantenimiento de tu equipo.",
    icon: Printer,
  },
  {
    goal: "OrcaSlicer",
    evidence: "Curso de OrcaSlicer",
    description: "Perfiles, soportes, adhesión y configuración del laminado.",
    icon: SlidersHorizontal,
  },
  {
    goal: "Diseño 3D",
    evidence: "Diseño 3D con Fusion 360",
    description: "Pasá de una idea a una pieza propia lista para imprimir.",
    icon: Box,
  },
  {
    goal: "Negocios",
    evidence: "Costos y presupuestos para impresión 3D",
    description: "Construí precios y procesos con más información.",
    icon: BriefcaseBusiness,
  },
];

export function LandingV2LearningPaths() {
  return (
    <section className="border-y border-white/[0.06] bg-[#151517] px-5 py-24 sm:px-8 sm:py-32 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <LandingV2SectionHeading
          eyebrow="Elegí por objetivo"
          title="¿Qué querés aprender?"
          description="No necesitás recorrer un catálogo a ciegas. Empezá por el resultado que buscás y encontrá contenido relacionado."
        />

        {/* Aislado para una futura Chroma Grid y Target Cursor. */}
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.08] sm:grid-cols-2 lg:grid-cols-3">
          {LEARNING_PATHS.map(({ goal, evidence, description, icon: Icon }) => (
            <article key={goal} className="group min-h-56 bg-[#1b1b1e] p-6 transition-colors hover:bg-[#202023] sm:p-7">
              <div className="flex items-center justify-between">
                <Icon size={21} className="text-stampa-orange" />
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">Objetivo</span>
              </div>
              <h3 className="mt-8 text-xl font-bold text-white">{goal}</h3>
              <p className="mt-2 text-xs font-semibold text-orange-300/80">{evidence}</p>
              <p className="mt-4 text-sm leading-6 text-zinc-500">{description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
