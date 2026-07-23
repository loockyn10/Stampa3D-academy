"use client";

import { Check, X } from "lucide-react";
import { useIntersection } from "./use-intersection";

const withoutStampa = [
  "Precios a ojo o copiando a la competencia",
  "Presupuestos informales por WhatsApp",
  "Stock desordenado (te quedás sin material)",
  "Cursos sueltos de YouTube sin rumbo",
  "Aprendizaje por prueba, error y plástico tirado"
];

const withStampa = [
  "Costos calculados (luz, amortización y tiempo)",
  "Presupuestos PDF listos para enviar al cliente",
  "Stock organizado al gramo en tiempo real",
  "Ruta de aprendizaje clara desde cero",
  "Herramientas concretas para vender mejor"
];

export function LandingComparison() {
  const [ref, isIntersecting] = useIntersection<HTMLDivElement>({ threshold: 0.1 });

  return (
    <section className="py-24 bg-black relative">
      {/* Background glow in center desktop */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-600/10 blur-[150px] rounded-full pointer-events-none hidden md:block" />

      <div className="container mx-auto px-6 relative z-10" ref={ref}>
        <div className={`text-center max-w-3xl mx-auto mb-16 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
            La diferencia entre <span className="text-gray-500">un hobby</span> y <span className="text-orange-500">un negocio</span>
          </h2>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 max-w-5xl mx-auto">
          
          {/* Sin Stampa */}
          <div className={`w-full lg:w-1/2 bg-zinc-950/80 border border-zinc-800 rounded-3xl p-8 md:p-12 relative overflow-hidden stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`} style={{ animationDelay: '0.1s' }}>
            <h3 className="text-2xl font-bold text-gray-400 mb-8 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </div>
              Sin Stampa
            </h3>
            
            <ul className="space-y-6">
              {withoutStampa.map((item, idx) => (
                <li key={idx} className="flex items-start gap-4">
                  <div className="w-6 h-6 rounded-full bg-zinc-900/80 flex items-center justify-center shrink-0 mt-0.5">
                    <X className="w-3 h-3 text-red-500/50" />
                  </div>
                  <span className="text-gray-400 font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Con Stampa */}
          <div className={`w-full lg:w-1/2 bg-zinc-900/60 border border-orange-500/40 rounded-3xl p-8 md:p-12 relative overflow-hidden group stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`} style={{ animationDelay: '0.3s' }}>
            <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 blur-3xl rounded-full transition-opacity duration-700 opacity-50 group-hover:opacity-100 hidden md:block" />
            
            <h3 className="text-2xl font-bold text-white mb-8 flex items-center gap-3 relative z-10">
              <div className="w-8 h-8 rounded-full bg-orange-500/20 border border-orange-500/50 flex items-center justify-center">
                <Check className="w-4 h-4 text-orange-400" />
              </div>
              Con Stampa Academy
            </h3>
            
            <ul className="space-y-6 relative z-10">
              {withStampa.map((item, idx) => (
                <li key={idx} className="flex items-start gap-4">
                  <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5 border border-green-500/20">
                    <Check className="w-3 h-3 text-green-400" />
                  </div>
                  <span className="text-gray-200 font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </div>

        </div>
      </div>
    </section>
  );
}
