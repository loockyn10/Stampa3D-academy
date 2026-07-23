"use client";

import { useState } from "react";
import { BookOpen, Calculator, Database, FileText, CheckCircle2 } from "lucide-react";
import { useIntersection } from "./use-intersection";

const steps = [
  {
    id: 1,
    title: "Academia",
    desc: "Aprende todo sobre impresión 3D",
    icon: BookOpen
  },
  {
    id: 2,
    title: "Calculadora",
    desc: "Costos y precios reales",
    icon: Calculator
  },
  {
    id: 3,
    title: "Inventario",
    desc: "Stock organizado al gramo",
    icon: Database
  },
  {
    id: 4,
    title: "Presupuestos",
    desc: "PDFs listos para el cliente",
    icon: FileText
  }
];

export function LandingInteractiveMockup() {
  const [activeStep, setActiveStep] = useState(1);
  const [ref, isIntersecting] = useIntersection<HTMLDivElement>({ threshold: 0.1 });

  return (
    <section id="plataforma" className="py-24 bg-black relative border-b border-white/5 overflow-hidden">
      <div className="container mx-auto px-6" ref={ref}>
        
        <div className={`text-center max-w-3xl mx-auto mb-16 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
            Todo lo que tu taller necesita
          </h2>
          <p className="text-gray-400 text-lg md:text-xl">
            Un ecosistema diseñado específicamente para hacer rentable la impresión 3D.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row items-center gap-12">
          
          {/* Left: Tabs / Cards */}
          <div className="w-full lg:w-5/12 flex flex-col gap-4 relative z-10">
            {steps.map((step, idx) => (
              <div 
                key={step.id}
                onMouseEnter={() => {
                  // Only trigger hover on desktop
                  if (window.innerWidth >= 1024) setActiveStep(step.id);
                }}
                onClick={() => setActiveStep(step.id)}
                className={`p-6 rounded-2xl border transition-all duration-300 cursor-pointer flex items-start gap-4 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''} ${
                  activeStep === step.id 
                    ? 'bg-zinc-900 border-orange-500/50 shadow-[0_0_30px_rgba(234,88,12,0.15)]' 
                    : 'bg-zinc-900/40 border-white/5 hover:bg-zinc-900/80 hover:border-white/10'
                }`}
                style={{ animationDelay: `${idx * 0.1}s` }}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-300 ${
                  activeStep === step.id ? 'bg-orange-500/20 text-orange-400' : 'bg-white/5 text-gray-500'
                }`}>
                  <step.icon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className={`font-bold text-lg mb-1 transition-colors duration-300 ${
                    activeStep === step.id ? 'text-white' : 'text-gray-400'
                  }`}>{step.title}</h3>
                  <p className="text-gray-500 text-sm">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Right: Mockup */}
          <div className={`w-full lg:w-7/12 relative stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`} style={{ animationDelay: '0.4s' }}>
            <div className="relative w-full aspect-square md:aspect-[4/3] bg-[#09090b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden group">
              {/* Glow background behind mockup (desktop only) */}
              <div className="absolute -inset-4 bg-gradient-to-r from-orange-600 to-orange-400 rounded-2xl blur-2xl opacity-0 group-hover:opacity-20 transition duration-1000 hidden md:block -z-10" />
              
              <div className="absolute inset-0 bg-[#09090b] rounded-2xl overflow-hidden flex flex-col z-10 border border-white/5">
                {/* Header */}
                <div className="h-10 border-b border-white/5 bg-white/5 flex items-center px-4 justify-between shrink-0">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/80" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                    <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  </div>
                  <div className="text-[10px] text-gray-500 font-mono hidden sm:block">academia-stampa.com</div>
                  <div className="w-12" />
                </div>

                {/* Body Content - Changes based on activeStep */}
                <div className="flex-1 p-6 relative overflow-hidden bg-black/50">
                  
                  {/* Step 1: Cursos */}
                  <div className={`absolute inset-0 p-6 md:p-10 transition-all duration-500 ${activeStep === 1 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 pointer-events-none'}`}>
                    <div className="flex items-center gap-3 mb-8">
                      <BookOpen className="w-6 h-6 text-blue-400" />
                      <span className="font-semibold text-white text-xl">Impresión 3D desde cero</span>
                    </div>
                    <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 mb-6 shadow-xl relative overflow-hidden group-hover:border-blue-500/30 transition-colors">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-2xl rounded-full" />
                      <div className="text-sm text-gray-400 mb-2">Módulo 2: Calibración y Slicing</div>
                      <div className="text-2xl font-bold text-white mb-6">Configuración de retracciones</div>
                      <div className="h-3 w-full bg-black rounded-full overflow-hidden border border-white/5">
                        <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 w-[68%]" />
                      </div>
                      <div className="text-sm font-medium text-blue-400 mt-3 text-right">68% Completado</div>
                    </div>
                    <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-xl border border-green-500/20">
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                      <span className="text-sm font-medium text-green-300">Clase 4 finalizada con éxito</span>
                    </div>
                  </div>

                  {/* Step 2: Calculadora */}
                  <div className={`absolute inset-0 p-6 md:p-10 transition-all duration-500 ${activeStep === 2 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 pointer-events-none'}`}>
                    <div className="flex items-center gap-3 mb-8">
                      <Calculator className="w-6 h-6 text-green-400" />
                      <span className="font-semibold text-white text-xl">Cálculo de costos</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="bg-zinc-900 border border-white/5 rounded-xl p-5">
                        <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Material</div>
                        <div className="text-xl font-bold text-white">135 g</div>
                        <div className="text-xs text-gray-400 mt-1">PLA Negro ($1.200)</div>
                      </div>
                      <div className="bg-zinc-900 border border-white/5 rounded-xl p-5">
                        <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Tiempo</div>
                        <div className="text-xl font-bold text-white">4h 20m</div>
                        <div className="text-xs text-gray-400 mt-1">Luz + Amortización ($850)</div>
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-green-900/40 to-green-950/40 border border-green-500/30 rounded-xl p-6 text-center shadow-[0_0_30px_rgba(34,197,94,0.1)]">
                      <div className="text-sm font-medium text-green-400 mb-2 uppercase tracking-wider">Precio de Venta Sugerido</div>
                      <div className="text-5xl font-black text-white">$18.700</div>
                    </div>
                  </div>

                  {/* Step 3: Stock */}
                  <div className={`absolute inset-0 p-6 md:p-10 transition-all duration-500 ${activeStep === 3 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 pointer-events-none'}`}>
                    <div className="flex items-center gap-3 mb-8">
                      <Database className="w-6 h-6 text-orange-400" />
                      <span className="font-semibold text-white text-xl">Inventario en tiempo real</span>
                    </div>
                    <div className="space-y-4">
                      <div className="bg-zinc-900 border border-white/10 rounded-xl p-5 flex justify-between items-center relative overflow-hidden">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500" />
                        <div className="flex items-center gap-4">
                          <div className="w-4 h-4 rounded-full bg-zinc-950 border-2 border-zinc-700 shadow-sm" />
                          <div>
                            <div className="text-white font-bold">PLA Negro</div>
                            <div className="text-xs text-gray-400">GST3D - Abierta</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-black text-orange-400">742 g</div>
                          <div className="text-xs text-gray-500">Queda 74%</div>
                        </div>
                      </div>
                      
                      <div className="bg-zinc-900 border border-white/5 rounded-xl p-5 flex justify-between items-center">
                        <div className="flex items-center gap-4">
                          <div className="w-4 h-4 rounded-full bg-white border-2 border-gray-300 shadow-sm" />
                          <div>
                            <div className="text-white font-bold">PLA Blanco</div>
                            <div className="text-xs text-gray-400">Grilon3 - Cerrada</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-black text-white">1000 g</div>
                        </div>
                      </div>

                      <div className="bg-zinc-900/50 border border-red-500/20 rounded-xl p-5 flex justify-between items-center opacity-70">
                        <div className="flex items-center gap-4">
                          <div className="w-4 h-4 rounded-full bg-red-600 border-2 border-red-800 shadow-sm" />
                          <div>
                            <div className="text-gray-300 font-bold">PETG Rojo</div>
                            <div className="text-xs text-red-400">Sin stock</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-black text-red-500">0 g</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 4: Presupuestos */}
                  <div className={`absolute inset-0 p-6 md:p-10 transition-all duration-500 ${activeStep === 4 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 pointer-events-none'}`}>
                    <div className="flex items-center gap-3 mb-8">
                      <FileText className="w-6 h-6 text-purple-400" />
                      <span className="font-semibold text-white text-xl">Presupuesto #PRE-0042</span>
                    </div>
                    
                    <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 md:p-8 relative overflow-hidden shadow-xl">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 blur-3xl rounded-full" />
                      
                      <div className="flex justify-between items-start mb-8">
                        <div>
                          <div className="text-sm font-medium text-gray-400 mb-1">Cliente</div>
                          <div className="text-2xl font-bold text-white">Taller Racing SRL</div>
                        </div>
                        <div className="px-3 py-1.5 rounded-md bg-purple-500/20 text-purple-300 text-sm font-semibold border border-purple-500/20">
                          Enviado
                        </div>
                      </div>

                      <div className="space-y-4 mb-8">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-400">5x Soporte motor PETG</span>
                          <span className="text-white font-medium">$45.000</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-400">12x Tapa protectora PLA</span>
                          <span className="text-white font-medium">$70.000</span>
                        </div>
                      </div>

                      <div className="border-t border-white/10 pt-6 flex justify-between items-end">
                        <span className="text-sm text-gray-400 font-medium">Total Final:</span>
                        <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-white">$115.000</span>
                      </div>
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
