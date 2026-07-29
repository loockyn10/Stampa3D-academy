"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { CourseCard } from "@/components/cards/course-card";
import { Loader2, GraduationCap } from "lucide-react";

export default function CursosPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const fetchCourses = async () => {
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
        .order("sort_order", { ascending: true });

      if (fetchErr) {
        console.error("Error fetching courses:", fetchErr);
        setError(fetchErr.message);
      } else if (data) {
        setCourses(data);
      }
      setLoading(false);
    };

    fetchCourses();
  }, [supabase]);

  return (
    <div className="space-y-8 pb-10">
      {/* Header Premium */}
      <div className="relative overflow-hidden rounded-3xl bg-[#111] border border-white/10 p-8 sm:p-10 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-[#ff6a00]/10 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-3xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="rounded-full bg-[#ff6a00]/10 text-[#ff6a00] text-xs font-bold px-3 py-1 uppercase tracking-wider border border-[#ff6a00]/20">
              Academia
            </span>
          </div>
          <h1 className="text-3xl font-bold text-white sm:text-4xl flex items-center gap-3">
            <GraduationCap size={36} className="text-[#ff6a00]" /> Cursos
          </h1>
          <p className="mt-3 text-base text-gray-400 leading-relaxed">
            Aprendé impresión 3D paso a paso con rutas pensadas para pasar de cero a taller rentable.
          </p>
        </div>
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
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
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
