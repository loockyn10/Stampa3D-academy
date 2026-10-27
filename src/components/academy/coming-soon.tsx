import React from "react";
import Link from "next/link";
import { ArrowLeft, Lock, Image as ImageIcon, Sparkles } from "lucide-react";
import { getCourseKindUi } from "@/lib/academy/course-kind";

/**
 * Presentación de cursos «En preparación». Sin hooks ni acceso a datos: sirve tanto en el catálogo (cliente) como
 * en la página de detalle (servidor). Identidad Stampa: fondo oscuro, acento naranja, portada original visible
 * (sin desenfoque ni gris pleno) y un candado que deja claro que el contenido todavía no está disponible.
 */

interface ComingSoonCourse {
  id?: string;
  title?: string | null;
  description?: string | null;
  thumbnail_url?: string | null;
  thumbnailUrl?: string | null;
  course_kind?: string | null;
  courseKind?: string | null;
}

export function ComingSoonBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-stampa-orange/40 bg-stampa-bg/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-stampa-orange shadow-sm ${className}`}
    >
      <Lock size={12} aria-hidden="true" />
      En preparación
    </span>
  );
}

function Cover({ src, title, tall = false }: { src: string | null; title: string; tall?: boolean }) {
  return (
    <div className={`relative shrink-0 overflow-hidden bg-stampa-bg-soft ${tall ? "aspect-[16/9]" : "aspect-video"}`}>
      {src ? (
        // Portada original: un velo oscuro suave abajo (sin blur ni escala de grises) para legibilidad.
        <img src={src} alt={title} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-neutral-900 to-neutral-950">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border border-stampa-border bg-white/5">
            <ImageIcon size={20} className="text-gray-500" aria-hidden="true" />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-gray-600">Academia Stampa</span>
        </div>
      )}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-neutral-950/70 via-transparent to-transparent" />
    </div>
  );
}

/** Tarjeta del catálogo para un curso en preparación. No es un enlace: no hay nada a lo que entrar todavía. */
export function ComingSoonCourseCard({ course }: { course: ComingSoonCourse }) {
  const title = course.title || "Curso sin título";
  const kind = getCourseKindUi(course.course_kind ?? course.courseKind);

  return (
    <article
      aria-label={`${title}: ${kind.singular} en preparación`}
      className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-stampa-orange/25 bg-stampa-surface shadow-lg"
    >
      <div className="relative">
        <Cover src={course.thumbnail_url || course.thumbnailUrl || null} title={title} />
        <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
          <ComingSoonBadge />
          {kind.isWorkshop && (
            <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-300">
              Taller
            </span>
          )}
        </div>
        <div
          aria-hidden="true"
          className="absolute bottom-3 right-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-stampa-orange/40 bg-stampa-bg/85 text-stampa-orange shadow-lg"
        >
          <Lock size={18} />
        </div>
      </div>
      <div aria-hidden="true" className="h-[3px] w-full shrink-0 bg-gradient-to-r from-stampa-orange via-stampa-orange/50 to-transparent" />
      <div className="flex flex-1 flex-col gap-2 bg-gradient-to-t from-neutral-950 to-neutral-900 px-4 py-4">
        <h3 className="text-sm font-bold leading-tight text-white sm:text-base">{title}</h3>
        {course.description ? (
          <p className="line-clamp-3 text-xs leading-relaxed text-gray-400 sm:text-sm">{course.description}</p>
        ) : null}
        <div className="mt-auto pt-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-stampa-orange/10 px-3 py-1 text-xs font-semibold text-stampa-orange">
            <Sparkles size={12} aria-hidden="true" />
            Próximamente
          </span>
        </div>
      </div>
    </article>
  );
}

/** Sección «Próximamente en Academia» del catálogo (cada curso aparece solo acá, no en el listado principal). */
export function ComingSoonSection({
  courses,
  title = "Próximamente en Academia",
  subtitle = "Contenido que estamos preparando. Se habilita cuando esté listo.",
}: {
  courses: ComingSoonCourse[];
  title?: string;
  subtitle?: string;
}) {
  if (courses.length === 0) return null;
  return (
    <section aria-labelledby="coming-soon-heading" className="space-y-4">
      <div>
        <h2 id="coming-soon-heading" className="flex items-center gap-2 text-xl font-bold text-white sm:text-2xl">
          <Lock size={20} className="text-stampa-orange" aria-hidden="true" />
          {title}
        </h2>
        <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course, index) => (
          <ComingSoonCourseCard key={course.id ?? index} course={course} />
        ))}
      </div>
    </section>
  );
}

/** Pantalla de `/cursos/[id]` para un alumno cuando el curso está en preparación (sin ningún dato de clases). */
export function CourseComingSoonScreen({ course }: { course: ComingSoonCourse }) {
  const title = course.title || "Curso";
  const kind = getCourseKindUi(course.course_kind ?? course.courseKind);
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <Link
        href={kind.publicListHref}
        className="inline-flex items-center gap-2 text-sm font-semibold text-gray-400 transition-colors hover:text-white"
      >
        <ArrowLeft size={16} aria-hidden="true" /> Volver a {kind.plural}
      </Link>
      <div className="overflow-hidden rounded-3xl border border-stampa-orange/25 bg-stampa-surface shadow-2xl">
        <div className="relative">
          <Cover src={course.thumbnail_url || course.thumbnailUrl || null} title={title} tall />
          <div className="absolute left-4 top-4 z-10">
            <ComingSoonBadge />
          </div>
        </div>
        <div aria-hidden="true" className="h-[3px] w-full bg-gradient-to-r from-stampa-orange via-stampa-orange/50 to-transparent" />
        <div className="space-y-4 p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{title}</h1>
          {course.description ? (
            <p className="text-base leading-relaxed text-gray-400">{course.description}</p>
          ) : null}
          <div className="flex items-start gap-3 rounded-2xl border border-stampa-orange/20 bg-stampa-orange/5 p-4">
            <Lock size={20} className="mt-0.5 shrink-0 text-stampa-orange" aria-hidden="true" />
            <div>
              <p className="font-bold text-white">Este {kind.singular} está en preparación</p>
              <p className="mt-1 text-sm text-gray-400">
                Todavía no se puede comenzar. Cuando esté listo vas a poder entrar desde Academia.
              </p>
            </div>
          </div>
          <Link
            href="/academia"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-stampa-orange px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#ff6a00]/20 transition-colors hover:bg-[#e65c00]"
          >
            Volver a Academia
          </Link>
        </div>
      </div>
    </div>
  );
}
