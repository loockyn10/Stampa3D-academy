"use client";

import { Map } from "lucide-react";
import { useIntersection } from "./use-intersection";

const routes = [
  {
    number: "01",
    title: "Impresión 3D desde cero",
    description: "Dominá los fundamentos de las máquinas, materiales básicos y calibración."
  },
  {
    number: "02",
    title: "Bambu Studio + OrcaSlicer",
    description: "Aprendé a usar los slicers modernos para sacar el máximo rendimiento a tus impresiones."
  },
  {
    number: "03",
    title: "Fusion 360",
    description: "Pasá de descargar archivos a diseñar tus propias soluciones mecánicas y piezas a medida."
  },
  {
    number: "04",
    title: "Producción, costos y venta",
    description: "El paso final: cómo cotizar, organizar tu taller y escalar tu producción."
  }
];

export function LandingRoadmap() {
  const [ref, isIntersecting] = useIntersection<HTMLDivElement>({ threshold: 0.1 });

  return (
    <section className="py-24 bg-black text-white relative">
      <div className="container mx-auto px-6" ref={ref}>
        <div className={`text-center max-w-3xl mx-auto mb-16 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}>
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-orange-500/10 text-orange-500 mb-6 relative">
            <div className="absolute inset-0 bg-orange-500/20 rounded-full animate-ping opacity-50" />
            <Map className="w-6 h-6 relative z-10" />
          </div>
          <h2 className="text-3xl md:text-5xl font-bold mb-6">Una ruta clara para avanzar</h2>
          <p className="text-gray-400 text-lg">
            No pierdas tiempo buscando qué aprender después. Te marcamos el camino.
          </p>
        </div>

        <div className="max-w-4xl mx-auto relative">
          {/* Vertical connecting line for desktop */}
          <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-zinc-800 -translate-x-1/2" />
          
          {/* Animated glow line on scroll */}
          <div 
            className="hidden md:block absolute left-1/2 top-0 w-[2px] bg-gradient-to-b from-orange-400 to-orange-600 -translate-x-1/2 transition-all duration-[2000ms] ease-in-out shadow-[0_0_15px_rgba(234,88,12,0.8)]" 
            style={{ 
              height: isIntersecting ? '100%' : '0%',
              opacity: isIntersecting ? 1 : 0
            }} 
          />

          <div className="space-y-12 md:space-y-0 relative">
            {routes.map((route, idx) => (
              <div 
                key={idx} 
                className={`flex flex-col md:flex-row items-center justify-between group stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''} ${idx % 2 === 0 ? 'md:flex-row-reverse' : ''}`}
                style={{ animationDelay: `${idx * 0.3 + 0.3}s` }}
              >
                
                {/* Content Side */}
                <div className="w-full md:w-5/12 mb-6 md:mb-0">
                  <div className={`bg-zinc-900/50 border border-white/5 p-6 rounded-2xl hover:border-orange-500/50 transition-all duration-300 hover:shadow-[0_0_30px_rgba(234,88,12,0.15)] hover:-translate-y-1 ${idx % 2 === 0 ? 'md:text-left' : 'md:text-right'}`}>
                    <div className="text-orange-500 font-mono text-sm mb-2 font-semibold">Ruta {route.number}</div>
                    <h3 className="text-xl font-bold mb-3">{route.title}</h3>
                    <p className="text-gray-400">{route.description}</p>
                  </div>
                </div>

                {/* Center Node */}
                <div className="hidden md:flex w-2/12 justify-center relative z-10 py-8">
                  <div className="w-10 h-10 rounded-full bg-black border-4 border-zinc-800 flex items-center justify-center group-hover:border-orange-500 transition-colors duration-500 relative">
                    <div className={`absolute inset-0 rounded-full transition-all duration-1000 ${isIntersecting ? 'bg-orange-500/20 shadow-[0_0_20px_rgba(234,88,12,0.6)]' : 'opacity-0'}`} style={{ animationDelay: `${idx * 0.3 + 0.5}s` }} />
                    <div className={`w-3 h-3 rounded-full bg-orange-500 transition-all duration-500 ${isIntersecting ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}`} style={{ transitionDelay: `${idx * 0.3 + 0.5}s` }} />
                  </div>
                </div>

                {/* Empty Side for layout */}
                <div className="hidden md:block w-5/12" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
