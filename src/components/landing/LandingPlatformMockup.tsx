"use client";

import { BookOpen, DollarSign, Database, FileText, Gift, Activity } from "lucide-react";
import { useIntersection } from "./use-intersection";
import { useState, useEffect } from "react";

export function LandingPlatformMockup() {
  const [ref, isIntersecting] = useIntersection<HTMLDivElement>({ threshold: 0.1 });
  const [progress, setProgress] = useState(0);
  const [price, setPrice] = useState(0);

  useEffect(() => {
    if (isIntersecting) {
      // Animate progress bar
      const progressTimer = setTimeout(() => setProgress(68), 500);
      
      // Animate price (simple counter effect)
      let currentPrice = 0;
      const targetPrice = 18700;
      const interval = setInterval(() => {
        currentPrice += 450;
        if (currentPrice >= targetPrice) {
          setPrice(targetPrice);
          clearInterval(interval);
        } else {
          setPrice(currentPrice);
        }
      }, 20);

      return () => {
        clearTimeout(progressTimer);
        clearInterval(interval);
      };
    } else {
      setProgress(0);
      setPrice(0);
    }
  }, [isIntersecting]);

  return (
    <section className="py-24 bg-zinc-950 overflow-hidden relative">
      {/* Background gradients */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-orange-600/10 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="container mx-auto px-6" ref={ref}>
        <div className={`text-center max-w-3xl mx-auto mb-16 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`}>
          <h2 className="text-3xl md:text-5xl font-bold mb-6 text-white">
            Un vistazo a tu nuevo centro de control
          </h2>
          <p className="text-gray-400 text-lg md:text-xl">
            Todo lo que necesitás para gestionar tu emprendimiento de impresión 3D en un solo lugar.
          </p>
        </div>

        {/* Mockup Container */}
        <div className={`relative max-w-5xl mx-auto group stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`} style={{ animationDelay: '0.2s' }}>
          {/* Decorative frame */}
          <div className="absolute -inset-1 bg-gradient-to-r from-orange-600 to-orange-400 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200" />
          
          <div className="relative bg-[#09090b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* Window header */}
            <div className="h-12 border-b border-white/5 bg-white/5 flex items-center px-4 justify-between">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
              </div>
              <div className="text-xs text-gray-500 font-mono flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                academia-stampa.com/dashboard
              </div>
              <div className="w-16" /> {/* Spacer for balance */}
            </div>

            {/* Dashboard content */}
            <div className="p-6 md:p-8 grid md:grid-cols-12 gap-6">
              
              {/* Sidebar (simplified) */}
              <div className="hidden md:flex flex-col gap-4 col-span-3 border-r border-white/5 pr-6">
                <div className="h-8 w-3/4 bg-white/10 rounded mb-4" />
                {[BookOpen, CalculatorIcon, Database, FileText, Gift].map((Icon, idx) => (
                  <div key={idx} className={`flex items-center gap-3 p-2 rounded-lg ${idx === 0 ? 'bg-orange-500/10 text-orange-400' : 'text-gray-400'}`}>
                    <Icon className="w-5 h-5" />
                    <div className="h-4 w-1/2 bg-current opacity-20 rounded" />
                  </div>
                ))}
              </div>

              {/* Main Content */}
              <div className="col-span-12 md:col-span-9 space-y-6">
                
                {/* Top Cards Row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Card 1: Progreso */}
                  <div className={`bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col gap-3 hover:bg-white/10 transition-colors cursor-default stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`} style={{ animationDelay: '0.4s' }}>
                    <div className="flex justify-between items-start">
                      <div className="p-2 rounded-lg bg-blue-400/10 text-blue-400">
                        <BookOpen className="w-4 h-4" />
                      </div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-white mb-1">{progress}%</div>
                      <div className="text-xs text-gray-400">Progreso curso</div>
                    </div>
                    <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden mt-1">
                      <div 
                        className="h-full bg-blue-400 transition-all duration-1000 ease-out" 
                        style={{ width: `${progress}%` }} 
                      />
                    </div>
                  </div>

                  {/* Card 2: Precio */}
                  <div className={`bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col gap-3 hover:bg-white/10 transition-colors cursor-default stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`} style={{ animationDelay: '0.5s' }}>
                    <div className="flex justify-between items-start">
                      <div className="p-2 rounded-lg bg-green-400/10 text-green-400">
                        <DollarSign className="w-4 h-4" />
                      </div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-white mb-1">
                        $\{(price / 1000).toFixed(3).replace('.', '.')}
                      </div>
                      <div className="text-xs text-gray-400">Precio Sugerido</div>
                    </div>
                  </div>

                  {/* Card 3: Filamento */}
                  <div className={`bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col gap-3 hover:bg-white/10 transition-colors cursor-default stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`} style={{ animationDelay: '0.6s' }}>
                    <div className="flex justify-between items-start">
                      <div className="p-2 rounded-lg bg-orange-400/10 text-orange-400">
                        <Database className="w-4 h-4" />
                      </div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-white mb-1">742g</div>
                      <div className="text-xs text-gray-400">Filamento</div>
                    </div>
                  </div>

                  {/* Card 4: Presupuestos */}
                  <div className={`bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col gap-3 hover:bg-white/10 transition-colors cursor-default relative overflow-hidden stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`} style={{ animationDelay: '0.7s' }}>
                    <div className="absolute -right-4 -top-4 w-12 h-12 bg-purple-500/20 rounded-full blur-xl animate-pulse" />
                    <div className="flex justify-between items-start relative z-10">
                      <div className="p-2 rounded-lg bg-purple-400/10 text-purple-400">
                        <FileText className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="relative z-10">
                      <div className="text-xl font-bold text-white mb-1">3 Enviados</div>
                      <div className="text-xs text-purple-400 font-medium">Presupuestos activos</div>
                    </div>
                  </div>
                </div>

                {/* Main Action Area */}
                <div className="grid lg:grid-cols-3 gap-6">
                  {/* Calculator preview */}
                  <div className={`lg:col-span-2 bg-gradient-to-br from-zinc-900 to-black border border-white/5 rounded-xl p-6 stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`} style={{ animationDelay: '0.8s' }}>
                    <div className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-orange-500" />
                      Calculadora Rápida
                    </div>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="h-3 w-20 bg-white/10 rounded" />
                          <div className="h-10 bg-white/5 rounded-lg border border-white/10 flex items-center px-3">
                            <div className="h-4 w-16 bg-white/20 rounded" />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="h-3 w-24 bg-white/10 rounded" />
                          <div className="h-10 bg-white/5 rounded-lg border border-white/10 flex items-center px-3">
                            <div className="h-4 w-12 bg-white/20 rounded" />
                          </div>
                        </div>
                      </div>
                      <div className="h-12 bg-orange-600/20 text-orange-400 border border-orange-500/30 rounded-lg flex items-center justify-center font-medium hover:bg-orange-600/30 transition-colors cursor-pointer">
                        Calcular Costo Final
                      </div>
                    </div>
                  </div>

                  {/* Active giveaway / Sidebar widget */}
                  <div className={`bg-orange-950/20 border border-orange-500/20 rounded-xl p-6 flex flex-col justify-between relative overflow-hidden stampa-reveal-hidden ${isIntersecting ? 'stampa-reveal-visible' : ''}`} style={{ animationDelay: '0.9s' }}>
                    <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full blur-2xl -mr-16 -mt-16" />
                    <div className="relative z-10">
                      <div className="flex items-center gap-2 text-orange-400 mb-3">
                        <Gift className="w-4 h-4 animate-bounce" style={{ animationDuration: '2s' }} />
                        <span className="text-sm font-medium">Sorteo Activo</span>
                      </div>
                      <div className="text-white font-bold mb-2">Bobina PLA Grilon3</div>
                      <div className="text-xs text-gray-400">Participá subiendo tu última impresión al foro.</div>
                    </div>
                    <div className="mt-4 h-8 bg-orange-500 hover:bg-orange-400 transition-colors text-white rounded text-sm flex items-center justify-center font-medium opacity-90 cursor-pointer relative z-10">
                      Participar
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

// Sub-component for an icon
function CalculatorIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <line x1="8" x2="16" y1="6" y2="6" />
      <line x1="16" x2="16" y1="14" y2="18" />
      <path d="M16 10h.01" />
      <path d="M12 10h.01" />
      <path d="M8 10h.01" />
      <path d="M12 14h.01" />
      <path d="M8 14h.01" />
      <path d="M12 18h.01" />
      <path d="M8 18h.01" />
    </svg>
  );
}
