"use client";

import { MonitorPlay, Calculator, FileText, Layers, Cuboid, Users } from "lucide-react";
import { useIntersection } from "./use-intersection";

const features = [
  {
    icon: MonitorPlay,
    title: "Cursos paso a paso",
    description: "Rutas de aprendizaje estructuradas desde lo más básico hasta técnicas de producción avanzada."
  },
  {
    icon: Calculator,
    title: "Calculadora de precios",
    description: "Dejá de cobrar a ojo. Calculá costos reales de material, electricidad, amortización y tu tiempo."
  },
  {
    icon: FileText,
    title: "Presupuestos profesionales",
    description: "Generá PDFs listos para enviar a tus clientes, dándole una imagen seria y profesional a tu taller."
  },
  {
    icon: Layers,
    title: "Stock de filamentos",
    description: "Llevá el control de tus bobinas. Sabé exactamente cuánto material te queda para no quedarte a medias."
  },
  {
    icon: Cuboid,
    title: "Librería STL",
    description: "Archivos probados, optimizados y listos para imprimir y vender con éxito."
  },
  {
    icon: Users,
    title: "Comunidad y sorteos",
    description: "Conectá con otros makers, compartí experiencias y participá por bobinas y herramientas."
  }
];

export function LandingFeatureGrid() {
  const [ref, isIntersecting] = useIntersection<HTMLDivElement>({ threshold: 0.1 });

  return (
    <section id="contenido" className="py-24 bg-zinc-950 text-white relative">
      <div className="container mx-auto px-6" ref={ref}>
        <div className={`text-center max-w-3xl mx-auto mb-16 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}>
          <h2 className="text-3xl md:text-5xl font-bold mb-6">No es un curso. Es un sistema para construir tu taller.</h2>
          <p className="text-gray-400 text-lg md:text-xl">
            Es una plataforma completa para aprender, calcular, producir y vender impresión 3D con más orden.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, idx) => (
            <div 
              key={idx}
              className={`group bg-zinc-900/50 border border-white/5 rounded-2xl p-8 hover:bg-zinc-900 hover:border-orange-500/50 hover:shadow-[0_0_30px_rgba(234,88,12,0.2)] hover:-translate-y-2 transition-all duration-500 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}
              style={{ animationDelay: `${idx * 0.1 + 0.2}s` }}
            >
              <div className="w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-500 mb-6 group-hover:scale-110 group-hover:bg-orange-500/30 transition-all duration-300">
                <feature.icon className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold mb-3 group-hover:text-orange-100 transition-colors">{feature.title}</h3>
              <p className="text-gray-400 leading-relaxed group-hover:text-gray-300 transition-colors">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
