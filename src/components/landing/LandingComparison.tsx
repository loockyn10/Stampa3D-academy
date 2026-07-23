"use client";

import { X, Check } from "lucide-react";
import { useIntersection } from "./use-intersection";

export function LandingComparison() {
  const [ref, isIntersecting] = useIntersection<HTMLDivElement>({ threshold: 0.1 });

  return (
    <section className="py-24 bg-black text-white relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[500px] bg-orange-600/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="container mx-auto px-6 relative z-10" ref={ref}>
        <div className={`text-center max-w-3xl mx-auto mb-16 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}>
          <h2 className="text-3xl md:text-5xl font-bold mb-6">
            La mayoría aprende a imprimir.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600">
              Muy pocos aprenden a cobrar.
            </span>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Sin Stampa */}
          <div 
            className={`bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 lg:p-10 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}
            style={{ animationDelay: '0.2s' }}
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                <X className="w-5 h-5" />
              </div>
              <h3 className="text-2xl font-semibold text-gray-300">Sin Stampa</h3>
            </div>
            
            <ul className="space-y-6">
              {[
                "Precios calculados a ojo",
                "Presupuestos desordenados (WhatsApp o papel)",
                "Stock sin control, te quedás sin material",
                "Cursos sueltos por todo YouTube",
                "Aprendizaje frustrante por prueba y error"
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-4 text-gray-400">
                  <X className="w-5 h-5 text-red-500/50 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Con Stampa */}
          <div 
            className={`bg-gradient-to-b from-orange-950/40 to-zinc-900/80 border border-orange-500/20 rounded-2xl p-8 lg:p-10 relative overflow-hidden shadow-[0_0_40px_rgba(234,88,12,0.1)] hover:shadow-[0_0_50px_rgba(234,88,12,0.2)] transition-shadow duration-500 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}
            style={{ animationDelay: '0.4s' }}
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
            
            <div className="flex items-center gap-3 mb-8 relative z-10">
              <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/30">
                <Check className="w-5 h-5" />
              </div>
              <h3 className="text-2xl font-semibold text-white">Con Academia Stampa</h3>
            </div>
            
            <ul className="space-y-6 relative z-10">
              {[
                "Precios calculados con costos reales",
                "Presupuestos en PDF listos para enviar",
                "Stock organizado por bobina y peso",
                "Cursos ordenados por ruta de aprendizaje",
                "Herramientas para vender mejor y escalar"
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-4 text-gray-200 font-medium">
                  <Check className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
