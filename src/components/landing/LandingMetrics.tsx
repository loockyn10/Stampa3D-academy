"use client";

import { useIntersection } from "./use-intersection";

const metrics = [
  { value: "Cursos", label: "paso a paso", desc: "Desde cero hasta avanzado" },
  { value: "Cálculo", label: "de costos reales", desc: "Luz, amortización y tiempo" },
  { value: "Minutos", label: "para presupuestar", desc: "PDFs listos para enviar" },
  { value: "Stock", label: "organizado al gramo", desc: "Control total de material" }
];

export function LandingMetrics() {
  const [ref, isIntersecting] = useIntersection<HTMLDivElement>({ threshold: 0.2 });

  return (
    <section className="bg-black py-12 md:py-20 border-b border-white/5 relative overflow-hidden" ref={ref}>
      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-full bg-orange-600/5 blur-[100px] rounded-full pointer-events-none hidden md:block" />
      
      <div className="container mx-auto px-6 relative z-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {metrics.map((metric, idx) => (
            <div 
              key={idx} 
              className={`bg-zinc-900/50 border border-white/5 rounded-2xl p-8 flex flex-col items-center text-center transition-all duration-500 hover:bg-zinc-800/80 hover:border-orange-500/30 md:hover:-translate-y-2 hover:shadow-[0_10px_30px_rgba(234,88,12,0.15)] stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}
              style={{ animationDelay: `${idx * 0.15}s` }}
            >
              <h3 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600 mb-2">
                {metric.value}
              </h3>
              <p className="text-white font-medium text-lg mb-1">{metric.label}</p>
              <p className="text-gray-500 text-sm">{metric.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
