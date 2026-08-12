"use client";

import React from "react";
import Link from "next/link";
import { GraduationCap, ArrowRight, BookOpen, PenTool } from "lucide-react";

export default function AcademiaPage() {
  return (
    <div className="space-y-8 pb-10">
      {/* Header Premium */}
      <div className="relative overflow-hidden rounded-3xl bg-[#111] border border-white/10 p-8 sm:p-10 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-[#ff6a00]/10 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-3xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="rounded-full bg-[#ff6a00]/10 text-[#ff6a00] text-xs font-bold px-3 py-1 uppercase tracking-wider border border-[#ff6a00]/20">
              Academia Stampa
            </span>
          </div>
          <h1 className="text-3xl font-bold text-white sm:text-4xl flex items-center gap-3">
            <GraduationCap size={36} className="text-[#ff6a00]" /> Academia
          </h1>
          <p className="mt-3 text-base text-gray-400 leading-relaxed">
            Seguí tu ruta de aprendizaje o explorá cursos y talleres prácticos de Academia Stampa.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card Cursos */}
        <Link href="/cursos" className="group block h-full">
          <div className="relative overflow-hidden rounded-3xl bg-[#111] border border-white/10 p-8 shadow-xl transition-all hover:-translate-y-1 hover:border-[#ff6a00]/50 hover:shadow-[0_8px_30px_rgb(255,106,0,0.12)] h-full flex flex-col justify-between min-h-[220px]">
            <div className="absolute top-0 right-0 p-8 opacity-10 transition-transform group-hover:scale-110 group-hover:opacity-20">
              <BookOpen size={100} className="text-[#ff6a00]" />
            </div>
            
            <div className="relative z-10">
              <h2 className="text-2xl font-bold text-white mb-3">Cursos</h2>
              <p className="text-gray-400 max-w-[85%]">
                Aprendé de forma estructurada, desde fundamentos hasta herramientas avanzadas.
              </p>
            </div>
            
            <div className="relative z-10 mt-8 flex items-center text-[#ff6a00] font-bold text-sm uppercase tracking-wider">
              Explorar cursos
              <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        </Link>

        {/* Card Talleres */}
        <Link href="/talleres" className="group block h-full">
          <div className="relative overflow-hidden rounded-3xl bg-[#111] border border-white/10 p-8 shadow-xl transition-all hover:-translate-y-1 hover:border-blue-500/50 hover:shadow-[0_8px_30px_rgb(59,130,246,0.12)] h-full flex flex-col justify-between min-h-[220px]">
            <div className="absolute top-0 right-0 p-8 opacity-10 transition-transform group-hover:scale-110 group-hover:opacity-20">
              <PenTool size={100} className="text-blue-500" />
            </div>
            
            <div className="relative z-10">
              <h2 className="text-2xl font-bold text-white mb-3">Talleres</h2>
              <p className="text-gray-400 max-w-[85%]">
                Construí proyectos reales paso a paso y aplicá lo aprendido en productos concretos.
              </p>
            </div>
            
            <div className="relative z-10 mt-8 flex items-center text-blue-500 font-bold text-sm uppercase tracking-wider">
              Explorar talleres
              <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        </Link>
      </div>

      {/* Card Opcional Rutas */}
      <div className="mt-8">
        <Link href="/cursos" className="group block">
          <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:bg-[#111] hover:border-white/10">
            <div>
              <h3 className="text-white font-bold text-lg mb-1">¿No sabés por dónde empezar?</h3>
              <p className="text-gray-400 text-sm">Entrá a Cursos y seguí tu ruta recomendada según tu impresora y objetivo.</p>
            </div>
            <div className="inline-flex items-center gap-2 bg-white/5 group-hover:bg-[#ff6a00] group-hover:text-white px-4 py-2 rounded-lg text-sm text-gray-300 font-medium transition-colors whitespace-nowrap">
              Ver mi ruta
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </Link>
      </div>

    </div>
  );
}
