"use client";

import { CheckCircle2, PlayCircle, Box, Calculator, Ticket } from "lucide-react";

export function LandingHeroMockup() {
  return (
    <div className="relative w-full max-w-2xl mx-auto md:animate-[floating_6s_ease-in-out_infinite] [animation-play-state:paused] md:[animation-play-state:running] motion-reduce:[animation-play-state:paused]">
      {/* Glow background */}
      <div className="absolute inset-0 bg-orange-500/20 md:bg-orange-500/30 blur-[60px] md:blur-[100px] rounded-full" />
      
      {/* Main Mockup Container */}
      <div className="relative bg-zinc-950/80 backdrop-blur-xl md:backdrop-blur-2xl border border-white/10 rounded-2xl p-6 shadow-2xl overflow-hidden group">
        
        {/* Mockup Header */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/5">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-[0_0_15px_rgba(234,88,12,0.5)]">
            <span className="font-bold text-white text-lg">S</span>
          </div>
          <div>
            <h3 className="font-semibold text-white/90">Stampa3D Dashboard</h3>
            <p className="text-xs text-white/50">Plan Profesional</p>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          
          {/* Card 1: Curso Activo */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors duration-300 transform md:hover:-translate-y-1">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-white/80">
                <PlayCircle className="w-5 h-5 text-orange-400" />
                <span className="text-sm font-medium">Curso Activo</span>
              </div>
              <span className="text-xs font-bold text-orange-400">68%</span>
            </div>
            <p className="text-sm text-white mb-2">Impresión 3D Inicial</p>
            <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
              <div className="bg-gradient-to-r from-orange-600 to-orange-400 h-1.5 rounded-full w-[0%] animate-[grow_1.5s_ease-out_forwards]" style={{ "--grow-target": "68%" } as React.CSSProperties} />
            </div>
          </div>

          {/* Card 2: Precio Sugerido */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors duration-300 transform md:hover:-translate-y-1">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-white/80">
                <Calculator className="w-5 h-5 text-green-400" />
                <span className="text-sm font-medium">Cotizador</span>
              </div>
            </div>
            <p className="text-xs text-white/50 mb-1">Precio sugerido (Soporte Joystick)</p>
            <p className="text-xl font-bold text-white">$18.700</p>
          </div>

          {/* Card 3: Stock */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors duration-300 transform md:hover:-translate-y-1">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-white/80">
                <Box className="w-5 h-5 text-blue-400" />
                <span className="text-sm font-medium">Stock Actual</span>
              </div>
            </div>
            <p className="text-sm text-white mb-1">PLA Negro - Grilon3</p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-lg font-bold text-white">742 g</span>
              <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-300 rounded-md">Restante</span>
            </div>
          </div>

          {/* Card 4: Presupuesto & Sorteo */}
          <div className="flex flex-col gap-4">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-between hover:bg-white/10 transition-colors duration-300 md:hover:-translate-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-medium text-white/80">Presupuesto #142</span>
              </div>
              <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">Enviado</span>
            </div>
            
            <div className="bg-gradient-to-r from-orange-600/20 to-orange-400/20 border border-orange-500/30 rounded-xl p-3 flex items-center justify-between hover:bg-orange-500/30 transition-colors duration-300 md:hover:-translate-y-1">
              <div className="flex items-center gap-2">
                <Ticket className="w-5 h-5 text-orange-400" />
                <span className="text-sm font-medium text-orange-100">Sorteo Especial</span>
              </div>
              <span className="text-xs text-white bg-orange-500 px-2 py-1 rounded-full animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.5)]">Activo</span>
            </div>
          </div>

        </div>

        {/* Decorative elements inside mockup */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-orange-500/20 blur-[50px] rounded-full pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-orange-600/20 blur-[50px] rounded-full pointer-events-none" />
      </div>

      <style jsx global>{`
        @keyframes floating {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-15px); }
        }
        @keyframes grow {
          from { width: 0%; }
          to { width: var(--grow-target); }
        }
      `}</style>
    </div>
  );
}
