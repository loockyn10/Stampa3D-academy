"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { CourseCard } from "@/components/cards/course-card";
import { Loader2, GraduationCap, Compass, Settings2 } from "lucide-react";
import { getRecommendedCourseOrder, UserProfile, findBestLearningPath, formatPrinterBrandLabel, formatExperienceLevelLabel, formatMainGoalLabel } from "@/lib/learning-roadmaps";
import Link from "next/link";


export default function CursosPage() {
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
          .select("main_printer_brand, main_printer_model, experience_level, main_goal, onboarding_completed")
          .eq("id", user.id)
          .single();
        if (profileData) setProfile(profileData);
      }

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
        console.error("Error fetching courses:", fetchErr);
        setError(fetchErr.message);
      } else if (data) {
        setCourses(data);
      }
      
      if (lpData) {
        setLearningPaths(lpData);
      }
      
      setLoading(false);
    };

    fetchData();
  }, [supabase]);

  return (
    <div className="space-y-8 pb-10">
      {/* Header Premium */}
      <div className="relative overflow-hidden rounded-3xl bg-[#111] border border-white/10 p-8 sm:p-10 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-[#ff6a00]/10 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-3xl">
          <div className="flex items-center gap-2 mb-3 justify-between">
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
        <>
          {/* RUTA RECOMENDADA */}
          {(() => {
            const bestDbPath = findBestLearningPath(profile, learningPaths);
            
            let roadmapTitle = "";
            let roadmapSubtitle = "";
            let roadmapChips: string[] = [];
            let roadmapCourses: any[] = [];
            
            if (bestDbPath && bestDbPath.learning_path_courses?.length > 0) {
              // DB Roadmap
              roadmapTitle = bestDbPath.name;
              roadmapSubtitle = bestDbPath.description;
              
              if (bestDbPath.printer_brand) roadmapChips.push(formatPrinterBrandLabel(bestDbPath.printer_brand));
              if (bestDbPath.experience_level) roadmapChips.push(formatExperienceLevelLabel(bestDbPath.experience_level));
              if (bestDbPath.main_goal) roadmapChips.push(formatMainGoalLabel(bestDbPath.main_goal));
              if (roadmapChips.length === 0) roadmapChips.push("Ruta General");

              // Map courses
              const sortedDbCourses = [...bestDbPath.learning_path_courses].sort((a, b) => a.sort_order - b.sort_order);
              roadmapCourses = sortedDbCourses.map(lpc => {
                const c = courses.find(course => course.id === lpc.course_id);
                if (!c) return null;
                return {
                  ...c,
                  roadmap_reason: lpc.reason
                };
              }).filter(Boolean);

            } else {
              // Fallback hardcoded logic
              const fallbackRoadmap = getRecommendedCourseOrder(profile, courses);
              roadmapTitle = fallbackRoadmap.title;
              roadmapSubtitle = fallbackRoadmap.subtitle;
              roadmapChips = fallbackRoadmap.chips;
              roadmapCourses = fallbackRoadmap.recommendedCourses;
            }
            
            if (roadmapCourses.length === 0) return null;

            return (
              <div className="mb-12">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2 mb-2">
                      <Compass className="text-[#ff6a00]" size={24} /> {roadmapTitle}
                    </h2>
                    <p className="text-gray-400 text-sm">{roadmapSubtitle}</p>
                    
                    {roadmapChips.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-4">
                        {roadmapChips.map(chip => (
                          <span key={chip} className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs text-gray-300 font-medium">
                            {chip}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <Link 
                    href="/configuracion?tab=cuenta" 
                    className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors py-2"
                  >
                    <Settings2 size={16} /> Editar preferencias
                  </Link>
                </div>

                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {roadmapCourses.map((c, index) => (
                    <div key={`rec-${c.id}`} className="relative group">
                      <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-[#ff6a00] text-white flex items-center justify-center font-bold text-sm shadow-lg z-10 border-4 border-[#050505]">
                        {index + 1}
                      </div>
                      <div className="rounded-3xl border border-[#ff6a00]/30 shadow-[0_0_15px_rgba(255,106,0,0.1)] overflow-hidden h-full">
                        <CourseCard course={c} />
                        {c.roadmap_reason && (
                          <div className="bg-[#ff6a00]/10 px-4 py-3 text-xs text-[#ff6a00] font-medium border-t border-[#ff6a00]/20 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#ff6a00] animate-pulse" />
                            {c.roadmap_reason}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* TODOS LOS CURSOS */}
          <div>
            <h2 className="text-2xl font-bold text-white mb-6">Todos los cursos</h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {courses.map((c) => (
                <CourseCard key={c.id} course={c} />
              ))}
            </div>
          </div>
        </>
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
