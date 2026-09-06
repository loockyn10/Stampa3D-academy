import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function LandingV2FinalCta() {
  return (
    <section className="px-5 py-24 sm:px-8 sm:py-32 lg:px-10">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2.25rem] border border-white/[0.08] bg-[#1b1b1e] px-6 py-16 text-center sm:px-12 sm:py-20">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,120,10,0.2),transparent_47%)]" />
        <div className="relative mx-auto max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-stampa-orange">Empezá a construir</p>
          <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-5xl">
            Todo tu mundo 3D puede estar en un solo lugar.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-zinc-400 sm:text-lg">
            Aprendé, resolvé y organizá tu trabajo con una plataforma pensada alrededor de la impresión 3D.
          </p>
          <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link
              href="/registro"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-stampa-orange px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-stampa-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Empezar en Stampa
              <ArrowRight size={17} />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] px-6 py-3.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stampa-orange"
            >
              Ya tengo cuenta
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
