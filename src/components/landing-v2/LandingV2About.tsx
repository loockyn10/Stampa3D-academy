import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

export function LandingV2About() {
  return (
    <section className="border-y border-white/[0.06] bg-[#151517] px-5 py-24 sm:px-8 sm:py-32 lg:px-10">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div className="relative mx-auto flex aspect-square w-full max-w-sm items-center justify-center overflow-hidden rounded-[2.5rem] border border-white/[0.08] bg-[radial-gradient(circle_at_center,rgba(255,120,10,0.14),transparent_58%)]">
          <div className="absolute inset-8 rounded-full border border-white/[0.05]" />
          <div className="absolute inset-16 rounded-full border border-white/[0.07]" />
          <Image
            src="/favicon.svg"
            alt="Logo de Stampa"
            width={144}
            height={144}
            className="relative h-28 w-28 object-contain drop-shadow-[0_18px_45px_rgba(255,120,10,0.22)] sm:h-36 sm:w-36"
          />
          <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between rounded-2xl border border-white/[0.08] bg-black/25 px-4 py-3 backdrop-blur-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">Equipo Stampa</span>
            <ArrowUpRight size={16} className="text-stampa-orange" />
          </div>
        </div>

        <div>
          <LandingV2SectionHeading
            eyebrow="Quiénes están detrás"
            title="Personas construyendo para personas que imprimen."
            description="Stampa nace de una idea simple: acercar aprendizaje, herramientas y comunidad en una experiencia que acompañe el trabajo real con impresión 3D."
          />
          <div className="mt-8 space-y-4 text-sm leading-7 text-zinc-400 sm:text-base">
            <p>
              La plataforma conecta lo que aprendés con lo que necesitás resolver en tu taller, para que el conocimiento no quede separado de la práctica.
            </p>
            <p className="text-zinc-500">
              La historia y las personas del equipo tendrán su propio espacio cuando el contenido público esté listo para presentarse con el contexto que merece.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
