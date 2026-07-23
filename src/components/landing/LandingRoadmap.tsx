"use client";

import { useIntersection } from "./use-intersection";

const courses = [
  {
    title: "Impresión 3D desde cero",
    description: "Nivelación, primeros pasos y mantenimiento básico para que tu máquina empiece a producir sin fallas."
  },
  {
    title: "Bambu Studio + OrcaSlicer",
    description: "Dominá los slicers más modernos del mercado. Soportes, velocidad y perfiles optimizados."
  },
  {
    title: "Diseño con Fusion 360",
    description: "Dejá de depender de modelos gratis. Aprendé a diseñar tus propias piezas funcionales y cobralas mejor."
  },
  {
    title: "Producción, costos y venta",
    description: "Estrategias de precio, organización de taller y cómo escalar tus ventas para que deje de ser un hobby."
  }
];

export function LandingRoadmap() {
  const [ref, isIntersecting] = useIntersection<HTMLDivElement>({ threshold: 0.1 });

  return (
    <section id="cursos" className="py-24 bg-zinc-950 border-t border-white/5 relative overflow-hidden">
      <div className="container mx-auto px-6" ref={ref}>
        
        <div className={`text-center max-w-3xl mx-auto mb-20 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">El camino para dominar tu taller</h2>
          <p className="text-gray-400 text-lg md:text-xl">
            Un mapa de aprendizaje estructurado, paso a paso, sin relleno.
          </p>
        </div>

        <div className="max-w-4xl mx-auto relative">
          
          {/* Main vertical line (Desktop) */}
          <div className="absolute left-6 md:left-1/2 md:-translate-x-1/2 top-0 bottom-0 w-px bg-zinc-800" />
          
          {/* Glowing animated line (Desktop only) */}
          <div 
            className={`absolute left-6 md:left-1/2 md:-translate-x-1/2 top-0 w-[2px] bg-gradient-to-b from-orange-400 via-orange-500 to-transparent transition-all duration-[2000ms] ease-out shadow-[0_0_15px_rgba(234,88,12,0.8)] hidden md:block ${
              isIntersecting ? 'h-full opacity-100' : 'h-0 opacity-0'
            }`} 
          />

          <div className="space-y-12 md:space-y-0">
            {courses.map((course, idx) => {
              const isEven = idx % 2 === 0;
              
              return (
                <div 
                  key={idx} 
                  className={`relative flex flex-col md:flex-row items-start md:items-center justify-between group stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''} ${isEven ? 'md:flex-row-reverse' : ''}`}
                  style={{ animationDelay: `${idx * 0.3 + 0.2}s` }}
                >
                  
                  {/* Content Side */}
                  <div className={`w-full md:w-5/12 ml-16 md:ml-0 ${isEven ? 'md:pl-12' : 'md:pr-12'}`}>
                    <div className="bg-zinc-900/50 border border-white/5 p-6 md:p-8 rounded-2xl hover:bg-zinc-900 hover:border-orange-500/30 transition-colors duration-300 relative group-hover:-translate-y-1">
                      <div className="text-orange-500 font-mono text-sm mb-3 font-semibold tracking-wider">PASO 0{idx + 1}</div>
                      <h3 className="text-xl md:text-2xl font-bold text-white mb-3">{course.title}</h3>
                      <p className="text-gray-400 leading-relaxed">{course.description}</p>
                    </div>
                  </div>

                  {/* Center Node (Desktop & Mobile aligned) */}
                  <div className="absolute left-0 md:left-1/2 md:-translate-x-1/2 top-6 md:top-auto flex justify-center z-10 w-12 md:w-auto">
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-black border-[3px] border-zinc-800 flex items-center justify-center group-hover:border-orange-500 transition-colors duration-500 relative">
                      <div className={`absolute inset-0 rounded-full transition-all duration-1000 hidden md:block ${isIntersecting ? 'bg-orange-500/20 shadow-[0_0_20px_rgba(234,88,12,0.6)]' : 'opacity-0'}`} style={{ animationDelay: `${idx * 0.3 + 0.4}s` }} />
                      <div className={`text-white font-bold text-sm md:text-base z-10 transition-all duration-500 ${isIntersecting ? 'opacity-100' : 'opacity-0 md:opacity-100'}`} style={{ transitionDelay: `${idx * 0.3 + 0.4}s` }}>
                        {idx + 1}
                      </div>
                    </div>
                  </div>
                  
                  {/* Empty side for layout spacing on desktop */}
                  <div className="hidden md:block w-5/12" />
                  
                </div>
              );
            })}
          </div>
          
        </div>
      </div>
    </section>
  );
}
