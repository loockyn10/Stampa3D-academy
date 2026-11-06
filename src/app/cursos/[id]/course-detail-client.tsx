"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Play, Eye, CheckCircle2, ChevronLeft, Circle, Loader2, RefreshCw, Video, File, ChevronDown, ChevronRight, GraduationCap, Clock, Layers, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { createClient } from "@/utils/supabase/client";
import { getCourseLevelLabel, getCourseLevelClasses } from "@/lib/course-style";
import { getFileAccessUrl } from "@/lib/storage";
import { StampyLessonChat } from "@/components/stampy/StampyLessonChat";
import { useFeatureVisibility } from "@/components/features/feature-flags-provider";
import { getCourseKindUi } from "@/lib/academy/course-kind";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { getLessonPlaybackAction, setLessonProgressAction, type LessonPlaybackResult } from "@/app/cursos/actions";
import { lessonNeighbors, orderLessons, pickStartLesson } from "@/lib/academy/lesson-navigation";
import { COURSE_VISIBILITY_META, type CourseVisibility } from "@/lib/academy/visibility";

interface CourseDetailClientProps {
  /** Id real del curso, ya resuelto y autorizado por el servidor (page.tsx). */
  courseId: string;
  /** Segmento de URL original (slug o id); solo alimenta el contexto de pantalla de Stampy. */
  routeId: string;
  /** Vista previa de administración: el estado (no publicado) con el que se ve el curso. */
  previewVisibility?: CourseVisibility | null;
}

export function CourseDetailClient({ courseId, routeId: id, previewVisibility = null }: CourseDetailClientProps) {
  const stampyVisible = useFeatureVisibility().isFeatureVisible("stampy");
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
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<{ lessonId: string; result: LessonPlaybackResult | null } | null>(null);
  const [playerKey, setPlayerKey] = useState(0);
  const playerRef = useRef<HTMLDivElement>(null);

  const [supabase] = useState(() => createClient());

  useEffect(() => {
    const fetchCourseData = async () => {
      setLoading(true);
      setLoadError(false);
      // Any failed query is an error (retry), never an empty course.
      const failed = (error: unknown) => Boolean(error);

      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      // El servidor (page.tsx) ya resolvió y autorizó el curso. Fuera de la vista previa de administración se
      // sigue exigiendo `published`; además la base lo refuerza con policies RESTRICTIVE.
      let query = supabase.from("courses").select("*, instructors(name)").eq("id", courseId);
      if (!previewVisibility) query = query.eq("status", "published");

      const { data: courseData, error: courseError } = await query.maybeSingle();
      if (failed(courseError)) {
        setLoadError(true);
        setLoading(false);
        return;
      }

      if (courseData) {
        setCourse(courseData);

        const { data: modulesData, error: modulesError } = await supabase
          .from("course_modules")
          .select("*")
          .eq("course_id", courseData.id)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });
        if (failed(modulesError)) {
          setLoadError(true);
          setLoading(false);
          return;
        }

        if (modulesData) {
          setModules(modulesData);

          const { data: lessonsData, error: lessonsError } = await supabase
            .from("lessons")
            .select("*")
            .in("module_id", modulesData.map((m) => m.id))
            .eq("is_active", true)
            .order("sort_order", { ascending: true });
          if (failed(lessonsError)) {
            setLoadError(true);
            setLoading(false);
            return;
          }

          if (lessonsData) {
            const grouped: Record<string, any[]> = {};
            lessonsData.forEach((l) => {
              if (!grouped[l.module_id]) grouped[l.module_id] = [];
              grouped[l.module_id].push(l);
            });
            setLessons(grouped);
            const completedIds = new Set<string>();

            // Fetch resources
            const lessonIds = lessonsData.map((l) => l.id);
            if (lessonIds.length > 0) {
              const { data: resourcesData, error: resourcesError } = await supabase
                .from("lesson_resources")
                .select("*")
                .in("lesson_id", lessonIds)
                .eq("is_active", true)
                .order("sort_order", { ascending: true });
              if (failed(resourcesError)) {
                setLoadError(true);
                setLoading(false);
                return;
              }

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
                const { data: progressData, error: progressLoadError } = await supabase
                  .from("lesson_progress")
                  .select("lesson_id")
                  .eq("user_id", user.id)
                  .in("lesson_id", lessonIds);
                if (failed(progressLoadError)) {
                  setLoadError(true);
                  setLoading(false);
                  return;
                }

                if (progressData) {
                  const progGrouped: Record<string, boolean> = {};
                  progressData.forEach(p => {
                    progGrouped[p.lesson_id] = true;
                    completedIds.add(p.lesson_id);
                  });
                  setProgress(progGrouped);
                }
              }
            }

            // Resume: the lesson in the URL, else the first one not completed, else the first one.
            const requested = new URLSearchParams(window.location.search).get("clase");
            const start = pickStartLesson(orderLessons(modulesData, grouped), completedIds, requested);
            setActiveLesson(start);
            if (start) setOpenModules((prev) => ({ ...prev, [start.module_id]: true }));
          }
        }
      }
      setLoading(false);
    };

    fetchCourseData();
  }, [courseId, previewVisibility, supabase, reloadToken]);

  const activeLessonId: string | null = activeLesson?.id ?? null;

  // Keep the lesson in the URL (refresh / back / share keep the place) and open its module.
  useEffect(() => {
    if (!activeLessonId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("clase") !== activeLessonId) {
      url.searchParams.set("clase", activeLessonId);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, [activeLessonId]);

  // Playback URL from the server (same gate as the progress; Bunny embeds signed when configured).
  useEffect(() => {
    if (!activeLessonId) return;
    let active = true;
    getLessonPlaybackAction(activeLessonId)
      .then((result) => {
        if (active) setPlayback({ lessonId: activeLessonId, result });
      })
      .catch(() => {
        if (active) setPlayback({ lessonId: activeLessonId, result: { ok: false, error: "No pudimos cargar el video. Revisá tu conexión." } });
      });
    return () => {
      active = false;
    };
  }, [activeLessonId, playerKey]);

  const orderedLessons = useMemo(() => orderLessons(modules, lessons), [lessons, modules]);
  const neighbors = useMemo(() => lessonNeighbors(orderedLessons, activeLessonId), [orderedLessons, activeLessonId]);

  /** Opens a lesson: resets per-lesson messages, opens its module and, on phones, brings the player into view. */
  const openLesson = useCallback((lesson: { id: string; module_id: string }, scroll = false) => {
    setActiveLesson(lesson);
    setCompletedBanner(false);
    setProgressError(null);
    setResourceError(null);
    setOpenModules((prev) => ({ ...prev, [lesson.module_id]: true }));
    if (scroll) playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);


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
    setProgressError(null);
    const isCompleted = progress[activeLesson.id];

    // El progreso se escribe desde el servidor: valida sesión, Academia habilitada y que el curso esté publicado.
    if (isCompleted) {
      const result = await setLessonProgressAction(activeLesson.id, false);

      if (!result.success) {
        setProgressError(result.error);
      } else {
        setProgress(prev => ({ ...prev, [activeLesson.id]: false }));
      }
      setMarkingProgress(false);
    } else {
      const result = await setLessonProgressAction(activeLesson.id, true);

      if (!result.success) {
        setProgressError(result.error);
        setMarkingProgress(false);
      } else {
        setProgress(prev => ({ ...prev, [activeLesson.id]: true }));

        const next = neighbors.next;
        if (next) {
          // Brief pause so the "Completada" state is visible before moving on.
          setTimeout(() => {
            openLesson(next, true);
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
    setResourceError(null);
    // Open the tab synchronously (popup blockers allow it only inside the click) and point it to the file after.
    const tab = window.open("", "_blank");
    try {
      const accessUrl = await getFileAccessUrl(supabase, url);
      if (!accessUrl) throw new Error("no_url");
      if (tab) {
        tab.opener = null;
        tab.location.href = accessUrl;
      } else {
        window.location.assign(accessUrl);
      }
    } catch {
      tab?.close();
      setResourceError("No pudimos abrir el recurso. Probá de nuevo en unos minutos.");
    }
  };

  const stampyScreenContext = useMemo<StampyScreenContext>(() => {
    const isWorkshop = course?.course_kind === "workshop";
    const contentType = isWorkshop ? "workshop" : "course";
    const completedLessons = orderedLessons.filter((lesson) => progress[lesson.id]).length;
    const activeModule = activeLesson
      ? modules.find((module) => module.id === activeLesson.module_id)
      : null;
    const visibleOutline: NonNullable<StampyScreenContext["visibleEntities"]> = [];
    for (const module of [...modules].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))) {
      if (visibleOutline.length >= 20) break;
      const moduleLessons = [...(lessons[module.id] || [])]
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      const completedInModule = moduleLessons.filter((lesson) => progress[lesson.id]).length;
      visibleOutline.push({
        type: "course_module",
        id: String(module.id),
        name: module.title,
        position: visibleOutline.length + 1,
        facts: [
          { label: "Lecciones del módulo", value: moduleLessons.length },
          { label: "Lecciones completadas del módulo", value: completedInModule },
          { label: "Módulo desplegado", value: Boolean(openModules[module.id]) },
        ],
      });
      if (!openModules[module.id]) continue;
      for (const lesson of moduleLessons) {
        if (visibleOutline.length >= 20) break;
        visibleOutline.push({
          type: "lesson",
          id: String(lesson.id),
          name: lesson.title,
          position: visibleOutline.length + 1,
          facts: [
            { label: "Módulo", value: String(module.title) },
            { label: "Completada", value: Boolean(progress[lesson.id]) },
            ...(lesson.duration_minutes
              ? [{ label: "Duración en minutos", value: Number(lesson.duration_minutes) }]
              : []),
          ],
        });
      }
    }

    return {
      page: {
        section: isWorkshop ? "workshops" : "courses",
        route: `/cursos/${id}`,
        title: course?.title ?? (isWorkshop ? "Detalle del taller" : "Detalle del curso"),
      },
      mode: activeLesson ? "lesson" : "overview",
      selectedEntity: activeLesson ? {
        type: "lesson",
        id: String(activeLesson.id),
        name: activeLesson.title,
        facts: [
          ...(activeModule?.title ? [{ label: "Módulo visible", value: String(activeModule.title) }] : []),
          { label: "Completada", value: Boolean(progress[activeLesson.id]) },
          ...(activeLesson.duration_minutes
            ? [{ label: "Duración visible en minutos", value: Number(activeLesson.duration_minutes) }]
            : []),
        ],
      } : course ? {
        type: contentType,
        id: String(course.id),
        name: course.title,
      } : null,
      visibleEntities: visibleOutline,
      pageData: {
        kind: "pageFacts",
        facts: [
          { label: "Tipo de contenido", value: isWorkshop ? "Taller" : "Curso" },
          ...(course?.title ? [{ label: isWorkshop ? "Taller actual" : "Curso actual", value: String(course.title) }] : []),
          ...(course?.description ? [{ label: "Descripción breve visible", value: String(course.description) }] : []),
          ...(course?.level ? [{ label: "Nivel visible", value: String(course.level) }] : []),
          { label: "Módulos visibles", value: modules.length },
          { label: "Lecciones visibles", value: orderedLessons.length },
          { label: "Lecciones completadas", value: completedLessons },
          { label: "Progreso visible en porcentaje", value: orderedLessons.length > 0
            ? Math.round((completedLessons / orderedLessons.length) * 100)
            : 0 },
          ...(activeModule?.title ? [{ label: "Módulo actualmente abierto", value: String(activeModule.title) }] : []),
        ],
      },
      uiState: { loading },
    };
  }, [activeLesson, course, id, lessons, loading, modules, openModules, orderedLessons, progress]);

  usePublishStampyScreenContext(stampyScreenContext);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="animate-spin text-stampa-accent h-12 w-12" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center" role="alert">
        <AlertCircle size={40} className="mb-4 text-red-500" aria-hidden="true" />
        <h2 className="mb-2 text-2xl font-bold text-fg">No pudimos cargar el curso</h2>
        <p className="max-w-md text-gray-400">Revisá tu conexión. Tu progreso está guardado.</p>
        <button
          type="button"
          onClick={() => setReloadToken((value) => value + 1)}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-stampa-orange px-6 py-3 font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover"
        >
          <RefreshCw size={16} aria-hidden="true" /> Reintentar
        </button>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-20 h-20 bg-fg/5 rounded-full flex items-center justify-center mb-6">
          <GraduationCap size={40} className="text-gray-500" />
        </div>
        <h2 className="text-2xl font-bold text-fg mb-3">Curso no encontrado</h2>
        <p className="text-gray-400">El curso que estás buscando no existe o no está disponible.</p>
        <Link href="/academia" className="mt-6 px-6 py-3 bg-stampa-orange text-white rounded-xl font-bold hover:bg-[#e65c00] transition-colors shadow-lg shadow-[#ff6a00]/20">
          Volver a Academia
        </Link>
      </div>
    );
  }

  // Calculate totals
  const allLessons = orderedLessons;
  const totalLessons = allLessons.length;
  const totalDuration = allLessons.reduce((acc, l) => acc + (l.duration_minutes || 0), 0);

  const completedCount = allLessons.filter((lesson) => progress[lesson.id]).length;
  const progressPercent = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;
  const courseKindUi = getCourseKindUi(course.course_kind);

  const formatDuration = (mins: number) => {
    if (!mins) return "0h 0m";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  // Player: the URL comes from the server (getLessonPlaybackAction), never straight from the database row.
  const renderVideo = () => {
    const frame = "relative w-full overflow-hidden rounded-2xl border border-stampa-border bg-stampa-bg shadow-2xl";
    const placeholder = (content: React.ReactNode) => (
      <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-2xl border border-stampa-border bg-stampa-bg-soft px-6 text-center">
        {content}
      </div>
    );

    if (!activeLesson) {
      return placeholder(
        <>
          <Play size={40} className="text-gray-500 opacity-40" aria-hidden="true" />
          <p className="text-sm font-medium text-gray-500">{totalLessons === 0 ? "Las clases de este curso se publican pronto." : "Elegí una clase para empezar."}</p>
        </>,
      );
    }

    const current = playback && playback.lessonId === activeLesson.id ? playback.result : null;
    if (!current) {
      return placeholder(
        <span role="status" className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin text-stampa-accent" aria-hidden="true" /> Cargando la clase…
        </span>,
      );
    }

    if (!current.ok) {
      return placeholder(
        <>
          <AlertCircle size={32} className="text-red-400" aria-hidden="true" />
          <p role="alert" className="text-sm font-medium text-gray-300">{current.error}</p>
          <button
            type="button"
            onClick={() => setPlayerKey((value) => value + 1)}
            className="inline-flex items-center gap-2 rounded-xl border border-stampa-border px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-fg/5"
          >
            <RefreshCw size={14} aria-hidden="true" /> Reintentar
          </button>
        </>,
      );
    }

    if (current.provider === "none") {
      return placeholder(
        <>
          <Play size={40} className="text-gray-500 opacity-40" aria-hidden="true" />
          <p className="text-sm font-medium text-gray-500">Esta clase no tiene video. Revisá la descripción y los recursos.</p>
        </>,
      );
    }

    if (current.provider === "file") {
      return (
        <div className={`${frame} aspect-video`}>
          <video key={playerKey} src={current.src} controls controlsList="nodownload" preload="metadata" className="h-full w-full" />
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <div className={frame} style={{ paddingTop: "56.25%" }}>
          <iframe
            key={`${activeLesson.id}-${playerKey}`}
            src={current.src}
            title={`Video: ${activeLesson.title}`}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute left-0 top-0 h-full w-full border-0"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
        <p className="text-xs text-gray-500">
          ¿El video no carga?{" "}
          <button type="button" onClick={() => setPlayerKey((value) => value + 1)} className="font-semibold text-stampa-accent hover:underline">
            Recargar el video
          </button>
        </p>
      </div>
    );
  };

  return (
    <div className="pb-12 space-y-6">
      <Link
        href={courseKindUi.publicListHref}
        className="inline-flex items-center gap-2 text-sm font-semibold text-gray-400 hover:text-fg transition-colors"
      >
        <ArrowLeft size={16} /> Volver a {courseKindUi.plural}
      </Link>

      {previewVisibility && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          <Eye size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-bold">Vista previa de administración.</span>{" "}
            Este {courseKindUi.singular} está «{COURSE_VISIBILITY_META[previewVisibility].label}»: los alumnos no pueden
            {previewVisibility === "hidden" ? " verlo ni acceder a él." : " entrar a sus clases."}
          </p>
        </div>
      )}

      {/* Header del Curso Premium */}
      <div className="relative overflow-hidden rounded-3xl bg-stampa-surface border border-stampa-border p-5 shadow-2xl sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-r from-[#ff6a00]/20 via-transparent to-transparent opacity-50" />
        <div className="relative z-10">
          <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4 sm:gap-3">
            <span className={`${getCourseLevelClasses(course)} shadow-sm`}>
              {getCourseLevelLabel(course)}
            </span>
            <span className="flex items-center gap-1.5 bg-fg/5 text-gray-300 text-xs font-bold px-3 py-1 rounded-full border border-stampa-border">
              <Layers size={14} className="text-stampa-accent" /> {totalLessons} lecciones
            </span>
            <span className="flex items-center gap-1.5 bg-fg/5 text-gray-300 text-xs font-bold px-3 py-1 rounded-full border border-stampa-border">
              <Clock size={14} className="text-blue-400" /> {formatDuration(totalDuration)}
            </span>
          </div>
          <h1 className="text-2xl font-bold leading-tight text-fg break-words sm:text-3xl md:text-4xl">{course.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400 sm:mt-3 sm:text-base">{course.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Columna Principal: Video y Detalles */}
        <div className="lg:col-span-2 space-y-6">

          <div ref={playerRef} className="scroll-mt-app">{renderVideo()}</div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start sm:gap-4">
              <h2 className="flex min-w-0 items-start gap-2 text-lg font-bold leading-snug text-fg break-words sm:text-xl">
                <Video className="mt-0.5 shrink-0 text-stampa-accent" size={22} />
                {activeLesson ? activeLesson.title : totalLessons === 0 ? "Este curso todavía no tiene clases" : "Elegí una clase"}
              </h2>
              {user && activeLesson && (
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:shrink-0">
                  <button
                    onClick={handleToggleProgress}
                    disabled={markingProgress}
                    className={`col-span-2 inline-flex min-h-11 items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all sm:col-span-1 ${progress[activeLesson.id]
                        ? "bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20"
                        : "bg-stampa-surface text-gray-300 border border-stampa-border hover:border-fg/20 hover:bg-fg/5"
                      }`}
                  >
                    {markingProgress ? <Loader2 className="animate-spin h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    {progress[activeLesson.id] ? "Completada" : "Marcar completada"}
                  </button>
                  {neighbors.previous && (
                    <button
                      type="button"
                      onClick={() => openLesson(neighbors.previous, true)}
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all bg-stampa-surface text-gray-300 border border-stampa-border hover:border-fg/20 hover:bg-fg/5"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Anterior
                    </button>
                  )}
                  {neighbors.next && (
                    <button
                      type="button"
                      onClick={() => openLesson(neighbors.next, true)}
                      className={`inline-flex min-h-11 items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all bg-stampa-orange text-neutral-950 hover:bg-stampa-orange-hover shadow-lg shadow-[#ff6a00]/20 ${neighbors.previous ? "" : "col-span-2 sm:col-span-1"}`}
                    >
                      Siguiente clase <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {activeLesson && totalLessons > 0 && (
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                <span>Clase {neighbors.position} de {totalLessons}</span>
                <a href="#contenido-del-curso" className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-stampa-accent hover:underline lg:hidden">Ver todas las clases</a>
                <span className="hidden lg:inline">{progress[activeLesson.id] ? "completada" : "pendiente"}</span>
              </p>
            )}

            {progressError && (
              <p role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> {progressError}
              </p>
            )}

            {completedBanner && (
              <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-4 rounded-xl text-sm font-semibold flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">🎉</span> ¡Completaste todas las clases disponibles!
              </div>
            )}

            {activeLesson?.description && (
              <div className="bg-stampa-surface p-4 rounded-2xl border border-stampa-border shadow-sm sm:p-6">
                <h3 className="text-sm font-bold text-fg mb-2">Acerca de esta clase</h3>
                <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap">
                  {activeLesson.description}
                </p>
              </div>
            )}
          </div>

          {resources[activeLesson?.id] && resources[activeLesson?.id].length > 0 && (
            <div className="border border-stampa-border rounded-2xl overflow-hidden shadow-sm">
              <div className="bg-stampa-surface px-5 py-4 border-b border-stampa-border">
                <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                  <File className="text-blue-400" size={18} /> Recursos de la clase
                </h3>
              </div>
              {resourceError && (
                <p role="alert" className="border-b border-stampa-border bg-red-500/10 px-5 py-3 text-sm text-red-400">{resourceError}</p>
              )}
              <div className="divide-y divide-fg/5 bg-stampa-bg-soft">
                {resources[activeLesson.id].map(res => (
                  <div key={res.id} className="flex items-center justify-between gap-3 p-4 hover:bg-fg/5 transition-colors sm:p-5">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                      <div className="shrink-0 p-2.5 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20">
                        <File size={20} />
                      </div>
                      <div className="min-w-0">
                        <p className="mb-0.5 text-sm font-bold text-fg break-words">{res.title}</p>
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{res.resource_type}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => handleOpenResource(res.url)} className="inline-flex min-h-11 shrink-0 items-center px-4 py-2 text-xs font-bold text-fg bg-fg/5 hover:bg-fg/10 border border-stampa-border rounded-xl transition-colors">
                      Abrir
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
            <div className="p-6 bg-stampa-surface rounded-2xl border border-stampa-border shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <GraduationCap size={100} />
              </div>
              <div className="relative z-10">
                <div className="flex justify-between items-end mb-3">
                  <span className="text-sm font-bold text-gray-300">Tu progreso</span>
                  <span className="text-2xl font-black text-stampa-accent leading-none">{progressPercent}%</span>
                </div>
                <ProgressBar value={progressPercent} className="h-2.5" />
              </div>
            </div>
          )}

          <div id="contenido-del-curso" className="scroll-mt-app bg-stampa-surface rounded-2xl border border-stampa-border shadow-lg overflow-hidden flex flex-col lg:max-h-[800px]">
            <div className="p-5 bg-stampa-surface border-b border-stampa-border flex items-center justify-between z-10 shrink-0">
              <h3 className="text-sm font-bold text-fg">Contenido del curso</h3>
              <span className="text-xs font-semibold text-gray-500">{completedCount} de {totalLessons}</span>
            </div>

            <div className="divide-y divide-fg/5 overflow-y-auto overflow-x-hidden flex-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
              {modules.map((m, moduleIndex) => {
                const isOpen = !!openModules[m.id];
                const modProg = getModuleProgress(m.id);
                return (
                  <div key={m.id} className="border-b border-stampa-border last:border-0">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenModules(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                      className={`flex min-h-14 w-full items-center justify-between p-4 text-left transition-colors ${isOpen ? 'bg-fg/5' : 'hover:bg-fg/5'}`}
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <h4 className="line-clamp-2 break-words text-sm font-bold text-fg">
                          Módulo {moduleIndex + 1}: {m.title}
                        </h4>
                        {modProg && (
                          <p className="text-[11px] text-gray-400 font-medium mt-1 flex items-center gap-1.5">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${modProg.completed === modProg.total && modProg.total > 0 ? 'bg-green-500' : 'bg-gray-500'}`}></span>
                            {modProg.completed} / {modProg.total} completadas
                          </p>
                        )}
                      </div>
                      <div className="text-gray-500 shrink-0 p-1 bg-fg/5 rounded-full">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="bg-stampa-bg-soft px-3 py-2 space-y-1 shadow-inner">
                        {(lessons[m.id] || []).map((lesson, lessonIndex) => {
                          const isActive = activeLesson?.id === lesson.id;
                          const isCompleted = progress[lesson.id];
                          return (
                            <button
                              key={lesson.id}
                              type="button"
                              aria-current={isActive ? "true" : undefined}
                              onClick={() => openLesson(lesson, true)}
                              className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all ${isActive
                                  ? "bg-stampa-orange/10 border border-[#ff6a00]/20 text-stampa-accent"
                                  : "border border-transparent hover:bg-fg/5 hover:border-stampa-border text-gray-400"
                                }`}
                            >
                              <div className="shrink-0 flex items-center justify-center w-6 h-6">
                                {isCompleted ? (
                                  <CheckCircle2 size={16} className="text-green-500" />
                                ) : isActive ? (
                                  <Play size={16} className="text-stampa-accent fill-current" />
                                ) : (
                                  <Circle size={16} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
                                )}
                              </div>
                              <span className={`min-w-0 flex-1 text-sm leading-snug line-clamp-2 break-words font-medium ${isActive ? 'text-fg' : 'group-hover:text-gray-300'}`}>
                                {lessonIndex + 1}. {lesson.title}
                              </span>
                              {lesson.duration_minutes && (
                                <span className={`text-[10px] font-bold shrink-0 px-2 py-1 rounded-md ${isActive ? 'bg-stampa-orange/20 text-stampa-accent' : 'bg-fg/5 text-gray-500 group-hover:bg-fg/10'}`}>
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
          {stampyVisible && <Link href="/stampy" className="block relative overflow-hidden bg-gradient-to-br from-cyan-950/40 via-violet-950/40 to-neutral-900 border border-cyan-500/20 rounded-2xl p-6 shadow-xl shadow-cyan-500/5 hover:-translate-y-1 transition-transform group">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 opacity-15 text-cyan-400">
              <Sparkles size={120} />
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-cyan-300 mb-2">
                <Sparkles size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Asistente IA</span>
              </div>
              <h3 className="text-lg font-bold text-fg mb-2 leading-tight">¿Te trabaste con la clase?</h3>
              <p className="text-fg/80 text-sm mb-4 leading-relaxed">
                Pregúntale a Stampy y te ayudará a resolver cualquier duda sobre impresión 3D al instante.
              </p>
              <div className="inline-flex items-center justify-center bg-gradient-to-r from-cyan-500 to-violet-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:brightness-110 transition-all">
                Preguntar a Stampy <ArrowLeft size={16} className="ml-2 rotate-180" />
              </div>
            </div>
          </Link>}

        </div>
      </div>
      {activeLesson && stampyVisible && (
        <StampyLessonChat
          key={activeLesson.id}
          courseTitle={course.title}
          moduleTitle={modules.find(m => m.id === activeLesson.module_id)?.title || ''}
          lesson={activeLesson}
        />
      )}
    </div>
  );
}
