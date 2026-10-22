"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Briefcase,
  Calculator,
  CalendarDays,
  Compass,
  Gift,
  GraduationCap,
  Package,
  PackageX,
  Play,
  RefreshCw,
  Sparkles,
  Store,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { getXpProgress, type XpProgress } from "@/lib/xp/progression";
import { courseProgressPercent, pickContinueLearningCourse, type ContinueLearningCourse } from "@/lib/academy/continue-learning";
import { loadWorkshopSummary } from "@/lib/workshop/load-summary";
import type { WorkshopSummary } from "@/lib/workshop/dashboard";
import { WORKSHOP_ROUTES } from "@/lib/workshop/routes";
import { getVisibleRaffles, type PublicRaffle } from "@/lib/raffles/public-raffles";
import { modelHref } from "@/lib/stl/library";
import type { BusinessMetrics } from "@/lib/business/metrics";
import { loadBusinessMetricsAction } from "@/app/mi-negocio/actions";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const dayFormat = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long" });

type Section<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };

export interface HomeCourse extends ContinueLearningCourse {
  totalLessons: number;
  progress: number;
}

export interface HomeRecommendedCourse {
  routeId: string;
  title: string;
  thumbnailUrl: string | null;
  level: string | null;
}

export interface HomeStlModel {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  href: string;
}

export interface HomeData {
  firstName: string;
  xp: XpProgress | null;
  learning: Section<{ course: HomeCourse | null; recommended: HomeRecommendedCourse | null }>;
  workshop: Section<WorkshopSummary>;
  business: Section<BusinessMetrics>;
  raffle: Section<PublicRaffle | null>;
  stl: Section<HomeStlModel[]>;
}

/** Accesos rápidos: los más usados primero; Stampy destacado. */
export const HOME_QUICK_ACTIONS: { href: string; label: string; icon: LucideIcon; highlight?: boolean }[] = [
  { href: "/stampy", label: "Stampy", icon: Bot, highlight: true },
  { href: "/calculadora", label: "Calculadora", icon: Calculator },
  { href: "/explorar-modelos", label: "Explorar Modelos", icon: Compass },
  { href: "/academia", label: "Academia", icon: GraduationCap },
  { href: "/mi-taller", label: "Mi Taller", icon: Wrench },
  { href: "/mi-negocio", label: "Mi Negocio", icon: Briefcase },
];

export function HomeDashboard() {
  const [supabase] = useState(() => createClient());
  const [data, setData] = useState<HomeData>({
    firstName: "",
    xp: null,
    learning: { status: "loading" },
    workshop: { status: "loading" },
    business: { status: "loading" },
    raffle: { status: "loading" },
    stl: { status: "loading" },
  });

  useEffect(() => {
    let active = true;
    const patch = (next: Partial<HomeData>) => {
      if (active) setData((current) => ({ ...current, ...next }));
    };

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Cada bloque carga y falla por separado: un error no oculta el resto de Inicio.
      void (async () => {
        const [{ data: profile }, { data: xpSummary }] = await Promise.all([
          supabase.from("profiles").select("display_name, full_name").eq("id", user.id).single(),
          supabase.from("user_xp_summary").select("total_xp").eq("user_id", user.id).maybeSingle(),
        ]);
        const name = String(profile?.display_name || profile?.full_name || "").trim();
        patch({ firstName: name.split(" ")[0] || "", xp: getXpProgress(Number(xpSummary?.total_xp) || 0) });
      })();

      void (async () => {
        const { data: progressRows, error } = await supabase
          .from("lesson_progress")
          .select("completed_at, lessons ( id, course_modules ( id, course_id, courses ( id, title, thumbnail_url, slug ) ) )")
          .eq("user_id", user.id);
        if (error) return patch({ learning: { status: "error" } });
        const latest = pickContinueLearningCourse((progressRows ?? []) as never);
        if (latest) {
          const { count } = await supabase
            .from("lessons")
            .select("id, course_modules!inner(course_id)", { count: "exact", head: true })
            .eq("course_modules.course_id", latest.courseId)
            .eq("is_published", true);
          const totalLessons = count ?? 0;
          return patch({
            learning: {
              status: "ready",
              data: { course: { ...latest, totalLessons, progress: courseProgressPercent(latest.completedLessons, totalLessons) }, recommended: null },
            },
          });
        }
        // Sin cursos iniciados: el primer curso publicado (mismo orden que la Academia).
        const { data: courses } = await supabase
          .from("courses")
          .select("id, title, slug, thumbnail_url, level")
          .eq("status", "published")
          .eq("course_kind", "course")
          .order("sort_order", { ascending: true })
          .limit(1);
        const first = courses?.[0];
        patch({
          learning: {
            status: "ready",
            data: {
              course: null,
              recommended: first ? { routeId: first.slug || first.id, title: first.title, thumbnailUrl: first.thumbnail_url || null, level: first.level || null } : null,
            },
          },
        });
      })();

      void loadWorkshopSummary(supabase, user.id).then((summary) => patch({ workshop: summary ? { status: "ready", data: summary } : { status: "error" } }));

      void loadBusinessMetricsAction("month").then((result) => patch({ business: result.success ? { status: "ready", data: result.metrics } : { status: "error" } }));

      void getVisibleRaffles(supabase).then(({ data: raffles, error }) => {
        if (error) return patch({ raffle: { status: "error" } });
        const now = Date.now();
        const upcoming = raffles.find((raffle) => raffle.draw_date && Date.parse(raffle.draw_date) >= now) ?? null;
        patch({ raffle: { status: "ready", data: upcoming } });
      });

      void (async () => {
        const { data: models, error } = await supabase
          .from("stl_models")
          .select("id, name, title, thumbnail_url, category_id, created_at")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(4);
        if (error) return patch({ stl: { status: "error" } });
        patch({
          stl: {
            status: "ready",
            data: (models ?? []).map((model) => ({
              id: model.id,
              title: model.title || model.name || "Modelo",
              thumbnailUrl: model.thumbnail_url || null,
              href: modelHref({ id: model.category_id ?? null, slug: null }, model.id),
            })),
          },
        });
      })();
    }

    void load();
    return () => {
      active = false;
    };
  }, [supabase]);

  const stampyContext = useMemo<StampyScreenContext>(() => {
    const course = data.learning.status === "ready" ? data.learning.data.course : null;
    const raffle = data.raffle.status === "ready" ? data.raffle.data : null;
    const workshop = data.workshop.status === "ready" ? data.workshop.data : null;
    const visibleEntities: NonNullable<StampyScreenContext["visibleEntities"]> = [];
    if (course) {
      visibleEntities.push({
        type: "course_in_progress",
        id: course.courseId,
        name: course.title,
        position: 1,
        facts: [
          { label: "Progreso visible en porcentaje", value: course.progress },
          { label: "Lecciones completadas", value: course.completedLessons },
          { label: "Lecciones totales", value: course.totalLessons },
        ],
      });
    }
    if (raffle) {
      visibleEntities.push({
        type: "upcoming_raffle",
        id: raffle.id,
        name: raffle.title,
        position: visibleEntities.length + 1,
        facts: raffle.draw_date ? [{ label: "Fecha visible del sorteo", value: new Date(raffle.draw_date).toLocaleDateString("es-AR") }] : [],
      });
    }
    return {
      page: { section: "dashboard", route: "/", title: "Inicio" },
      mode: "overview",
      visibleEntities,
      pageData: {
        kind: "pageFacts",
        facts: [
          ...(data.xp ? [{ label: "Nivel XP", value: data.xp.level }, { label: "XP total", value: data.xp.totalXp }] : []),
          ...(data.learning.status === "ready" ? [{ label: "Cursos iniciados", value: course?.startedCourses ?? 0 }] : []),
          { label: "Hay un curso para continuar visible", value: Boolean(course) },
          { label: "Hay un sorteo próximo visible", value: Boolean(raffle) },
          ...(workshop
            ? [
                { label: "Productos sin stock (Mi Taller)", value: workshop.outOfStockProducts },
                { label: "Productos que requieren recalcular", value: workshop.needsRecalculationProducts },
              ]
            : []),
        ],
      },
      uiState: { loading: data.learning.status === "loading" },
    };
  }, [data]);
  usePublishStampyScreenContext(stampyContext);

  return <HomeDashboardView data={data} />;
}

export function HomeDashboardView({ data }: { data: HomeData }) {
  const learning = data.learning.status === "ready" ? data.learning.data : null;
  const workshop = data.workshop.status === "ready" ? data.workshop.data : null;
  const business = data.business.status === "ready" ? data.business.data : null;

  return (
    <div className="space-y-5 pb-10">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {data.firstName ? `Hola, ${data.firstName}` : "Hola"}
          </h1>
          <p className="mt-1 text-sm text-gray-400">¿Qué querés resolver hoy? Seguí donde lo dejaste o pedile ayuda a Stampy.</p>
        </div>
        {data.xp && <XpBadge xp={data.xp} />}
      </header>

      <nav aria-label="Accesos rápidos" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {HOME_QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-center text-xs font-semibold leading-tight transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange sm:text-sm ${
                action.highlight
                  ? "border-stampa-orange/40 bg-stampa-orange/10 text-orange-100 hover:bg-stampa-orange/15"
                  : "border-stampa-border bg-stampa-surface text-gray-200 hover:border-stampa-orange/30 hover:bg-white/[0.03]"
              }`}
            >
              <Icon size={20} className={action.highlight ? "text-stampa-orange" : "text-gray-400"} aria-hidden="true" />
              {action.label}
            </Link>
          );
        })}
      </nav>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ContinueLearning section={data.learning} learning={learning} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <HomePanel title="Mi Taller" icon={Wrench} href="/mi-taller" linkLabel="Abrir">
              {data.workshop.status === "loading" ? (
                <MiniSkeleton />
              ) : !workshop ? (
                <SectionUnavailable />
              ) : workshop.activeProducts === 0 && workshop.activeSpools === 0 ? (
                <StartCta text="Cargá tus bobinas y productos para controlar costos y stock." href={WORKSHOP_ROUTES.newProduct} label="Crear un producto" />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Unidades terminadas" value={workshop.finishedUnits} icon={Warehouse} />
                    <Metric label="Productos" value={workshop.activeProducts} icon={Package} />
                  </div>
                  {workshop.outOfStockProducts > 0 || workshop.needsRecalculationProducts > 0 || workshop.emptySpools > 0 ? (
                    <ul className="mt-3 space-y-1.5 text-xs">
                      {workshop.outOfStockProducts > 0 && (
                        <AttentionLink href={WORKSHOP_ROUTES.inventoryOutOfStock} icon={PackageX} tone="red">
                          {workshop.outOfStockProducts} {workshop.outOfStockProducts === 1 ? "producto sin stock" : "productos sin stock"}
                        </AttentionLink>
                      )}
                      {workshop.needsRecalculationProducts > 0 && (
                        <AttentionLink href={WORKSHOP_ROUTES.productsNeedingRecalculation} icon={RefreshCw} tone="yellow">
                          {workshop.needsRecalculationProducts} {workshop.needsRecalculationProducts === 1 ? "costo para recalcular" : "costos para recalcular"}
                        </AttentionLink>
                      )}
                      {workshop.emptySpools > 0 && (
                        <AttentionLink href={WORKSHOP_ROUTES.filaments} icon={Package} tone="red">
                          {workshop.emptySpools} {workshop.emptySpools === 1 ? "bobina agotada" : "bobinas agotadas"}
                        </AttentionLink>
                      )}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-emerald-300">Sin productos agotados ni costos pendientes.</p>
                  )}
                </>
              )}
            </HomePanel>

            <HomePanel title="Mi Negocio" icon={Briefcase} href="/mi-negocio" linkLabel="Abrir">
              {data.business.status === "loading" ? (
                <MiniSkeleton />
              ) : !business ? (
                <SectionUnavailable />
              ) : business.salesCount === 0 && business.outstandingReceivables === 0 ? (
                <StartCta text="Sin ventas registradas este mes. Registrá una venta o armá tu catálogo." href="/mi-negocio/venta-rapida" label="Venta rápida" />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Facturación del mes" value={money.format(business.revenue)} icon={Store} />
                    <Metric label="Ventas del mes" value={business.salesCount} icon={Briefcase} />
                  </div>
                  <p className="mt-3 text-xs text-gray-500">
                    Ticket promedio {money.format(business.averageTicket)}
                    {business.outstandingReceivables > 0 && <> · <Link href="/mi-negocio/clientes" className="text-yellow-300 hover:underline">saldo a cobrar {money.format(business.outstandingReceivables)}</Link></>}
                  </p>
                </>
              )}
            </HomePanel>
          </div>
        </div>

        <aside className="space-y-4" aria-label="Novedades">
          <RaffleCard section={data.raffle} />
          <LatestStl section={data.stl} />
        </aside>
      </div>
    </div>
  );
}

function XpBadge({ xp }: { xp: XpProgress }) {
  return (
    <Link
      href="/perfil"
      className="block w-full rounded-xl border border-stampa-orange/25 bg-stampa-orange/[0.07] px-4 py-3 transition-colors hover:bg-stampa-orange/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange md:w-64"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-orange-100">Nivel {xp.level}</span>
        <span className="text-xs tabular-nums text-orange-200/80">{xp.totalXp.toLocaleString("es-AR")} XP</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Progreso al próximo nivel" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(xp.progressPercent)}>
        <div className="h-full rounded-full bg-stampa-orange" style={{ width: `${Math.min(100, Math.max(0, xp.progressPercent))}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-gray-400">Faltan {xp.xpToNextLevel.toLocaleString("es-AR")} XP para el nivel {xp.level + 1}</p>
    </Link>
  );
}

function ContinueLearning({ section, learning }: { section: HomeData["learning"]; learning: { course: HomeCourse | null; recommended: HomeRecommendedCourse | null } | null }) {
  if (section.status === "loading") {
    return <div className="h-32 animate-pulse rounded-2xl border border-stampa-border bg-stampa-surface" aria-hidden="true" />;
  }
  const course = learning?.course ?? null;
  const recommended = learning?.recommended ?? null;
  const title = course ? course.title : recommended ? recommended.title : "Academia Stampa";
  const thumb = course?.thumbnailUrl ?? recommended?.thumbnailUrl ?? null;
  const href = course ? `/cursos/${course.routeId}` : recommended ? `/cursos/${recommended.routeId}` : "/academia";
  const finished = course ? course.totalLessons > 0 && course.completedLessons >= course.totalLessons : false;

  return (
    <section aria-labelledby="home-learning-title" className="overflow-hidden rounded-2xl border border-stampa-border bg-gradient-to-br from-stampa-orange/[0.09] via-stampa-surface to-stampa-surface">
      <div className="flex items-start gap-3 p-4 sm:items-center sm:gap-4 sm:p-5">
        <div className="relative aspect-[4/3] w-20 shrink-0 overflow-hidden rounded-xl border border-stampa-border bg-white/5 sm:aspect-video sm:w-44">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-500"><BookOpen size={28} aria-hidden="true" /></div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-stampa-orange">
            {course ? (finished ? "Curso completado" : "Continuar aprendiendo") : recommended ? "Recomendado para empezar" : "Aprendé impresión 3D"}
          </p>
          <h2 id="home-learning-title" className="mt-1 line-clamp-2 text-lg font-bold leading-snug text-white">{title}</h2>
          {course ? (
            <>
              <p className="mt-1 text-xs text-gray-400">
                {course.completedLessons} de {course.totalLessons || "?"} lecciones completadas
                {course.startedCourses > 1 && ` · ${course.startedCourses} cursos iniciados`}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`Progreso de ${course.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={course.progress}>
                  <div className="h-full rounded-full bg-stampa-orange" style={{ width: `${course.progress}%` }} />
                </div>
                <span className="text-xs font-bold tabular-nums text-gray-300">{course.progress}%</span>
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-gray-400">
              {recommended ? `Un buen primer paso${recommended.level ? ` · Nivel ${recommended.level}` : ""}. Tu progreso se guarda lección a lección.` : "Cursos y talleres para aprender, fabricar y vender."}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={finished ? "/academia" : href} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-stampa-orange px-4 text-sm font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange">
              {course && !finished ? <><Play size={15} aria-hidden="true" /> Continuar</> : finished ? <>Elegir otro curso</> : <><BookOpen size={15} aria-hidden="true" /> {recommended ? "Empezar curso" : "Ir a la Academia"}</>}
            </Link>
            <Link href="/academia" className="inline-flex min-h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-gray-400 hover:bg-white/5 hover:text-white">
              Ver Academia <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function RaffleCard({ section }: { section: HomeData["raffle"] }) {
  if (section.status === "loading") return <div className="h-40 animate-pulse rounded-2xl border border-stampa-border bg-stampa-surface" aria-hidden="true" />;
  const raffle = section.status === "ready" ? section.data : null;
  const prize = raffle?.raffle_prizes?.[0] ?? null;
  const image = prize?.image_url || raffle?.cover_image_url || null;
  return (
    <HomePanel title="Sorteos" icon={Gift} href="/sorteos" linkLabel="Ver sorteos">
      {raffle ? (
        <Link href="/sorteos" className="group flex gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange">
          <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-lg border border-stampa-border bg-white/5">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-gray-500"><Gift size={22} aria-hidden="true" /></div>
            )}
          </div>
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-semibold text-white">{prize?.name || raffle.title}</p>
            {raffle.draw_date && (
              <p className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                <CalendarDays size={12} aria-hidden="true" /> Sorteo el {dayFormat.format(new Date(raffle.draw_date))}
              </p>
            )}
            <p className="mt-1 text-xs font-semibold text-stampa-orange">Ver tus chances →</p>
          </div>
        </Link>
      ) : (
        <p className="text-sm text-gray-400">{section.status === "error" ? "No pudimos cargar los sorteos." : "No hay sorteos próximos por ahora."}</p>
      )}
    </HomePanel>
  );
}

function LatestStl({ section }: { section: HomeData["stl"] }) {
  if (section.status === "loading") return <div className="h-40 animate-pulse rounded-2xl border border-stampa-border bg-stampa-surface" aria-hidden="true" />;
  if (section.status === "error" || section.data.length === 0) return null;
  return (
    <HomePanel title="Nuevo en la Librería STL" icon={Sparkles} href="/libreria-stl" linkLabel="Ver librería">
      <ul className="grid grid-cols-4 gap-2 lg:grid-cols-2">
        {section.data.map((model) => (
          <li key={model.id} className="min-w-0">
            <Link href={model.href} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange">
              <div className="aspect-[4/3] overflow-hidden rounded-lg border border-stampa-border bg-stampa-bg-soft">
                {model.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={model.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-gray-600"><Package size={20} aria-hidden="true" /></div>
                )}
              </div>
              <p className="mt-1 truncate text-xs font-medium text-gray-300 group-hover:text-white">{model.title}</p>
            </Link>
          </li>
        ))}
      </ul>
    </HomePanel>
  );
}

function HomePanel({ title, icon: Icon, href, linkLabel, children }: { title: string; icon: LucideIcon; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-stampa-border bg-stampa-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white">
          <Icon size={16} className="text-stampa-orange" aria-hidden="true" /> {title}
        </h2>
        <Link href={href} className="rounded-md text-xs font-semibold text-stampa-orange hover:text-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange">
          {linkLabel} <span aria-hidden="true">→</span>
        </Link>
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: LucideIcon }) {
  return (
    <div className="min-w-0 rounded-lg bg-white/[0.03] px-3 py-2">
      <p className="flex items-center gap-1 truncate text-[11px] font-semibold text-gray-500">
        <Icon size={12} aria-hidden="true" /> {label}
      </p>
      <p className="mt-0.5 truncate text-lg font-bold tabular-nums text-white">{value}</p>
    </div>
  );
}

function AttentionLink({ href, icon: Icon, tone, children }: { href: string; icon: LucideIcon; tone: "red" | "yellow"; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className={`flex items-center gap-2 rounded-md py-0.5 font-semibold hover:underline ${tone === "red" ? "text-red-300" : "text-yellow-300"}`}>
        <Icon size={13} aria-hidden="true" /> {children}
      </Link>
    </li>
  );
}

function StartCta({ text, href, label }: { text: string; href: string; label: string }) {
  return (
    <div>
      <p className="text-sm text-gray-400">{text}</p>
      <Link href={href} className="mt-3 inline-flex min-h-9 items-center rounded-lg bg-stampa-orange/10 px-3 text-xs font-bold text-stampa-orange hover:bg-stampa-orange/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange">
        {label}
      </Link>
    </div>
  );
}

function SectionUnavailable() {
  return <p className="text-sm text-gray-500">No pudimos cargar este resumen ahora.</p>;
}

function MiniSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2" aria-hidden="true">
      <div className="h-14 animate-pulse rounded-lg bg-white/5" />
      <div className="h-14 animate-pulse rounded-lg bg-white/5" />
    </div>
  );
}
