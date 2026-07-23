"use client";

import { useEffect, useRef, useState } from "react";

export function LandingPrintScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isMobile, setIsMobile] = useState(true);

  // Parallax effect on mouse move (desktop only)
  useEffect(() => {
    // Check if mobile based on window width to disable heavy parallax
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);

    const container = containerRef.current;

    const handleMouseMove = (e: MouseEvent) => {
      if (isMobile) return;
      if (!container) return;
      const { left, top, width, height } = container.getBoundingClientRect();
      // Reduced movement intensity by changing divisor from 30 to 200 (approx 85% reduction)
      const x = (e.clientX - left - width / 2) / 200;
      const y = (e.clientY - top - height / 2) / 200;
      setMousePos({ x, y });
    };

    const handleMouseLeave = () => {
      setMousePos({ x: 0, y: 0 });
    };

    if (container) {
      container.addEventListener("mousemove", handleMouseMove);
      container.addEventListener("mouseleave", handleMouseLeave);
    }
    
    return () => {
      if (container) {
        container.removeEventListener("mousemove", handleMouseMove);
        container.removeEventListener("mouseleave", handleMouseLeave);
      }
      window.removeEventListener('resize', checkMobile);
    };
  }, [isMobile]);

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-square max-w-lg mx-auto md:max-w-xl lg:max-w-2xl flex items-center justify-center pointer-events-none"
      style={{ perspective: "1000px" }}
    >
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes print-head-move {
          0%, 100% { transform: translateX(-40px); }
          50% { transform: translateX(40px); }
        }
        @keyframes print-layer-glow {
          0%, 100% { opacity: 0.1; box-shadow: none; }
          50% { opacity: 0.9; box-shadow: 0 0 10px rgba(234,88,12,0.8); }
        }
        
        @media (prefers-reduced-motion: reduce) {
          .animate-print-head {
             animation: none !important;
             transform: translateX(0) !important;
          }
          .animate-print-layer {
             animation: none !important;
             opacity: 0.5 !important;
          }
        }
      `}} />

      {/* Background radial glow */}
      <div className="absolute inset-0 bg-orange-600/10 blur-[100px] rounded-full hidden md:block" />
      
      {/* 3D Scene Container */}
      <div 
        className="relative w-full h-full flex flex-col items-center justify-center transition-transform duration-700 ease-out z-10"
        style={{ transform: `rotateY(${mousePos.x}deg) rotateX(${-mousePos.y}deg)` }}
      >
        {/* Holographic Cards */}
        <div className="absolute top-10 -left-10 md:top-20 md:-left-20 bg-zinc-900/60 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-[0_0_20px_rgba(234,88,12,0.1)] stampa-float" style={{ animationDelay: '0s', zIndex: 30 }}>
          <div className="text-xs text-gray-400 mb-1">Precio calculado</div>
          <div className="text-lg font-bold text-white">$18.700</div>
        </div>
        
        <div className="absolute bottom-32 -right-10 md:bottom-40 md:-right-20 bg-zinc-900/60 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-[0_0_20px_rgba(234,88,12,0.1)] stampa-float" style={{ animationDelay: '2s', zIndex: 30 }}>
          <div className="text-xs text-gray-400 mb-1">Stock controlado</div>
          <div className="text-lg font-bold text-orange-400">742 g restantes</div>
        </div>
        
        <div className="absolute -top-4 right-10 md:-top-10 md:right-20 bg-zinc-900/60 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-[0_0_20px_rgba(234,88,12,0.1)] stampa-float" style={{ animationDelay: '4s', zIndex: 30 }}>
          <div className="text-xs text-gray-400 mb-1">Curso activo</div>
          <div className="text-lg font-bold text-white">68% completado</div>
        </div>

        {/* Printer Structure (X-Axis Rail) */}
        <div className="absolute top-[25%] left-[15%] right-[15%] md:left-[20%] md:right-[20%] h-4 bg-gradient-to-b from-zinc-800 to-zinc-900 border-y border-zinc-700 rounded-sm z-10 shadow-lg flex items-center justify-between">
          <div className="w-6 h-12 bg-zinc-950 border border-zinc-700 rounded-sm -ml-4 shadow-xl" />
          <div className="w-6 h-12 bg-zinc-950 border border-zinc-700 rounded-sm -mr-4 shadow-xl" />
        </div>

        {/* Print Head & Extruder */}
        <div className="absolute top-[22%] z-20 flex flex-col items-center animate-print-head" style={{ animation: 'print-head-move 4s ease-in-out infinite' }}>
          {/* Carriage */}
          <div className="w-20 h-10 bg-zinc-800 border border-zinc-600 rounded-md shadow-2xl flex items-center justify-center relative">
            <div className="w-16 h-2 bg-zinc-950 rounded-full" />
          </div>
          {/* Hotend / Extruder Block */}
          <div className="w-14 h-16 bg-gradient-to-b from-zinc-700 to-zinc-900 border-x border-b border-zinc-600 rounded-b-lg relative flex flex-col items-center pt-2">
            {/* Vents */}
            <div className="w-10 h-1 bg-black rounded-full mb-1 opacity-70" />
            <div className="w-10 h-1 bg-black rounded-full mb-1 opacity-70" />
            <div className="w-10 h-1 bg-black rounded-full opacity-70" />
            {/* Heat block */}
            <div className="absolute bottom-[2px] w-8 h-4 bg-zinc-900 border border-orange-500/40 rounded-sm flex items-center justify-center">
               <div className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(234,88,12,1)]" />
            </div>
            {/* Tip (Nozzle) */}
            <div className="absolute bottom-[-6px] w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[8px] border-t-zinc-800" />
            {/* Short Extrusion Line (Filament) */}
            <div className="absolute bottom-[-16px] w-1 h-3 bg-orange-400 rounded-full shadow-[0_0_8px_rgba(234,88,12,0.8)]" />
          </div>
        </div>

        {/* Abstract Printed Piece & Bed */}
        <div className="absolute top-[48%] w-56 h-56 md:w-64 md:h-64 z-10 flex flex-col items-center justify-end" style={{ transform: 'rotateX(60deg) rotateZ(45deg)' }}>
          {/* Bed Base */}
          <div className="absolute -inset-8 bg-zinc-900/80 border-2 border-zinc-700 rounded-xl shadow-[0_30px_60px_rgba(0,0,0,0.6)]">
            {/* Grid */}
            <div className="absolute inset-0 rounded-xl opacity-30" style={{ backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '15px 15px' }} />
            {/* Subtle bed border glow */}
            <div className="absolute inset-0 border border-orange-500/10 rounded-xl shadow-[inset_0_0_30px_rgba(234,88,12,0.05)]" />
            {/* Shadow under the piece */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black/60 blur-xl rounded-full" />
          </div>

          {/* Piece Layers */}
          <div className="relative w-24 h-24 md:w-32 md:h-32 flex flex-col justify-end items-center transform-style-3d mb-8">
            {[...Array(8)].map((_, i) => {
              // Creating a staggered shape, wider at bottom
              const widthPerc = 100 - (i * 5); 
              return (
                <div 
                  key={i} 
                  className="h-2 md:h-3 bg-zinc-800 border-x border-t border-zinc-700 mb-[1px] relative rounded-sm"
                  style={{ 
                    width: `${widthPerc}%`,
                    transform: `translateZ(${i * 6}px)`,
                  }} 
                >
                  {/* Top face of the layer glowing */}
                  <div 
                    className="absolute inset-0 bg-orange-500/40 animate-print-layer"
                    style={{
                      animation: 'print-layer-glow 4s ease-in-out infinite',
                      animationDelay: `${i * 0.5}s`
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Particles - Reduced to 5 subtle ones */}
        {[...Array(5)].map((_, i) => (
          <div 
            key={i} 
            className="absolute w-1 h-1 bg-orange-400 rounded-full blur-[1px] hidden md:block"
            style={{
              top: `${45 + Math.random() * 15}%`,
              left: `${45 + Math.random() * 15}%`,
              animation: `stampa-float ${3 + Math.random() * 4}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 2}s`,
              opacity: 0.1 + Math.random() * 0.2
            }}
          />
        ))}

      </div>
    </div>
  );
}
