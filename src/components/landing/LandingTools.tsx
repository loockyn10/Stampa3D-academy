"use client";

import { Settings, Calculator, FileCheck, Package, Cuboid, MessagesSquare } from "lucide-react";
import { useIntersection } from "./use-intersection";

const tools = [
  { icon: Calculator, name: "Calculadora de precios", desc: "Precisión en cada centavo" },
  { icon: FileCheck, name: "Presupuestador", desc: "PDFs automáticos" },
  { icon: Package, name: "Stock", desc: "Control de filamentos" },
  { icon: Settings, name: "Productos", desc: "Catálogo organizado" },
  { icon: Cuboid, name: "Librería STL", desc: "Modelos probados" },
  { icon: MessagesSquare, name: "Comunidad", desc: "Soporte constante" },
];

export function LandingTools() {
  const [ref, isIntersecting] = useIntersection<HTMLDivElement>({ threshold: 0.1 });

  return (
    <section className="py-24 bg-zinc-950 text-white border-t border-white/5 relative overflow-hidden">
      {/* Background flare */}
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-orange-600/5 blur-[100px] rounded-full pointer-events-none" />

      <div className="container mx-auto px-6 relative z-10" ref={ref}>
        <div className="flex flex-col lg:flex-row items-center gap-12">
          
          <div className={`lg:w-1/2 max-w-2xl stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}>
            <h2 className="text-3xl md:text-5xl font-bold mb-6 leading-tight">
              Herramientas que te <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600">ahorran tiempo</span>
            </h2>
            <p className="text-gray-400 text-lg mb-8">
              Academia Stampa no es solo educación. Es un sistema de gestión simple pensado específicamente para talleres de impresión 3D. Menos tiempo calculando, más tiempo imprimiendo.
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              {tools.slice(0,4).map((tool, idx) => (
                <div key={idx} className="flex items-center gap-3 group">
                  <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-400 shrink-0 group-hover:bg-orange-500/20 group-hover:scale-110 transition-all duration-300">
                    <tool.icon className="w-4 h-4" />
                  </div>
                  <span className="text-gray-300 font-medium group-hover:text-white transition-colors">{tool.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:w-1/2 w-full">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {tools.map((tool, idx) => (
                <div 
                  key={idx} 
                  className={`bg-zinc-900 border border-white/5 p-6 rounded-xl flex flex-col items-center text-center hover:bg-zinc-800 hover:border-orange-500/30 hover:shadow-[0_0_20px_rgba(234,88,12,0.1)] hover:-translate-y-1 transition-all duration-300 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}
                  style={{ animationDelay: `${idx * 0.1 + 0.2}s` }}
                >
                  <tool.icon className="w-8 h-8 text-gray-400 mb-4 group-hover:text-orange-400 transition-colors" />
                  <h4 className="font-medium text-sm text-gray-200">{tool.name}</h4>
                  <p className="text-xs text-gray-500 mt-1">{tool.desc}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
