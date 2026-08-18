"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { GraduationCap, ArrowRight, BookOpen, PenTool, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { RecommendedPathSection } from "@/components/academy/RecommendedPathSection";
import { UserProfile } from "@/lib/learning-roadmaps";

export default function AcademiaPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [learningPaths, setLearningPaths] = useState<any[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("main_printer_brand, main_printer_model, experience_level, main_goal, commercial_stage, onboarding_completed")
          .eq("id", user.id)
          .single();
        if (profileData) setProfile(profileData);
      }

      const { data: coursesData, error: fetchErr } = await supabase
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

      const { data: lpData } = await supabase
        .from("learning_paths")
        .select(`
          *,
          learning_path_courses (
            course_id,
            reason,
            sort_order
          )
        `);

      if (fetchErr) {
        console.error("Error fetching data:", fetchErr);
        setError(fetchErr.message);
      } else {
        if (coursesData) setCourses(coursesData);
        if (lpData) setLearningPaths(lpData);
      }

      setLoading(false);
    };

    fetchData();
  }, [supabase]);

  return (
    <div className="space-y-8 pb-10">
      {/* Header Premium */}
      <div className="relative overflow-hidden rounded-3xl bg-stampa-surface border border-stampa-border p-8 sm:p-10 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-[#ff6a00]/20 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-3xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="rounded-full bg-stampa-orange/10 text-stampa-orange text-xs font-bold px-3 py-1 uppercase tracking-wider border border-[#ff6a00]/20">
              Academia Stampa
            </span>
          </div>
          <h1 className="text-3xl font-bold text-white sm:text-4xl flex items-center gap-3">
            <GraduationCap size={36} className="text-stampa-orange" /> Academia
          </h1>
          <p className="mt-3 text-base text-gray-400 leading-relaxed">
            Seguí tu ruta recomendada o explorá cursos y talleres prácticos.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card Cursos */}
        <Link href="/cursos" className="group block h-full">
          <div className="relative overflow-hidden rounded-3xl bg-stampa-surface border border-stampa-border p-8 shadow-xl transition-all hover:-translate-y-1 hover:border-[#ff6a00]/50 hover:shadow-[0_8px_30px_rgb(255,106,0,0.12)] h-full flex flex-col justify-between min-h-[220px]">
            <div className="absolute top-0 right-0 p-8 opacity-10 transition-transform group-hover:scale-110 group-hover:opacity-20">
              <BookOpen size={100} className="text-stampa-orange" />
            </div>

            <div className="relative z-10">
              <h2 className="text-2xl font-bold text-white mb-3">Cursos</h2>
              <p className="text-gray-400 max-w-[85%]">
                Aprendé de forma estructurada, desde fundamentos hasta herramientas avanzadas.
              </p>
            </div>

            <div className="relative z-10 mt-8 flex items-center text-stampa-orange font-bold text-sm uppercase tracking-wider">
              Explorar cursos
              <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        </Link>

        {/* Card Talleres */}
        <Link href="/talleres" className="group block h-full">
          <div className="relative overflow-hidden rounded-3xl bg-stampa-surface border border-stampa-border p-8 shadow-xl transition-all hover:-translate-y-1 hover:border-blue-500/50 hover:shadow-[0_8px_30px_rgb(59,130,246,0.12)] h-full flex flex-col justify-between min-h-[220px]">
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

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-sm text-red-400">
          Error al cargar la ruta recomendada: {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-stampa-orange h-8 w-8" />
        </div>
      ) : (
        <>
          {courses.length > 0 && (
            <RecommendedPathSection
              profile={profile}
              learningPaths={learningPaths}
              courses={courses}
            />
          )}

          {/* CTA discreto */}
          <div className="mt-8">
            <Link href="/configuracion?tab=cuenta" className="group block">
              <div className="bg-stampa-bg-soft border border-stampa-border rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:bg-stampa-surface hover:border-stampa-border">
                <div>
                  <h3 className="text-white font-bold text-lg mb-1">¿Querés ajustar tus recomendaciones?</h3>
                  <p className="text-gray-400 text-sm">Podés cambiar tu impresora, objetivo o nivel desde Configuración para recalcular tu ruta.</p>
                </div>
                <div className="flex justify-center items-center gap-2 bg-white/5 group-hover:bg-stampa-orange group-hover:text-white px-4 py-2 rounded-lg text-sm text-gray-300 font-medium transition-colors whitespace-nowrap w-full sm:w-auto">
                  Ajustar perfil
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
