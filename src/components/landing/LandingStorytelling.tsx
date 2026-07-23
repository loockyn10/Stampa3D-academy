"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Calculator, Database, FileText, CheckCircle2, ChevronRight, Activity, Gift } from "lucide-react";
import { useIntersection } from "./use-intersection";

const steps = [
  {
    id: 1,
    title: "Aprendés impresión 3D desde cero",
    desc: "Cursos guiados, desde cómo nivelar tu primera máquina hasta técnicas avanzadas de Bambu Studio.",
    icon: BookOpen
  },
  {
    id: 2,
    title: "Calculás precios con costos reales",
    desc: "Nuestra calculadora automática considera luz, amortización, material y tu tiempo de trabajo.",
    icon: Calculator
  },
  {
    id: 3,
    title: "Organizás tu stock de filamentos",
    desc: "Sabé exactamente cuántos gramos te quedan de cada bobina para no quedarte sin material en medio de una venta.",
    icon: Database
  },
  {
    id: 4,
    title: "Generás presupuestos profesionales",
    desc: "Creá PDFs con tu logo, detalles técnicos y precios listos para enviar por WhatsApp.",
    icon: FileText
  },
  {
    id: 5,
    title: "Vendés con más orden y profesionalismo",
    desc: "Tu hobby se transforma en un taller estructurado. Todo centralizado en tu dashboard.",
    icon: CheckCircle2
  }
];

export function LandingStorytelling() {
  const [activeStep, setActiveStep] = useState(1);

  // We use simple intersection observers for each step to detect which one is active
  const StepBlock = ({ step, index }: { step: typeof steps[0], index: number }) => {
    const [ref, isIntersecting] = useIntersection<HTMLDivElement>({ threshold: 0.5, triggerOnce: false });
    
    useEffect(() => {
      if (isIntersecting) {
        setActiveStep(step.id);
      }
    }, [isIntersecting, step.id]);

    return (
      <div ref={ref} className="min-h-[60vh] flex flex-col justify-center relative z-10 py-20">
        <div className={`transition-all duration-500 ${activeStep === step.id ? 'opacity-100 scale-100' : 'opacity-40 scale-95'}`}>
          <div className="w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-500 mb-6">
            <step.icon className="w-6 h-6" />
          </div>
          <h3 className="text-3xl font-bold text-white mb-4">{step.title}</h3>
          <p className="text-gray-400 text-lg leading-relaxed">{step.desc}</p>
        </div>
      </div>
    );
  };

  return (
    <section className="bg-black relative border-t border-white/5">
      <div className="container mx-auto px-6">
        
        <div className="text-center max-w-3xl mx-auto pt-24 pb-12">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
            De hobby a <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600">taller rentable</span>
          </h2>
        </div>

        <div className="flex flex-col lg:flex-row relative items-start">
          
          {/* Left Column: Scrolling Steps */}
          <div className="w-full lg:w-1/2 relative lg:pr-12">
            {/* Vertical Line */}
            <div className="absolute left-6 top-24 bottom-24 w-px bg-zinc-800 hidden lg:block" />
            <div 
              className="absolute left-6 top-24 w-[2px] bg-gradient-to-b from-orange-400 to-orange-600 transition-all duration-700 shadow-[0_0_15px_rgba(234,88,12,0.8)] hidden lg:block" 
              style={{ height: `${(activeStep / steps.length) * 100}%` }}
            />

            {steps.map((step, i) => (
              <StepBlock key={step.id} step={step} index={i} />
            ))}
          </div>

          {/* Right Column: Sticky Mockup */}
          <div className="w-full lg:w-1/2 sticky top-24 h-[60vh] lg:h-[80vh] flex items-center justify-center py-12 lg:py-0">
            <div className="relative w-full max-w-md aspect-[4/3] bg-[#09090b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden group">
              <div className="absolute -inset-1 bg-gradient-to-r from-orange-600 to-orange-400 rounded-2xl blur opacity-20 transition duration-1000 group-hover:opacity-30" />
              
              <div className="absolute inset-0 bg-[#09090b] rounded-2xl overflow-hidden flex flex-col z-10 border border-white/5">
                {/* Header */}
                <div className="h-10 border-b border-white/5 bg-white/5 flex items-center px-4 justify-between shrink-0">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/80" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                    <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  </div>
                  <div className="text-[10px] text-gray-500 font-mono">academia-stampa.com</div>
                  <div className="w-12" />
                </div>

                {/* Body Content - Changes based on activeStep */}
                <div className="flex-1 p-6 relative overflow-hidden">
                  
                  {/* Step 1: Cursos */}
                  <div className={`absolute inset-0 p-6 transition-all duration-500 ${activeStep === 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
                    <div className="flex items-center gap-3 mb-6">
                      <BookOpen className="w-5 h-5 text-blue-400" />
                      <span className="font-semibold text-white">Academia</span>
                    </div>
                    <div className="bg-white/5 border border-white/5 rounded-xl p-4 mb-4">
                      <div className="text-sm text-gray-400 mb-2">Impresión 3D desde cero</div>
                      <div className="text-xl font-bold text-white mb-3">Módulo 2: Calibración</div>
                      <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 w-[68%]" />
                      </div>
                      <div className="text-xs text-right text-blue-400 mt-2">68% Completado</div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      <span className="text-sm text-gray-300">Clase 4 finalizada</span>
                    </div>
                  </div>

                  {/* Step 2: Calculadora */}
                  <div className={`absolute inset-0 p-6 transition-all duration-500 ${activeStep === 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
                    <div className="flex items-center gap-3 mb-6">
                      <Calculator className="w-5 h-5 text-green-400" />
                      <span className="font-semibold text-white">Calculadora</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="bg-white/5 rounded-lg p-3">
                        <div className="text-xs text-gray-500">Material</div>
                        <div className="text-sm text-white">135 g</div>
                      </div>
                      <div className="bg-white/5 rounded-lg p-3">
                        <div className="text-xs text-gray-500">Tiempo</div>
                        <div className="text-sm text-white">4h 20m</div>
                      </div>
                    </div>
                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center mt-6">
                      <div className="text-sm text-green-400 mb-1">Precio Sugerido</div>
                      <div className="text-3xl font-bold text-white">$18.700</div>
                    </div>
                  </div>

                  {/* Step 3: Stock */}
                  <div className={`absolute inset-0 p-6 transition-all duration-500 ${activeStep === 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
                    <div className="flex items-center gap-3 mb-6">
                      <Database className="w-5 h-5 text-orange-400" />
                      <span className="font-semibold text-white">Inventario</span>
                    </div>
                    <div className="space-y-3">
                      <div className="bg-white/5 border border-white/5 rounded-lg p-3 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full bg-zinc-900 border border-zinc-700" />
                          <span className="text-sm text-white">PLA Negro GST3D</span>
                        </div>
                        <span className="text-sm font-bold text-orange-400">742 g</span>
                      </div>
                      <div className="bg-white/5 border border-white/5 rounded-lg p-3 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full bg-white border border-gray-300" />
                          <span className="text-sm text-white">PLA Blanco Grilon</span>
                        </div>
                        <span className="text-sm font-bold text-orange-400">410 g</span>
                      </div>
                      <div className="bg-white/5 border border-white/5 rounded-lg p-3 flex justify-between items-center opacity-50">
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full bg-red-600 border border-red-500" />
                          <span className="text-sm text-white">PETG Rojo</span>
                        </div>
                        <span className="text-sm font-bold text-red-400">0 g</span>
                      </div>
                    </div>
                  </div>

                  {/* Step 4: Presupuestos */}
                  <div className={`absolute inset-0 p-6 transition-all duration-500 ${activeStep === 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
                    <div className="flex items-center gap-3 mb-6">
                      <FileText className="w-5 h-5 text-purple-400" />
                      <span className="font-semibold text-white">Presupuestos</span>
                    </div>
                    <div className="bg-white/5 border border-white/5 rounded-xl p-5 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-20 h-20 bg-purple-500/10 blur-xl rounded-full" />
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="text-xs text-gray-400">PRE-0042</div>
                          <div className="text-lg font-bold text-white">Taller Racing SRL</div>
                        </div>
                        <div className="px-2 py-1 rounded bg-purple-500/20 text-purple-300 text-xs font-medium">
                          Enviado
                        </div>
                      </div>
                      <div className="border-t border-white/10 pt-4 flex justify-between items-center">
                        <span className="text-sm text-gray-400">Total:</span>
                        <span className="text-xl font-bold text-white">$115.000</span>
                      </div>
                    </div>
                  </div>

                  {/* Step 5: Dashboard */}
                  <div className={`absolute inset-0 p-6 transition-all duration-500 ${activeStep === 5 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
                    <div className="flex items-center gap-3 mb-6">
                      <Activity className="w-5 h-5 text-orange-500" />
                      <span className="font-semibold text-white">Dashboard</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="bg-white/5 rounded-xl p-4 text-center">
                        <div className="text-2xl font-bold text-white">12</div>
                        <div className="text-xs text-gray-400">Productos</div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-4 text-center">
                        <div className="text-2xl font-bold text-white">3</div>
                        <div className="text-xs text-gray-400">Ventas hoy</div>
                      </div>
                    </div>
                    <div className="bg-orange-950/30 border border-orange-500/20 rounded-xl p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Gift className="w-5 h-5 text-orange-400 animate-pulse" />
                        <div>
                          <div className="text-sm font-bold text-white">Sorteo Activo</div>
                          <div className="text-xs text-gray-400">Bobina PLA</div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-orange-500" />
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
