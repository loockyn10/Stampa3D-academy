import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { landingPrimaryCta } from "./landing-content";

export function LandingFinalCta() {
  return (
    <section id="cta-final" className="relative overflow-hidden border-t border-stampa-border bg-stampa-bg py-24">
      <div className="absolute inset-0" aria-hidden="true">
        <div className="absolute bottom-0 left-1/2 h-[420px] w-full max-w-4xl -translate-x-1/2 rounded-full bg-stampa-orange/20 blur-[130px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      <div className="container relative z-10 mx-auto px-5 text-center md:px-6">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-orange-400">
          Tu próximo paso
        </p>
        <h2 className="mx-auto mt-5 max-w-4xl text-4xl font-bold leading-tight text-white md:text-6xl">
          Tu impresora ya puede producir. Ahora tu negocio tiene que estar a la altura.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-zinc-400">
          Reuní aprendizaje, costos, materiales y presupuestos en un sistema pensado para talleres de impresión 3D.
        </p>
        <Link
          href={landingPrimaryCta.href}
          className="group mt-9 inline-flex items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 px-9 py-4 text-lg font-bold text-white transition-all hover:from-orange-500 hover:to-orange-400 hover:shadow-[0_0_35px_rgba(234,88,12,0.5)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-300"
        >
          {landingPrimaryCta.label}
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </section>
  );
}
