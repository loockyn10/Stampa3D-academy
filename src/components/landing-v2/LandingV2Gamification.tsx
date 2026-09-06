import { Award, BookOpenCheck, Medal } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

export function LandingV2Gamification() {
  return (
    <section className="px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-36">
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1fr_0.9fr] lg:gap-20">
        <div className="order-2 overflow-hidden rounded-3xl border border-white/[0.09] bg-[#1b1b1e] p-6 sm:p-8 lg:order-1">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Tu aprendizaje</p>
              <h3 className="mt-2 text-xl font-bold text-white">Progreso visible</h3>
            </div>
            <BookOpenCheck size={24} className="text-stampa-orange" />
          </div>
          <div className="mt-8 space-y-5">
            <div>
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Curso actual</span>
                <span>En progreso</span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full w-[64%] rounded-full bg-stampa-orange" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                <Award size={18} className="text-amber-300" />
                <p className="mt-4 text-sm font-bold text-zinc-200">Insignias</p>
                <p className="mt-1 text-[10px] text-zinc-600">Reconocimientos de tu recorrido</p>
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                <Medal size={18} className="text-orange-300" />
                <p className="mt-4 text-sm font-bold text-zinc-200">Nivel de miembro</p>
                <p className="mt-1 text-[10px] text-zinc-600">Tu evolución dentro de Stampa</p>
              </div>
            </div>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <LandingV2SectionHeading
            eyebrow="Progreso y reconocimiento"
            title="Ver cuánto avanzaste también ayuda a seguir."
            description="Tus cursos guardan progreso y tu perfil reúne nivel e insignias para que el recorrido no se pierda entre sesiones."
          />
          <p className="mt-6 text-xs leading-5 text-zinc-600">Esta versión muestra únicamente capacidades que ya existen en el producto: progreso, nivel de miembro e insignias.</p>
        </div>
      </div>
    </section>
  );
}
