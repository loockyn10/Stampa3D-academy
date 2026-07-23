"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled 
          ? "bg-black/80 border-b border-white/10 py-3 shadow-[0_4px_30px_rgba(0,0,0,0.5)] md:backdrop-blur-md" 
          : "bg-transparent py-5"
      }`}
    >
      <div className="container mx-auto px-6 flex items-center justify-between">
        
        {/* Logo */}
        <Link href="/landing" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white font-bold text-lg shadow-[0_0_15px_rgba(234,88,12,0.4)] group-hover:shadow-[0_0_20px_rgba(234,88,12,0.6)] transition-all">
            S
          </div>
          <span className="font-bold text-xl text-white tracking-tight hidden sm:block">
            Stampa3D <span className="text-orange-500">Academy</span>
          </span>
        </Link>

        {/* Links (Desktop) */}
        <div className="hidden md:flex items-center gap-8 text-sm font-medium">
          <Link href="#plataforma" className="text-gray-300 hover:text-white transition-colors">Plataforma</Link>
          <Link href="#cursos" className="text-gray-300 hover:text-white transition-colors">Cursos</Link>
          <Link href="#herramientas" className="text-gray-300 hover:text-white transition-colors">Herramientas</Link>
          <Link href="#precio" className="text-gray-300 hover:text-white transition-colors">Precio</Link>
        </div>

        {/* Action */}
        <Link 
          href="/login"
          className="px-5 py-2 rounded-lg bg-white/10 hover:bg-orange-500 text-white text-sm font-medium transition-all duration-300 border border-white/10 hover:border-orange-400 shadow-[0_0_0_rgba(234,88,12,0)] hover:shadow-[0_0_15px_rgba(234,88,12,0.4)]"
        >
          Entrar
        </Link>
      </div>
    </nav>
  );
}
