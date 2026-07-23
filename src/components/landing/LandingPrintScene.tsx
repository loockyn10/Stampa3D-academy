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
      {/* Background radial glow */}
      <div className="absolute inset-0 bg-orange-600/10 blur-[100px] rounded-full" />
      
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

        {/* Scan line */}
        <div className="absolute left-0 right-0 h-1 bg-white/20 shadow-[0_0_15px_rgba(255,255,255,0.5)] z-40" style={{ animation: 'stampa-layer-scan 4s linear infinite' }} />

        {/* Nozzle */}
        <div className="absolute top-[10%] flex flex-col items-center z-20" style={{ animation: 'stampa-nozzle-move 4s ease-in-out infinite' }}>
          <div className="w-16 h-20 bg-gradient-to-b from-zinc-800 to-zinc-950 border-x border-t border-zinc-700 rounded-t-lg relative">
            <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_40%,rgba(234,88,12,0.1)_100%)]" />
            {/* Vents */}
            <div className="absolute top-4 left-2 right-2 h-1 bg-black rounded-full opacity-50" />
            <div className="absolute top-8 left-2 right-2 h-1 bg-black rounded-full opacity-50" />
            <div className="absolute top-12 left-2 right-2 h-1 bg-black rounded-full opacity-50" />
          </div>
          {/* Heat block */}
          <div className="w-12 h-6 bg-zinc-900 border border-orange-500/30 flex items-center justify-center relative">
            <div className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(234,88,12,1)]" />
          </div>
          {/* Tip */}
          <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[10px] border-t-zinc-900 relative">
            {/* Extrusion Line */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-1 h-32 bg-orange-500 shadow-[0_0_15px_rgba(234,88,12,1)]" />
          </div>
        </div>

        {/* Abstract Printed Piece */}
        <div className="absolute top-[50%] w-48 h-48 md:w-64 md:h-64 z-10 flex flex-col items-center justify-end perspective-500" style={{ transform: 'rotateX(60deg) rotateZ(45deg)' }}>
          {/* Base / Bed Grid */}
          <div className="absolute -inset-20 border border-white/5 bg-zinc-900/40 rounded-xl" style={{ backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
            {/* Glow on bed */}
            <div className="absolute inset-0 bg-orange-500/10 blur-xl rounded-full" />
          </div>

          {/* Layers building up */}
          <div className="relative w-32 h-32 md:w-48 md:h-48 flex flex-col justify-end items-center transform-style-3d">
            {[...Array(12)].map((_, i) => (
              <div 
                key={i} 
                className="w-full h-1 md:h-2 bg-orange-600/30 border border-orange-500/20 mb-1" 
                style={{ 
                  transform: `translateZ(${i * 4}px)`,
                  width: `${100 - (i * 4)}%`,
                  animation: 'stampa-layer-build 4.8s infinite',
                  animationDelay: `${i * 0.4}s`
                }} 
              />
            ))}
          </div>
        </div>

        {/* Floating Particles (Sparks) */}
        {[...Array(15)].map((_, i) => (
          <div 
            key={i} 
            className="absolute w-1 h-1 bg-orange-400 rounded-full blur-[1px]"
            style={{
              top: `${40 + Math.random() * 20}%`,
              left: `${40 + Math.random() * 20}%`,
              animation: `stampa-float ${3 + Math.random() * 4}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 2}s`,
              opacity: 0.2 + Math.random() * 0.5
            }}
          />
        ))}

      </div>
    </div>
  );
}
