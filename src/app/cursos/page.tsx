"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { CourseCard } from "@/components/cards/course-card";
import { Loader2, GraduationCap } from "lucide-react";
import Link from "next/link";

export default function CursosPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchErr } = await supabase
        .from("courses")
        .select(`
          *,
          instructors ( name ),
          course_modules (
            lessons ( id, duration_minutes )
          )
        `)
        .eq("status", "published")
        .eq("course_kind", "course")
        .order("sort_order", { ascending: true });

      if (fetchErr) {
        console.error("Error fetching courses:", fetchErr);
        setError(fetchErr.message);
      } else if (data) {
        setCourses(data);
      }
      
      setLoading(false);
    };

    fetchData();
  }, [supabase]);

  const filteredCourses = courses.filter((c) => {
    const term = searchTerm.toLowerCase();
    return (
      (c.title || "").toLowerCase().includes(term) ||
      (c.description || "").toLowerCase().includes(term) ||
      (c.level || "").toLowerCase().includes(term) ||
      (c.slug || "").toLowerCase().includes(term) ||
      (c.instructors?.name || "").toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-8 pb-10">
      {/* Header Premium */}
      <div className="relative overflow-hidden rounded-3xl bg-[#111] border border-white/10 p-8 sm:p-10 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-[#ff6a00]/10 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-3xl">
          <div className="flex items-center gap-2 mb-3 justify-between">
            <Link 
              href="/academia"
              className="rounded-full bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold px-3 py-1 uppercase tracking-wider border border-white/10 transition-colors"
            >
              ← Academia
            </Link>
          </div>
          <h1 className="text-3xl font-bold text-white sm:text-4xl flex items-center gap-3 mt-4">
            <GraduationCap size={36} className="text-[#ff6a00]" /> Cursos
          </h1>
          <p className="mt-3 text-base text-gray-400 leading-relaxed">
            Explorá cursos estructurados por nivel, impresora y objetivo.
          </p>
        </div>
      </div>

      {/* Buscador */}
      <div className="relative max-w-xl">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <svg className="h-5 w-5 text-neutral-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
          </svg>
        </div>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar cursos por nombre, tema, o nivel..."
          className="w-full pl-11 pr-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#ff6a00]/50 focus:border-[#ff6a00]/50 transition-all shadow-inner"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm("")}
            className="absolute inset-y-0 right-0 pr-4 flex items-center text-neutral-500 hover:text-white"
          >
            Limpiar
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-sm text-red-400">
          Error al cargar los cursos: {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-[#ff6a00] h-10 w-10" />
        </div>
      ) : courses.length > 0 ? (
        <div>
          <h2 className="text-2xl font-bold text-white mb-6">Todos los cursos</h2>
          {filteredCourses.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCourses.map((c) => (
                <CourseCard key={c.id} course={c} />
              ))}
            </div>
          ) : (
            <div className="bg-[#111] border border-white/10 p-8 rounded-xl text-center">
              <p className="text-gray-400 mb-4">No encontramos cursos con esa búsqueda.</p>
              <button
                onClick={() => setSearchTerm("")}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-white transition-colors"
              >
                Limpiar búsqueda
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="max-w-xl mx-auto mt-12 text-center">
          <div className="bg-[#111] rounded-3xl p-10 border border-white/10 shadow-xl">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
              <GraduationCap size={40} className="text-gray-500" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">Todavía no hay cursos publicados</h2>
            <p className="text-gray-400">
              Estamos preparando contenido increíble para ti. ¡Vuelve pronto para comenzar tu ruta de aprendizaje!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
