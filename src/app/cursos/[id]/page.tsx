"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play, CheckCircle2, Circle, Loader2, Video, File, ChevronDown, ChevronRight, GraduationCap, Clock, Layers, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { createClient } from "@/utils/supabase/client";
import { getFileAccessUrl } from "@/lib/storage";
import { StampyLessonChat } from "@/components/stampy/StampyLessonChat";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function CursoDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const [course, setCourse] = useState<any>(null);
  const [modules, setModules] = useState<any[]>([]);
  const [lessons, setLessons] = useState<Record<string, any[]>>({});
  const [resources, setResources] = useState<Record<string, any[]>>({});
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [user, setUser] = useState<any>(null);
  
  const [activeLesson, setActiveLesson] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [markingProgress, setMarkingProgress] = useState(false);
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({});
  const [completedBanner, setCompletedBanner] = useState(false);
  
  const supabase = createClient();

  useEffect(() => {
    const fetchCourseData = async () => {
      setLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      // Intentamos buscar por slug primero, sino por ID
      let query = supabase.from("courses").select("*, instructors(name)").eq("status", "published");
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (isUuid) {
        query = query.eq("id", id);
      } else {
        query = query.eq("slug", id);
      }

      const { data: courseData, error: courseError } = await query.single();

      if (courseData && !courseError) {
        setCourse(courseData);

        const { data: modulesData } = await supabase
          .from("course_modules")
          .select("*")
          .eq("course_id", courseData.id)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (modulesData) {
          setModules(modulesData);

          const { data: lessonsData } = await supabase
            .from("lessons")
            .select("*")
            .in("module_id", modulesData.map((m) => m.id))
            .eq("is_active", true)
            .order("sort_order", { ascending: true });

          if (lessonsData) {
            const grouped: Record<string, any[]> = {};
            lessonsData.forEach((l) => {
              if (!grouped[l.module_id]) grouped[l.module_id] = [];
              grouped[l.module_id].push(l);
            });
            setLessons(grouped);
            
            // Set first lesson as active by default
            const firstModule = modulesData[0];
            if (firstModule && grouped[firstModule.id] && grouped[firstModule.id].length > 0) {
              setActiveLesson(grouped[firstModule.id][0]);
            }

            // Fetch resources
            const lessonIds = lessonsData.map((l) => l.id);
            if (lessonIds.length > 0) {
              const { data: resourcesData } = await supabase
                .from("lesson_resources")
                .select("*")
                .in("lesson_id", lessonIds)
                .eq("is_active", true)
                .order("sort_order", { ascending: true });
              
              if (resourcesData) {
                const resGrouped: Record<string, any[]> = {};
                resourcesData.forEach(r => {
                  if (!resGrouped[r.lesson_id]) resGrouped[r.lesson_id] = [];
                  resGrouped[r.lesson_id].push(r);
                });
                setResources(resGrouped);
              }

              // Fetch progress
              if (user) {
                const { data: progressData } = await supabase
                  .from("lesson_progress")
                  .select("*")
                  .eq("user_id", user.id)
                  .in("lesson_id", lessonIds);
                
                if (progressData) {
                  const progGrouped: Record<string, boolean> = {};
                  progressData.forEach(p => {
                    progGrouped[p.lesson_id] = true;
                  });
                  setProgress(progGrouped);
                }
              }
            }
          }
        }
      }
      setLoading(false);
    };

    fetchCourseData();
  }, [id, supabase]);

  useEffect(() => {
    if (activeLesson) {
      setOpenModules(prev => ({ ...prev, [activeLesson.module_id]: true }));
      setCompletedBanner(false);
    }
  }, [activeLesson]);

  const getOrderedLessons = () => {
    const sortedModules = [...modules].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const list: any[] = [];
    sortedModules.forEach((m) => {
      const moduleLessons = [...(lessons[m.id] || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      list.push(...moduleLessons);
    });
    return list;
  };

  const getNextLesson = () => {
    if (!activeLesson) return null;
    const ordered = getOrderedLessons();
    const currentIndex = ordered.findIndex((l) => l.id === activeLesson.id);
    if (currentIndex !== -1 && currentIndex < ordered.length - 1) {
      return ordered[currentIndex + 1];
    }
    return null;
  };

  const getModuleProgress = (moduleId: string) => {
    const moduleLessons = lessons[moduleId] || [];
    if (moduleLessons.length === 0) return null;
    const completed = moduleLessons.filter(l => progress[l.id]).length;
    return {
      completed,
      total: moduleLessons.length
    };
  };

  const handleToggleProgress = async () => {
    if (!user || !activeLesson) return;
    setMarkingProgress(true);
    const isCompleted = progress[activeLesson.id];

    if (isCompleted) {
      const { error } = await supabase
        .from("lesson_progress")
        .delete()
        .eq("user_id", user.id)
        .eq("lesson_id", activeLesson.id);
        
      if (error) {
        console.error("Error al borrar progreso:", error);
      } else {
        setProgress(prev => ({ ...prev, [activeLesson.id]: false }));
      }
      setMarkingProgress(false);
    } else {
      const { error } = await supabase
        .from("lesson_progress")
        .upsert(
          { 
            user_id: user.id, 
            lesson_id: activeLesson.id, 
            completed_at: new Date().toISOString() 
          },
          { onConflict: "user_id,lesson_id" }
        );
        
      if (error) {
        console.error("Error al guardar progreso:", error);
        setMarkingProgress(false);
      } else {
        setProgress(prev => ({ ...prev, [activeLesson.id]: true }));
        
        // Find next lesson
        const next = getNextLesson();
        if (next) {
          // Brief loading simulation for smooth transition
          setTimeout(() => {
            setActiveLesson(next);
            setMarkingProgress(false);
          }, 400);
          return;
        } else {
          setCompletedBanner(true);
        }
      }
    }
    setMarkingProgress(false);
  };

  const handleOpenResource = async (url: string) => {
    if (!url) return;
    try {
      const accessUrl = await getFileAccessUrl(supabase, url);
      if (accessUrl) {
        window.open(accessUrl, "_blank");
      }
    } catch (e) {
      console.error("Error opening resource:", e);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="animate-spin text-[#ff6a00] h-12 w-12" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
          <GraduationCap size={40} className="text-gray-500" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-3">Curso no encontrado</h2>
        <p className="text-gray-400">El curso que estás buscando no existe o no está disponible.</p>
        <Link href="/cursos" className="mt-6 px-6 py-3 bg-[#ff6a00] text-white rounded-xl font-bold hover:bg-[#e65c00] transition-colors shadow-lg shadow-[#ff6a00]/20">
          Volver a cursos
        </Link>
      </div>
    );
  }

  // Calculate totals
  const allLessons = Object.values(lessons).flat();
  const totalLessons = allLessons.length;
  const totalDuration = allLessons.reduce((acc, l) => acc + (l.duration_minutes || 0), 0);
  
  const completedCount = Object.values(progress).filter(Boolean).length;
  const progressPercent = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  const formatDuration = (mins: number) => {
    if (!mins) return "0h 0m";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  const badgeText = course.level === "advanced" ? "Avanzado" : course.level === "intermediate" ? "Intermedio" : "Principiante";
  const badgeTone = course.level === "advanced" ? "dark" : "green";

  // Function to render video embed based on URL
  const renderVideo = () => {
    if (!activeLesson || !activeLesson.video_url || !activeLesson.video_url.trim()) {
      return (
        <div className="flex aspect-video items-center justify-center rounded-2xl bg-[#0a0a0a] border border-white/5 text-6xl text-white">
          <Play size={44} className="opacity-20 text-gray-500" />
          <span className="absolute text-sm mt-20 text-gray-500 font-medium">Esta clase todavía no tiene video cargado.</span>
        </div>
      );
    }

    let url = activeLesson.video_url.trim();
    if (url.includes('<iframe') && url.includes('src=')) {
      const match = url.match(/src=["']([^"']+)["']/);
      if (match && match[1]) {
        url = match[1];
      }
    }

    if (
      url.includes('player.mediadelivery.net') ||
      url.includes('iframe.mediadelivery.net') ||
      url.includes('mediadelivery.net/embed')
    ) {
      return (
        <div className="relative w-full overflow-hidden rounded-2xl bg-black border border-white/10 shadow-2xl" style={{ paddingTop: "56.25%" }}>
          <iframe
            src={url}
            loading="lazy"
            className="absolute left-0 top-0 h-full w-full border-0"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen;"
            allowFullScreen
          />
        </div>
      );
    }

    if (url.includes('vimeo.com')) {
      let vimeoId = url.split('/').pop()?.split('?')[0];
      if (url.includes('player.vimeo.com/video/')) {
        vimeoId = url.split('player.vimeo.com/video/')[1].split('?')[0];
      }
      return (
        <div className="aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl">
          <iframe 
            src={`https://player.vimeo.com/video/${vimeoId}`} 
            className="w-full h-full" 
            allow="autoplay; fullscreen; picture-in-picture" 
            allowFullScreen
          ></iframe>
        </div>
      );
    }
    
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      let ytId = '';
      if (url.includes('youtu.be/')) ytId = url.split('youtu.be/')[1].split('?')[0];
      else if (url.includes('v=')) ytId = url.split('v=')[1].split('&')[0];
      
      return (
         <div className="aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl">
          <iframe 
            src={`https://www.youtube.com/embed/${ytId}`} 
            className="w-full h-full" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            allowFullScreen
          ></iframe>
        </div>
      );
    }

    return (
      <div className="aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl">
        <video src={url} controls className="w-full h-full" />
      </div>
    );
  };

  return (
    <div className="pb-12 space-y-6">
      <Link
        href="/cursos"
        className="inline-flex items-center gap-2 text-sm font-semibold text-gray-400 hover:text-white transition-colors"
      >
        <ArrowLeft size={16} /> Volver a cursos
      </Link>

      {/* Header del Curso Premium */}
      <div className="relative overflow-hidden rounded-3xl bg-[#111] border border-white/10 p-8 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-r from-[#ff6a00]/10 via-transparent to-transparent opacity-50" />
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Badge tone={badgeTone} className="shadow-sm">{badgeText}</Badge>
            <span className="flex items-center gap-1.5 bg-white/5 text-gray-300 text-xs font-bold px-3 py-1 rounded-full border border-white/5">
              <Layers size={14} className="text-[#ff6a00]" /> {totalLessons} lecciones
            </span>
            <span className="flex items-center gap-1.5 bg-white/5 text-gray-300 text-xs font-bold px-3 py-1 rounded-full border border-white/5">
              <Clock size={14} className="text-blue-400" /> {formatDuration(totalDuration)}
            </span>
          </div>
          <h1 className="text-3xl font-bold text-white md:text-4xl">{course.title}</h1>
          <p className="mt-3 text-base text-gray-400 leading-relaxed max-w-3xl">{course.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Columna Principal: Video y Detalles */}
        <div className="lg:col-span-2 space-y-6">
          
          {renderVideo()}
          
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Video className="text-[#ff6a00]" size={24} />
                {activeLesson ? activeLesson.title : "Selecciona una clase"}
              </h2>
              {user && activeLesson && (
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <button 
                    onClick={handleToggleProgress}
                    disabled={markingProgress}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                      progress[activeLesson.id] 
                        ? "bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20" 
                        : "bg-[#111] text-gray-300 border border-white/10 hover:border-white/20 hover:bg-white/5"
                    }`}
                  >
                    {markingProgress ? <Loader2 className="animate-spin h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    {progress[activeLesson.id] ? "Completada" : "Marcar completada"}
                  </button>
                  {(() => {
                    const next = getNextLesson();
                    return next ? (
                      <button 
                        onClick={() => setActiveLesson(next)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all bg-[#ff6a00] text-white hover:bg-[#e65c00] shadow-lg shadow-[#ff6a00]/20"
                      >
                        Siguiente clase
                      </button>
                    ) : null;
                  })()}
                </div>
              )}
            </div>

            {completedBanner && (
              <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-4 rounded-xl text-sm font-semibold flex items-center gap-3">
                <span className="text-2xl">🎉</span> ¡Felicidades! Has completado todas las clases disponibles.
              </div>
            )}

            {activeLesson?.description && (
              <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-sm">
                <h3 className="text-sm font-bold text-white mb-2">Acerca de esta clase</h3>
                <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap">
                  {activeLesson.description}
                </p>
              </div>
            )}
          </div>

          {resources[activeLesson?.id] && resources[activeLesson?.id].length > 0 && (
            <div className="border border-white/10 rounded-2xl overflow-hidden shadow-sm">
              <div className="bg-[#111] px-5 py-4 border-b border-white/10">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <File className="text-blue-400" size={18} /> Recursos de la clase
                </h3>
              </div>
              <div className="divide-y divide-white/5 bg-[#0a0a0a]">
                {resources[activeLesson.id].map(res => (
                  <div key={res.id} className="flex items-center justify-between p-5 hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20">
                        <File size={20} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white mb-0.5">{res.title}</p>
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{res.resource_type}</p>
                      </div>
                    </div>
                    <button onClick={() => handleOpenResource(res.url)} className="px-4 py-2 text-xs font-bold text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors">
                      Descargar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Columna Secundaria: Temario, Progreso y Promociones */}
        <div className="space-y-6">
          {user && (
            <div className="p-6 bg-[#111] rounded-2xl border border-white/10 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <GraduationCap size={100} />
              </div>
              <div className="relative z-10">
                <div className="flex justify-between items-end mb-3">
                  <span className="text-sm font-bold text-gray-300">Tu progreso</span>
                  <span className="text-2xl font-black text-[#ff6a00] leading-none">{progressPercent}%</span>
                </div>
                <ProgressBar value={progressPercent} className="h-2.5" />
              </div>
            </div>
          )}

          <div className="bg-[#111] rounded-2xl border border-white/10 shadow-lg overflow-hidden flex flex-col max-h-[800px]">
            <div className="p-5 bg-[#111] border-b border-white/10 flex items-center justify-between z-10 shrink-0">
              <h3 className="text-sm font-bold text-white">Contenido del curso</h3>
              <span className="text-xs font-semibold text-gray-500">{completedCount} de {totalLessons}</span>
            </div>
            
            <div className="divide-y divide-white/5 overflow-y-auto overflow-x-hidden flex-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
              {modules.map((m) => {
                const isOpen = !!openModules[m.id];
                const modProg = getModuleProgress(m.id);
                return (
                  <div key={m.id} className="border-b border-white/5 last:border-0">
                    <button
                      onClick={() => setOpenModules(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                      className={`w-full flex items-center justify-between p-4 transition-colors text-left ${isOpen ? 'bg-white/5' : 'hover:bg-white/5'}`}
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <h4 className="font-bold text-sm text-white truncate group-hover:text-[#ff6a00] transition-colors">
                          Módulo {m.sort_order}: {m.title}
                        </h4>
                        {modProg && (
                          <p className="text-[11px] text-gray-400 font-medium mt-1 flex items-center gap-1.5">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${modProg.completed === modProg.total && modProg.total > 0 ? 'bg-green-500' : 'bg-gray-500'}`}></span>
                            {modProg.completed} / {modProg.total} completadas
                          </p>
                        )}
                      </div>
                      <div className="text-gray-500 shrink-0 p-1 bg-white/5 rounded-full">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                    </button>
                    
                    {isOpen && (
                      <div className="bg-[#0a0a0a] px-3 py-2 space-y-1 shadow-inner">
                        {(lessons[m.id] || []).map((lesson) => {
                          const isActive = activeLesson?.id === lesson.id;
                          const isCompleted = progress[lesson.id];
                          return (
                            <button
                              key={lesson.id}
                              onClick={() => setActiveLesson(lesson)}
                              className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all ${
                                isActive 
                                  ? "bg-[#ff6a00]/10 border border-[#ff6a00]/20 text-[#ff6a00]" 
                                  : "border border-transparent hover:bg-white/5 hover:border-white/10 text-gray-400"
                              }`}
                            >
                              <div className="shrink-0 flex items-center justify-center w-6 h-6">
                                {isCompleted ? (
                                  <CheckCircle2 size={16} className="text-green-500" />
                                ) : isActive ? (
                                  <Play size={16} className="text-[#ff6a00] fill-current" />
                                ) : (
                                  <Circle size={16} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
                                )}
                              </div>
                              <span className={`flex-1 text-sm truncate font-medium ${isActive ? 'text-white' : 'group-hover:text-gray-300'}`}>
                                {lesson.sort_order}. {lesson.title}
                              </span>
                              {lesson.duration_minutes && (
                                <span className={`text-[10px] font-bold shrink-0 px-2 py-1 rounded-md ${isActive ? 'bg-[#ff6a00]/20 text-[#ff6a00]' : 'bg-white/5 text-gray-500 group-hover:bg-white/10'}`}>
                                  {lesson.duration_minutes}m
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {(!lessons[m.id] || lessons[m.id].length === 0) && (
                          <div className="flex flex-col items-center justify-center p-6 text-gray-500">
                            <Clock size={20} className="mb-2 opacity-50" />
                            <p className="text-xs font-semibold uppercase tracking-wider">Próximamente</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {modules.length === 0 && (
                <div className="p-10 flex flex-col items-center justify-center text-gray-500 text-center">
                  <Clock size={32} className="mb-3 opacity-20" />
                  <p className="text-sm font-semibold">Este curso aún no tiene contenido.</p>
                </div>
              )}
            </div>
          </div>

          {/* Stampy Promo Card */}
          <Link href="/stampy" className="block relative overflow-hidden bg-gradient-to-br from-[#ff6a00] to-[#cc5500] rounded-2xl p-6 shadow-xl shadow-[#ff6a00]/20 hover:-translate-y-1 transition-transform group">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 opacity-20">
              <Sparkles size={120} />
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-white/90 mb-2">
                <Sparkles size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Asistente IA</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-2 leading-tight">¿Te trabaste con la clase?</h3>
              <p className="text-white/80 text-sm mb-4 leading-relaxed">
                Pregúntale a Stampy y te ayudará a resolver cualquier duda sobre impresión 3D al instante.
              </p>
              <div className="inline-flex items-center justify-center bg-white text-[#ff6a00] px-4 py-2 rounded-xl text-sm font-bold group-hover:bg-orange-50 transition-colors">
                Preguntar a Stampy <ArrowLeft size={16} className="ml-2 rotate-180" />
              </div>
            </div>
          </Link>

        </div>
      </div>
      {activeLesson && (
        <StampyLessonChat 
          courseTitle={course.title}
          moduleTitle={modules.find(m => m.id === activeLesson.module_id)?.title || ''}
          lesson={activeLesson}
        />
      )}
    </div>
  );
}
