"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Download, FileText, Play, Calculator, ChevronRight, CalendarDays, Gift, Boxes, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SectionTitle } from "@/components/ui/section-title";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/utils/supabase/client";

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  const stats = [
    {
      label: "Cursos iniciados",
      value: coursesCount,
      icon: BookOpen,
    },
    {
      label: "STL descargados",
      value: downloadsCount,
      icon: Download,
    },
    {
      label: "Presupuestos creados",
      value: budgetsCount,
      icon: FileText,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome Card */}
      <Card className="overflow-hidden bg-gradient-to-br from-gray-900 to-gray-800 p-6 text-white sm:p-8">
        <p className="text-sm font-medium text-orange-400">Hola, {userFirstName} 👋</p>
        <h2 className="mt-1 text-2xl font-bold sm:text-3xl">Sigamos imprimiendo ideas Juntos ideando las ideas de impresion 3D para idear nuestro futuro juntos.</h2>
        <p className="mt-2 max-w-lg text-sm text-gray-300">
          Retomá tu curso, revisá el sorteo del mes o calculá el costo de tu próxima pieza.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {continuingCourse ? (
            <PrimaryButton href={`/cursos/${continuingCourse.id}`}>
              <Play size={15} /> Continuar curso
            </PrimaryButton>
          ) : (
            <PrimaryButton href="/cursos">
              <Play size={15} /> Explorar cursos
            </PrimaryButton>
          )}
          <GhostButton href="/calculadora" className="bg-white/10 border-white/10 text-[#FF6D00] hover:bg-white/20">
            <Calculator size={15} /> Ir a la calculadora
          </GhostButton>
        </div>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
              <s.icon size={20} />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/* Continuing Course */}
          <SectionTitle
            eyebrow="Seguí aprendiendo"
            title="Continuar curso"
            action={
              <Link href="/cursos" className="text-xs font-semibold text-orange-600 hover:underline">
                Ver todos
              </Link>
            }
          />
          {continuingCourse ? (
            <Link href={`/cursos/${continuingCourse.id}`}>
              <Card className="flex items-center gap-4 p-4 hover:-translate-y-0.5 hover:shadow-md cursor-pointer">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-3xl overflow-hidden">
                  {continuingCourse.thumbnail_url ? (
                    <img src={continuingCourse.thumbnail_url} alt={continuingCourse.title} className="w-full h-full object-cover" />
                  ) : (
                    <BookOpen className="text-gray-300" size={24} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{continuingCourse.title}</p>
                  <p className="text-xs text-gray-500">
                    {continuingCourse.completedLessons} de {continuingCourse.totalLessons} lecciones completadas
                  </p>
                  <ProgressBar value={continuingCourse.progress} className="mt-2" />
                </div>
                <ChevronRight size={18} className="text-gray-300 shrink-0" />
              </Card>
            </Link>
          ) : (
            <EmptyState
              icon={BookOpen}
              title="Todavía no empezaste ningún curso"
              hint="Explorá los cursos disponibles y empezá por el que más te sirva."
            />
          )}

          {/* Recently Added STLs */}
          <div className="mt-8">
            <SectionTitle
              eyebrow="Recién agregados"
              title="Últimos STL"
              action={
                <Link href="/libreria-stl" className="text-xs font-semibold text-orange-600 hover:underline">
                  Ver librería
                </Link>
              }
            />
            {latestStls.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {latestStls.map((f) => (
                  <Card key={f.id} className="p-3">
                    <div className="flex h-16 items-center justify-center rounded-lg bg-gray-50 text-2xl overflow-hidden">
                      {f.thumbnail_url || f.stl_models?.thumbnail_url ? (
                        <img src={f.thumbnail_url || f.stl_models?.thumbnail_url} alt={f.name} className="w-full h-full object-cover" />
                      ) : (
                        <Boxes className="text-gray-300" size={24} />
                      )}
                    </div>
                    <p className="mt-2 truncate text-xs font-semibold text-gray-900">{f.name}</p>
                    <div className="mt-1">
                      <Badge tone="green">Disponible</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Boxes}
                title="Todavía no hay archivos STL cargados"
                hint="Vuelve más tarde para descubrir nuevos modelos."
              />
            )}
          </div>
        </div>

        {/* Sidebar Sorteo Card */}
        <div>
          <SectionTitle eyebrow="Este mes" title="Próximo sorteo" />
          {upcomingRaffle ? (
            <Card className="p-5">
              <div className="mb-3 flex h-28 items-center justify-center rounded-xl bg-gray-50 overflow-hidden relative">
                {upcomingRaffle.raffle_prizes && upcomingRaffle.raffle_prizes[0]?.image_url ? (
                  <img src={upcomingRaffle.raffle_prizes[0].image_url} alt={upcomingRaffle.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-5xl">🎁</div>
                )}
              </div>
              <p className="text-sm font-bold text-gray-900">{upcomingRaffle.raffle_prizes && upcomingRaffle.raffle_prizes.length > 0 ? upcomingRaffle.raffle_prizes[0].name : upcomingRaffle.title}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                {upcomingRaffle.draw_date && (
                  <><CalendarDays size={13} /> Sorteo: {new Date(upcomingRaffle.draw_date).toLocaleDateString("es-AR")}</>
                )}
              </p>
              <PrimaryButton href="/sorteos" className="mt-4 w-full">
                Ver bases y participar
              </PrimaryButton>
            </Card>
          ) : (
            <Card className="p-5 text-center">
              <div className="mb-3 mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-50 text-gray-400">
                <Gift size={24} />
              </div>
              <p className="text-sm font-bold text-gray-900">No hay sorteos activos por ahora</p>
              <GhostButton href="/sorteos" className="mt-4 w-full bg-gray-50 text-gray-900 border border-gray-200 hover:bg-gray-100">
                Ver sorteos
              </GhostButton>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
