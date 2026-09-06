import { ArrowUpRight, BookOpen, Layers3, Route } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const FEATURED_COURSES = [
  {
    title: "Impresión 3D desde cero",
    area: "Fundamentos",
    description: "Máquinas, materiales, calibración y primeras impresiones.",
  },
  {
    title: "OrcaSlicer",
    area: "Slicer",
    description: "Perfiles, soportes, adhesión y ajustes de laminado.",
  },
  {
    title: "Diseño 3D con Fusion 360",
    area: "Diseño",
    description: "Modelado de piezas propias preparadas para imprimir.",
  },
  {
    title: "Costos y presupuestos para impresión 3D",
    area: "Negocio",
    description: "Criterios para calcular costos y presentar presupuestos.",
  },
];

export function LandingV2Courses() {
  return (
    <section id="academia" className="scroll-mt-16 px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-40">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-end gap-8 lg:grid-cols-[1fr_auto]">
          <LandingV2SectionHeading
            eyebrow="Academia"
            title="Contenido estructurado para entender, no solamente copiar."
            description="Avanzá desde fundamentos hasta slicers, diseño y negocio con cursos organizados y progreso visible."
          />
          <div className="flex gap-6 text-xs text-zinc-500 lg:pb-2">
            <span className="flex items-center gap-2"><Route size={14} className="text-stampa-orange" /> Rutas recomendadas</span>
            <span className="flex items-center gap-2"><Layers3 size={14} className="text-stampa-orange" /> Distintos niveles</span>
          </div>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-2">
          {FEATURED_COURSES.map(({ title, area, description }, index) => (
            <article key={title} className="group relative min-h-64 overflow-hidden rounded-3xl border border-white/[0.09] bg-[#1d1d20] p-6 sm:p-8">
              <div aria-hidden="true" className={`absolute inset-y-0 right-0 w-2/5 ${index % 2 === 0 ? "bg-[radial-gradient(circle_at_right,rgba(255,120,10,0.11),transparent_70%)]" : "bg-[radial-gradient(circle_at_right,rgba(255,255,255,0.05),transparent_70%)]"}`} />
              <div className="relative flex h-full flex-col">
                <div className="flex items-center justify-between">
                  <span className="rounded-full border border-stampa-orange/20 bg-stampa-orange/[0.06] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-orange-300">{area}</span>
                  <BookOpen size={18} className="text-zinc-600 transition-colors group-hover:text-stampa-orange" />
                </div>
                <h3 className="mt-12 max-w-md text-xl font-bold leading-snug text-white sm:text-2xl">{title}</h3>
                <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">{description}</p>
                <div className="mt-auto flex items-center gap-2 pt-7 text-xs font-semibold text-zinc-400">
                  Ver dentro de la academia <ArrowUpRight size={14} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
