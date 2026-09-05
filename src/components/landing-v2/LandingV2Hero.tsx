import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { LandingV2ProductPreview } from "./LandingV2ProductPreview";

export function LandingV2Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-[calc(5rem+env(safe-area-inset-top))]">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_82%)]"
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[-18rem] -z-10 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-stampa-orange/[0.09] blur-[130px]"
      />

      <div className="mx-auto grid w-full max-w-7xl items-center gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20 lg:grid-cols-[0.88fr_1.12fr] lg:gap-10 lg:px-10 lg:pb-24 lg:pt-24 xl:gap-16">
        <div className="mx-auto max-w-2xl text-center lg:mx-0 lg:text-left">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-stampa-orange/20 bg-stampa-orange/[0.07] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-orange-300 sm:text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-stampa-orange" />
            Tu ecosistema para impresión 3D
          </div>

          <h1 className="text-[clamp(2.8rem,8vw,4.9rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-white lg:text-[clamp(4.2rem,5.45vw,5.4rem)]">
            <span className="block">Aprendé.</span>
            <span className="block text-stampa-orange">Gestioná.</span>
            <span className="block">Hacé crecer</span>
            <span className="block text-zinc-400">tu mundo 3D.</span>
          </h1>

          <p className="mx-auto mt-7 max-w-xl text-base leading-7 text-zinc-400 sm:text-lg sm:leading-8 lg:mx-0">
            Cursos, herramientas para tu taller y negocio, comunidad y una IA integrada que te acompaña para resolver problemas, ahorrar tiempo y seguir avanzando.
          </p>

          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 min-[430px]:flex-row lg:justify-start">
            <Link
              href="/registro"
              className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-stampa-orange px-6 py-3 text-sm font-bold text-white shadow-[0_16px_40px_-16px_rgba(255,120,10,0.85)] transition-colors hover:bg-stampa-orange-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              Entrar a Stampa
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="#producto"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.035] px-6 py-3 text-sm font-semibold text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stampa-orange"
            >
              Ver cómo funciona
              <ArrowDown size={16} />
            </Link>
          </div>

          <p className="mt-5 text-sm text-zinc-500">
            Para makers, emprendedores y negocios de impresión 3D.
          </p>
        </div>

        <LandingV2ProductPreview />
      </div>
    </section>
  );
}
