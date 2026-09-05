"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Download, FileText, Play, Calculator, ChevronRight, CalendarDays, Gift, Boxes, Loader2, Bot, ArrowRight, Tag, Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SectionTitle } from "@/components/ui/section-title";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/utils/supabase/client";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";


export default function InicioPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [userFirstName, setUserFirstName] = useState("Usuario");
  const [coursesCount, setCoursesCount] = useState(0);
  const [downloadsCount, setDownloadsCount] = useState(0);
  const [budgetsCount, setBudgetsCount] = useState(0);

  const [continuingCourse, setContinuingCourse] = useState<any>(null);
  const [upcomingRaffle, setUpcomingRaffle] = useState<any>(null);
  const [latestStls, setLatestStls] = useState<any[]>([]);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        // 1. User Name
        const { data: profile } = await supabase.from("profiles").select("display_name, full_name").eq("id", user.id).single();
        const name = profile?.display_name || profile?.full_name || "Usuario";
        setUserFirstName(name.split(" ")[0]);

        // 2. Counts
        // Budgets
        const { count: bCount } = await supabase.from("budgets").select("*", { count: "exact", head: true }).eq("user_id", user.id);
        setBudgetsCount(bCount || 0);

        // Downloads
        const { count: dCount } = await supabase.from("stl_downloads").select("*", { count: "exact", head: true }).eq("user_id", user.id);
        setDownloadsCount(dCount || 0);

        // Courses Progress
        const { data: progressData } = await supabase
          .from("lesson_progress")
          .select(`
            lessons (
              id,
              module_id,
              course_modules (
                id,
                course_id,
                courses (
                  id,
                  title,
                  thumbnail_url,
                  slug
                )
              )
            )
          `)
          .eq("user_id", user.id);

        let uniqueCourses = new Map<string, any>();
        if (progressData) {
          progressData.forEach((p: any) => {
            const course = p.lessons?.course_modules?.courses;
            if (course) {
              uniqueCourses.set(course.id, course);
            }
          });
        }
        setCoursesCount(uniqueCourses.size);

        if (uniqueCourses.size > 0) {
          const firstCourseId = Array.from(uniqueCourses.keys())[0];
          const c = uniqueCourses.get(firstCourseId);

          const { count: totalLessons } = await supabase
            .from("lessons")
            .select("*, course_modules!inner(course_id)", { count: "exact", head: true })
            .eq("course_modules.course_id", firstCourseId)
            .eq("is_published", true);

          const completedCount = progressData?.filter((p: any) => p.lessons?.course_modules?.courses?.id === firstCourseId).length || 0;

          setContinuingCourse({
            id: c.slug || c.id,
            title: c.title,
            thumbnail_url: c.thumbnail_url,
            progress: totalLessons ? Math.round((completedCount / totalLessons) * 100) : 0,
            completedLessons: completedCount,
            totalLessons: totalLessons || 0
          });
        }

        // 3. Upcoming Raffle
        const { data: raffles } = await supabase
          .from("raffles")
          .select(`*, raffle_prizes(*)`)
          .eq("status", "active")
          .eq("is_active", true)
          .order("draw_date", { ascending: true })
          .limit(1);

        if (raffles && raffles.length > 0) {
          setUpcomingRaffle(raffles[0]);
        }

        // 4. Latest STLs
        const { data: stls } = await supabase
          .from("stl_variants")
          .select(`*, stl_models!inner(name, thumbnail_url)`)
          .eq("is_active", true)
          .eq("stl_models.is_active", true)
          .order("created_at", { ascending: false })
          .limit(4);

        if (stls) {
          setLatestStls(stls);
        }
      } catch (e) {
        console.error("Error loading dashboard data:", e);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  const stampyScreenContext = useMemo<StampyScreenContext>(() => {
    const visibleEntities: NonNullable<StampyScreenContext["visibleEntities"]> = [];
    if (continuingCourse) {
      visibleEntities.push({
        type: "course_in_progress",
        id: String(continuingCourse.id),
        name: continuingCourse.title,
        position: visibleEntities.length + 1,
        facts: [
          { label: "Progreso visible en porcentaje", value: Number(continuingCourse.progress || 0) },
          { label: "Lecciones completadas", value: Number(continuingCourse.completedLessons || 0) },
          { label: "Lecciones totales", value: Number(continuingCourse.totalLessons || 0) },
        ],
      });
    }
    if (upcomingRaffle) {
      visibleEntities.push({
        type: "upcoming_raffle",
        id: String(upcomingRaffle.id),
        name: upcomingRaffle.title,
        position: visibleEntities.length + 1,
        facts: [
          ...(upcomingRaffle.draw_date
            ? [{ label: "Fecha visible del sorteo", value: new Date(upcomingRaffle.draw_date).toLocaleDateString("es-AR") }]
            : []),
          ...(upcomingRaffle.raffle_prizes?.[0]?.name
            ? [{ label: "Premio principal visible", value: String(upcomingRaffle.raffle_prizes[0].name) }]
            : []),
        ],
      });
    }

    return {
      page: { section: "dashboard", route: "/", title: "Inicio" },
      mode: "overview",
      visibleEntities,
      pageData: {
        kind: "pageFacts",
        facts: [
          { label: "Presupuestos creados", value: budgetsCount },
          { label: "STL descargados", value: downloadsCount },
          { label: "Cursos iniciados", value: coursesCount },
          { label: "Hay un curso para continuar visible", value: Boolean(continuingCourse) },
          { label: "Hay un sorteo próximo visible", value: Boolean(upcomingRaffle) },
        ],
      },
      uiState: { loading },
    };
  }, [budgetsCount, continuingCourse, coursesCount, downloadsCount, loading, upcomingRaffle]);

  usePublishStampyScreenContext(stampyScreenContext);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-stampa-orange" />
      </div>
    );
  }

  const quickAccess = [
    {
      title: "Preguntarle a Stampy",
      desc: "Contale tu problema y te guía hacia la clase o herramienta correcta.",
      icon: Bot,
      href: "/stampy",
      color: "text-purple-400"
    },
    {
      title: "Calcular precio",
      desc: "Calculá cuánto cobrar usando material, tiempo y margen.",
      icon: Calculator,
      href: "/calculadora",
      color: "text-green-400"
    },
    {
      title: "Crear presupuesto",
      desc: "Armá un presupuesto profesional para enviar a un cliente.",
      icon: FileText,
      href: "/presupuestos",
      color: "text-blue-400"
    },
    {
      title: "Revisar stock",
      desc: "Controlá filamentos, productos terminados y movimientos.",
      icon: Layers,
      href: "/stock",
      color: "text-yellow-400"
    },
    {
      title: "Cargar producto",
      desc: "Guardá piezas recurrentes con costos y precios.",
      icon: Tag,
      href: "/productos",
      color: "text-pink-400"
    },
    {
      title: "Ver cursos",
      desc: "Seguí avanzando con las rutas de aprendizaje.",
      icon: BookOpen,
      href: "/cursos",
      color: "text-orange-400"
    }
  ];

  return (
    <div className="space-y-10 pb-10">
      {/* 1. Hero Interno */}
      <div className="relative overflow-hidden rounded-3xl bg-stampa-surface border border-stampa-border p-8 sm:p-10 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-[#ff6a00]/20 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-2xl">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-stampa-orange uppercase tracking-wider">Hola, {userFirstName}</p>

          </div>
          <h1 className="text-3xl font-bold text-white sm:text-4xl">¿Qué querés resolver hoy?</h1>
          <p className="mt-3 text-base text-gray-400">
            Seguí aprendiendo, organizá tu taller y encontrá rápido lo que necesitás.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <PrimaryButton href="/stampy" className="px-6 py-3 text-base">
              <Bot size={18} className="mr-2" /> Preguntarle a Stampy
            </PrimaryButton>
            {continuingCourse ? (
              <GhostButton href={`/cursos/${continuingCourse.id}`} className="px-6 py-3 text-base bg-white/5 border border-stampa-border text-white hover:bg-white/10">
                <Play size={18} className="mr-2" /> Continuar curso
              </GhostButton>
            ) : (
              <GhostButton href="/cursos" className="px-6 py-3 text-base bg-white/5 border border-stampa-border text-white hover:bg-white/10">
                <BookOpen size={18} className="mr-2" /> Explorar cursos
              </GhostButton>
            )}
          </div>
        </div>
      </div>

      {/* 2. Accesos Rápidos */}
      <div>
        <SectionTitle title="Accesos rápidos" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quickAccess.map((item, i) => (
            <Link key={i} href={item.href}>
              <Card className="group h-full p-5 bg-stampa-surface border-stampa-border hover:border-[#ff6a00]/50 hover:bg-white/5 transition-all cursor-pointer flex flex-col justify-between">
                <div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 ${item.color} mb-4 group-hover:scale-110 transition-transform`}>
                    <item.icon size={20} />
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-stampa-orange transition-colors">{item.title}</h3>
                  <p className="mt-2 text-sm text-gray-400">{item.desc}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* 3. Grid Principal */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">

        {/* Columna Izquierda (Ocupa 2/3) */}
        <div className="lg:col-span-2 space-y-10">

          {/* Continuar Aprendiendo */}
          <div>
            <SectionTitle
              title="Continuar aprendiendo"
              action={
                <Link href="/cursos" className="text-xs font-semibold text-stampa-orange hover:underline flex items-center gap-1">
                  Ver academia <ArrowRight size={14} />
                </Link>
              }
            />
            <div className="mt-4">
              {continuingCourse ? (
                <Link href={`/cursos/${continuingCourse.id}`}>
                  <Card className="flex items-center gap-5 p-5 bg-stampa-surface border-stampa-border hover:border-[#ff6a00]/30 hover:bg-white/5 transition-all cursor-pointer">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-white/5 text-3xl overflow-hidden">
                      {continuingCourse.thumbnail_url ? (
                        <img src={continuingCourse.thumbnail_url} alt={continuingCourse.title} className="w-full h-full object-cover" />
                      ) : (
                        <BookOpen className="text-gray-500" size={28} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-bold text-white truncate">{continuingCourse.title}</p>
                      <p className="text-sm text-gray-400 mt-1">
                        {continuingCourse.completedLessons} de {continuingCourse.totalLessons} lecciones completadas
                      </p>
                      <ProgressBar value={continuingCourse.progress} className="mt-3 h-2" />
                    </div>
                    <ChevronRight size={24} className="text-gray-500 shrink-0 group-hover:text-stampa-orange transition-colors" />
                  </Card>
                </Link>
              ) : (
                <Link href="/cursos">
                  <Card className="flex items-center justify-between p-6 bg-stampa-surface border-stampa-border hover:border-[#ff6a00]/30 hover:bg-white/5 transition-all cursor-pointer">
                    <div>
                      <h3 className="text-base font-bold text-white">Seguí con tus cursos</h3>
                      <p className="mt-1 text-sm text-gray-400">Entrá a la academia y continuá tu ruta de aprendizaje.</p>
                    </div>
                    <ChevronRight size={24} className="text-gray-500" />
                  </Card>
                </Link>
              )}
            </div>
          </div>

          {/* Stampy Destacado */}
          <div>
            <Card className="relative overflow-hidden bg-stampa-surface border-[#ff6a00]/30 p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6">
              <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                <Bot size={120} />
              </div>
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-stampa-orange/10 text-stampa-orange border border-[#ff6a00]/20 relative z-10">
                <Bot size={32} />
              </div>
              <div className="flex-1 text-center sm:text-left relative z-10">
                <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
                  <h3 className="text-xl font-bold text-white">Stampy está para ayudarte</h3>
                  <Badge tone="orange" className="text-[10px]">IA</Badge>
                </div>
                <p className="text-sm text-gray-400">
                  Preguntale por problemas de impresión, precios, stock o cursos. Te va a guiar hacia el próximo paso.
                </p>
              </div>
              <div className="shrink-0 relative z-10">
                <PrimaryButton href="/stampy" className="px-6">Preguntar ahora</PrimaryButton>
              </div>
            </Card>
          </div>

        </div>

        {/* Columna Derecha (Ocupa 1/3) */}
        <div className="space-y-10">

          {/* Mi Taller (Resumen) */}
          <div>
            <SectionTitle title="Mi Taller" />
            <Card className="mt-4 p-5 bg-stampa-surface border-stampa-border flex flex-col gap-4">
              <Link href="/presupuestos" className="flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-gray-400 group-hover:text-blue-400 transition-colors">
                    <FileText size={16} />
                  </div>
                  <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">Presupuestos creados</span>
                </div>
                <span className="text-base font-bold text-white">{budgetsCount}</span>
              </Link>

              <Link href="/libreria-stl" className="flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-gray-400 group-hover:text-green-400 transition-colors">
                    <Download size={16} />
                  </div>
                  <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">STL descargados</span>
                </div>
                <span className="text-base font-bold text-white">{downloadsCount}</span>
              </Link>

              <Link href="/cursos" className="flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-gray-400 group-hover:text-orange-400 transition-colors">
                    <BookOpen size={16} />
                  </div>
                  <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">Cursos iniciados</span>
                </div>
                <span className="text-base font-bold text-white">{coursesCount}</span>
              </Link>
            </Card>
          </div>

          {/* Sorteo / Comunidad */}
          <div>
            <SectionTitle title="Sorteos para miembros" />
            <div className="mt-4">
              {upcomingRaffle ? (
                <Card className="p-5 bg-stampa-surface border-stampa-border group cursor-pointer hover:border-[#ff6a00]/30 transition-all">
                  <Link href="/sorteos">
                    <div className="mb-4 flex h-32 items-center justify-center rounded-xl bg-white/5 overflow-hidden relative border border-stampa-border">
                      {upcomingRaffle.raffle_prizes && upcomingRaffle.raffle_prizes[0]?.image_url ? (
                        <img src={upcomingRaffle.raffle_prizes[0].image_url} alt={upcomingRaffle.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <div className="text-5xl group-hover:scale-110 transition-transform">🎁</div>
                      )}
                    </div>
                    <p className="text-base font-bold text-white truncate">{upcomingRaffle.raffle_prizes && upcomingRaffle.raffle_prizes.length > 0 ? upcomingRaffle.raffle_prizes[0].name : upcomingRaffle.title}</p>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                      {upcomingRaffle.draw_date && (
                        <><CalendarDays size={14} /> Sorteo: {new Date(upcomingRaffle.draw_date).toLocaleDateString("es-AR")}</>
                      )}
                    </p>
                  </Link>
                </Card>
              ) : (
                <Card className="p-5 bg-stampa-surface border-stampa-border text-center flex flex-col items-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-gray-500 border border-stampa-border">
                    <Gift size={24} />
                  </div>
                  <h3 className="text-base font-bold text-white">Revisá sorteos activos</h3>
                  <p className="text-sm text-gray-400 mt-2 mb-5">Participá por premios y beneficios exclusivos para la academia.</p>
                  <GhostButton href="/sorteos" className="w-full bg-white/5 text-white border border-stampa-border hover:bg-white/10">
                    Ver sorteos
                  </GhostButton>
                </Card>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
