import Link from "next/link";
import { ChevronRight, LogIn, Play } from "lucide-react";
import { LandingHeroMockup } from "@/components/landing/LandingHeroMockup";
import { landingPrimaryCta } from "./landing-content";

export function LandingMembershipHero() {
  return (
    <section
      id="inicio"
      className="relative flex min-h-[95vh] scroll-mt-24 items-center overflow-hidden bg-stampa-bg pb-16 pt-28 text-white"
    >
      <div className="absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-1/2 h-[1000px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-stampa-orange/15 opacity-70 blur-[150px] motion-safe:animate-pulse" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0.95)_100%)]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black to-transparent" />
      </div>

      <div className="container relative z-10 mx-auto grid items-center gap-12 px-5 lg:grid-cols-2 lg:px-6">
        <div className="max-w-2xl pt-6 text-center lg:pt-0 lg:text-left">
          <div className="landing-enter inline-flex items-center gap-2 rounded-full border border-stampa-orange/20 bg-stampa-orange/10 px-3 py-1 text-sm font-medium text-orange-400">
            <span className="h-2 w-2 rounded-full bg-stampa-orange shadow-[0_0_10px_rgba(255,120,10,0.8)]" />
            Formación y gestión para tu taller 3D
          </div>

          <h1 className="landing-enter mt-8 text-5xl font-bold leading-[1.08] tracking-tight md:text-6xl lg:text-7xl [animation-delay:80ms]">
            Convertí tu impresora 3D en un{" "}
            <span className="relative inline-block bg-gradient-to-r from-orange-400 via-orange-500 to-orange-600 bg-clip-text text-transparent">
              negocio real
              <span className="absolute inset-x-0 -bottom-2 h-px bg-gradient-to-r from-transparent via-orange-500 to-transparent opacity-70" />
            </span>
          </h1>

          <p className="landing-enter mx-auto mt-7 max-w-xl text-lg leading-relaxed text-zinc-300 lg:mx-0 lg:text-xl [animation-delay:160ms]">
            Aprendé impresión 3D paso a paso, calculá costos reales, organizá
            tu taller y enviá presupuestos profesionales desde una sola
            plataforma.
          </p>

          <div className="landing-enter mt-9 flex flex-col items-center gap-4 sm:flex-row sm:justify-center lg:justify-start [animation-delay:240ms]">
            <Link
              href={landingPrimaryCta.href}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 px-8 py-4 font-semibold text-white shadow-[0_0_20px_rgba(234,88,12,0.4)] transition-all hover:from-orange-500 hover:to-orange-400 hover:shadow-[0_0_30px_rgba(234,88,12,0.6)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-300 sm:w-auto"
            >
              {landingPrimaryCta.label}
              <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="#plataforma"
              className="group inline-flex w-full items-center justify-center gap-3 rounded-xl border border-stampa-border bg-white/5 px-8 py-4 font-medium text-white transition-all hover:border-stampa-orange/40 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400 sm:w-auto"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-orange-400">
                <Play className="h-4 w-4 translate-x-px" />
              </span>
              Ver cómo funciona
            </Link>
          </div>

          <Link
            href="/login"
            className="mt-5 inline-flex items-center gap-2 rounded text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400"
          >
            <LogIn className="h-4 w-4" />
            Ya soy miembro
          </Link>
        </div>

        <div className="landing-enter w-full [animation-delay:320ms]">
          <LandingHeroMockup />
        </div>
      </div>
    </section>
  );
}
