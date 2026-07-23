"use client";

import Link from "next/link";
import { ChevronRight, LayoutDashboard } from "lucide-react";
import { useIntersection } from "./use-intersection";

export function LandingCTA() {
  const [ref, isIntersecting] = useIntersection<HTMLDivElement>({ threshold: 0.1 });

  return (
    <section id="precio" className="py-24 bg-black relative overflow-hidden border-t border-white/5">
      {/* Background elements - Desktop Only Glow */}
      <div className="absolute inset-0 z-0 hidden md:block">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-3xl h-[400px] bg-orange-600/20 blur-[120px] rounded-full pointer-events-none stampa-pulse" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(0,0,0,0)_0%,rgba(0,0,0,0.9)_100%)] pointer-events-none" />
        {/* Subtle grid to match hero */}
        <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      </div>

      <div className="container mx-auto px-6 relative z-10" ref={ref}>
        <div className={`max-w-4xl mx-auto bg-zinc-950 md:bg-zinc-900/60 border border-orange-500/20 md:border-orange-500/30 rounded-3xl p-8 md:p-16 text-center md:backdrop-blur-xl shadow-lg md:shadow-[0_0_50px_rgba(234,88,12,0.15)] relative overflow-hidden stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}>
          
          {/* Animated border line - Desktop Only */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-orange-500 to-transparent opacity-50 hidden md:block" style={{ animation: 'stampa-shine 4s infinite' }} />

          {/* Pricing indicator */}
          <div className="inline-flex flex-col items-center justify-center mb-8">
             <div className="text-sm font-medium text-orange-400 tracking-wider uppercase mb-1">Membresía mensual</div>
             <div className="text-gray-400 text-xs md:text-sm">Acceso a cursos, herramientas, recursos, comunidad y actualizaciones.</div>
          </div>
          
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 leading-tight">
            Tu impresora ya puede producir.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600">
              Ahora tu negocio tiene que estar a la altura.
            </span>
          </h2>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-10">
            <Link 
              href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-10 py-4 md:py-5 rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 text-white font-bold text-lg transition-all duration-300 md:hover:scale-105 md:hover:shadow-[0_0_30px_rgba(234,88,12,0.5)] group relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-white/20 w-12 skew-x-[-20deg] hidden md:block" style={{ animation: 'stampa-shine 3s ease-in-out infinite', animationDelay: '1s' }} />
              <span className="relative z-10 flex items-center gap-2">
                Activar membresía
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>

            <Link 
              href="#plataforma"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-10 py-4 md:py-5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium text-lg transition-all duration-300 md:hover:border-orange-500/30 group"
            >
              <LayoutDashboard className="w-5 h-5 group-hover:text-orange-400 transition-colors" />
              Ver plataforma
            </Link>
          </div>
          
        </div>
      </div>
    </section>
  );
}
