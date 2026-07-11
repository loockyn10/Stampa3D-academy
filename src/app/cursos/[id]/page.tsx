"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play, CheckCircle2, Circle, Loader2, Video, File } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { createClient } from "@/utils/supabase/client";

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
                    progGrouped[p.lesson_id] = p.completed;
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

  const handleToggleProgress = async () => {
    if (!user || !activeLesson) return;
    setMarkingProgress(true);
    const isCompleted = progress[activeLesson.id];

    if (isCompleted) {
      await supabase
        .from("lesson_progress")
        .delete()
        .eq("user_id", user.id)
        .eq("lesson_id", activeLesson.id);
      setProgress(prev => ({ ...prev, [activeLesson.id]: false }));
    } else {
      await supabase
        .from("lesson_progress")
        .upsert([{ user_id: user.id, lesson_id: activeLesson.id, completed: true, completed_at: new Date().toISOString() }]);
      setProgress(prev => ({ ...prev, [activeLesson.id]: true }));
    }
    setMarkingProgress(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin text-orange-500 h-10 w-10" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-900">Curso no encontrado</h2>
        <p className="mt-2 text-sm text-gray-500">El curso que estás buscando no existe o no está disponible.</p>
        <Link href="/cursos" className="mt-4 inline-block text-sm font-semibold text-orange-500 hover:underline">
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
        <div className="flex aspect-video items-center justify-center rounded-2xl bg-gray-900 text-6xl text-white">
          <Play size={44} className="opacity-50" />
          <span className="absolute text-sm mt-20 text-gray-400">Esta clase todavía no tiene video cargado.</span>
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
        <div className="relative w-full overflow-hidden rounded-2xl bg-black shadow-lg" style={{ paddingTop: "56.25%" }}>
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
        <div className="aspect-video rounded-2xl overflow-hidden bg-black">
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
         <div className="aspect-video rounded-2xl overflow-hidden bg-black">
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
      <div className="aspect-video rounded-2xl overflow-hidden bg-black">
        <video src={url} controls className="w-full h-full" />
      </div>
    );
  };

  return (
    <div>
      <Link
        href="/cursos"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft size={14} /> Volver a cursos
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          
          {renderVideo()}
          
          <div className="mt-6 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Video className="text-orange-500" size={24} />
                {activeLesson ? activeLesson.title : "Selecciona una clase"}
              </h2>
              {user && activeLesson && (
                <button 
                  onClick={handleToggleProgress}
                  disabled={markingProgress}
                  className={`shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${progress[activeLesson.id] ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  {markingProgress ? <Loader2 className="animate-spin h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  {progress[activeLesson.id] ? "Completada" : "Marcar completada"}
                </button>
              )}
            </div>

            {activeLesson?.description && (
              <p className="text-sm text-gray-600 bg-gray-50 p-4 rounded-xl border border-gray-100">
                {activeLesson.description}
              </p>
            )}
          </div>

          {resources[activeLesson?.id] && resources[activeLesson?.id].length > 0 && (
            <div className="mt-4 border border-gray-100 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-900">Recursos de la clase</h3>
              </div>
              <div className="divide-y divide-gray-100 bg-white">
                {resources[activeLesson.id].map(res => (
                  <div key={res.id} className="flex items-center justify-between p-4 hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-50 text-blue-600 rounded-md">
                        <File size={16} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{res.title}</p>
                        <p className="text-xs text-gray-500 uppercase">{res.resource_type}</p>
                      </div>
                    </div>
                    <a href={res.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                      Abrir
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 pt-8 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <Badge tone={badgeTone}>{badgeText}</Badge>
              <span className="text-xs text-gray-400 font-medium">
                {totalLessons} lecciones · {formatDuration(totalDuration)}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">{course.title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">{course.description}</p>
          </div>
        </div>

        <div>
          {user && (
            <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex justify-between items-end mb-2">
                <span className="text-sm font-semibold text-gray-900">Tu progreso</span>
                <span className="text-sm font-bold text-orange-500">{progressPercent}%</span>
              </div>
              <ProgressBar value={progressPercent} />
            </div>
          )}

          <Card className="p-0 overflow-hidden">
            <div className="p-4 bg-gray-50 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-900">Contenido del curso</p>
            </div>
            
            <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
              {modules.map((m) => (
                <div key={m.id} className="p-4">
                  <h3 className="font-semibold text-sm text-gray-900 mb-3">{m.sort_order}. {m.title}</h3>
                  <div className="space-y-1 pl-2">
                    {(lessons[m.id] || []).map((lesson) => {
                      const isActive = activeLesson?.id === lesson.id;
                      const isCompleted = progress[lesson.id];
                      return (
                        <button
                          key={lesson.id}
                          onClick={() => setActiveLesson(lesson)}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                            isActive ? "bg-orange-50 text-orange-700 font-medium" : "hover:bg-gray-50 text-gray-600"
                          }`}
                        >
                          {isCompleted ? (
                            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                          ) : isActive ? (
                            <Play size={14} className="text-orange-500 shrink-0" />
                          ) : (
                            <Circle size={14} className="text-gray-300 shrink-0" />
                          )}
                          <span className="flex-1 truncate">
                            {lesson.sort_order}. {lesson.title}
                          </span>
                          <span className="text-[10px] text-gray-400 shrink-0">
                            {lesson.duration_minutes}m
                          </span>
                        </button>
                      );
                    })}
                    {(!lessons[m.id] || lessons[m.id].length === 0) && (
                      <p className="text-xs text-gray-400 italic px-3">No hay clases aún.</p>
                    )}
                  </div>
                </div>
              ))}
              {modules.length === 0 && (
                <div className="p-6 text-center text-gray-500 text-sm">
                  Próximamente...
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
