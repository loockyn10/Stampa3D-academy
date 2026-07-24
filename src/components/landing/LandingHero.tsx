"use client";

import Link from "next/link";
import { ChevronRight, Play } from "lucide-react";
import { LandingHeroMockup } from "./LandingHeroMockup";

export function LandingHero() {
  return (
    <section className="relative min-h-[95vh] flex items-center justify-center overflow-hidden bg-black text-white pt-24 pb-16">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-orange-600/15 rounded-full blur-[150px] opacity-70 animate-pulse" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.1)_0%,rgba(0,0,0,0.95)_100%)]" />
        
        {/* Technical Grid */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        
        {/* Diagonal trajectory lines */}
        <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #ffffff 0, #ffffff 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />

        {/* Animated background layers (scanning horizontal lines) */}
        <div className="absolute inset-0 opacity-[0.05] bg-[linear-gradient(to_bottom,transparent_49%,rgba(255,255,255,0.1)_50%,transparent_51%)] stampa-layer-bg" />
        
        {/* Gradient fade to bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-black to-transparent" />
      </div>

      <div className="container mx-auto px-6 relative z-10 grid lg:grid-cols-2 gap-12 items-center">
        {/* Text Content */}
        <div className="max-w-2xl text-center lg:text-left pt-10 lg:pt-0">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm font-medium mb-8 animate-fade-in-up">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
            </span>
            Stampa3D Academy
          </div>
          
          <h1 className="text-5xl lg:text-7xl font-bold tracking-tight mb-6 leading-tight animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
            Convertí tu impresora 3D en un{" "}
            <span className="relative inline-block text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-orange-500 to-orange-600">
              negocio real
              {/* Subtle underline glow */}
              <span className="absolute -bottom-2 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-orange-500 to-transparent opacity-50 blur-[2px]" />
            </span>
          </h1>
          
          <p className="text-lg lg:text-xl text-gray-400 mb-10 leading-relaxed animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
            Aprendé impresión 3D desde cero, calculá precios, organizá tu stock, generá presupuestos y accedé a herramientas pensadas para vender mejor.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
            <Link 
              href="/login"
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 text-white font-semibold transition-all duration-300 flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(234,88,12,0.4)] hover:shadow-[0_0_30px_rgba(234,88,12,0.6)] hover:scale-105 group relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-white/20 w-12 skew-x-[-20deg]" style={{ animation: 'stampa-shine 3s ease-in-out infinite', animationDelay: '1s' }} />
              <span className="relative z-10 flex items-center gap-2">
                Entrar a la academia
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>
            
            <Link 
              href="#contenido"
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium transition-all duration-300 flex items-center justify-center gap-2 hover:border-orange-500/30 group"
            >
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-orange-500/20 group-hover:text-orange-400 transition-colors">
                <Play className="w-4 h-4 ml-0.5" />
              </div>
              Ver qué incluye
            </Link>
          </div>
        </div>

        {/* Platform Mockup */}
        <div className="w-full animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
          <LandingHeroMockup />
        </div>
      </div>
    </section>
  );
}
