import React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Layers, User, Image as ImageIcon } from "lucide-react";
import { getCourseLevelStyle } from "@/lib/course-style";

interface CourseCardProps {
  course: any;
}

export function CourseCard({ course }: CourseCardProps) {
  // Try to use real DB data
  const title = course.title || "Curso sin título";
  const instructorName = course.instructors?.name || "Stampa3D";
  const levelStyle = getCourseLevelStyle(course.level);
  
  // Calculate total duration and lessons by flattening lessons within course_modules
  const modules = course.course_modules || [];
  const lessonsList = modules.flatMap((m: any) => m.lessons || []);
  const lessonsCount = lessonsList.length;
  const totalDuration = lessonsList.reduce((acc: number, l: any) => acc + (l.duration_minutes || 0), 0);
  
  const formatDuration = (mins: number) => {
    if (!mins) return "0h 0m";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  return (
    <Link href={`/cursos/${course.slug || course.id}`} className="group block h-full">
      <Card className="relative overflow-hidden p-0 h-full flex flex-col bg-stampa-surface border-stampa-border transition-all duration-300 shadow-lg group-hover:-translate-y-0.5">
        {/* Portada 16:9 compartida por cursos y talleres en todos los breakpoints. */}
        <div className="relative aspect-video shrink-0 bg-stampa-bg-soft overflow-hidden">
          {course.thumbnail_url ? (
            <img 
              src={course.thumbnail_url} 
              alt={title} 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-neutral-900 to-neutral-950 relative overflow-hidden">
              <div className="absolute inset-0 bg-stampa-orange/5 opacity-50" />
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-stampa-border flex items-center justify-center mb-2 shadow-inner">
                <ImageIcon size={20} className="text-gray-500" />
              </div>
              <span className="text-xs font-bold text-gray-600 tracking-widest uppercase">Academia Stampa</span>
            </div>
          )}
          
          {/* Badge de nivel: refuerza el mismo color semántico de la franja. */}
          {levelStyle && (
            <div className="absolute right-3 top-3 z-10">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm backdrop-blur-sm sm:px-3 ${levelStyle.badgeClassName}`}>
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${levelStyle.dotClassName}`} />
                {levelStyle.label}
              </span>
            </div>
          )}
          
          {/* Badges Top Left */}
          <div className="absolute left-3 top-3 z-10 flex flex-col gap-2 items-start">
            {course.course_kind === "workshop" && (
              <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-300 backdrop-blur-sm">
                Taller
              </span>
            )}
            {/* Badge Estado Especial (solo si no es published) */}
            {course.status && course.status !== "published" && (
              <span className="inline-flex items-center rounded-full bg-stampa-bg/60 backdrop-blur-md border border-white/20 px-2.5 py-1 text-[10px] font-bold text-white uppercase tracking-wider">
                {course.status === "draft" ? "En desarrollo" : course.status}
              </span>
            )}
          </div>
        </div>

        {levelStyle && (
          <div
            aria-hidden="true"
            className={`pointer-events-none z-30 h-[5px] w-full shrink-0 transition-all duration-300 ${levelStyle.accentClassName}`}
          />
        )}
        
        {/* Información compacta */}
        <div className={`flex min-h-24 flex-1 flex-col justify-center px-4 py-3 bg-gradient-to-t from-neutral-950 to-neutral-900 relative z-20 ${levelStyle ? "" : "border-t border-stampa-border"}`}>
          <h3 className="text-sm sm:text-base font-bold leading-tight text-white line-clamp-1 group-hover:text-stampa-orange transition-colors">
            {title}
          </h3>
          
          <div className="mt-2 flex items-center justify-between text-xs font-medium">
            <div className="flex items-center gap-3 text-gray-400">
              <span className="flex items-center gap-1.5">
                <Layers size={13} className="text-stampa-orange" /> {lessonsCount} clases
              </span>
              {totalDuration > 0 && (
                <span className="flex items-center gap-1.5">
                  <Clock size={13} className="text-blue-400" /> {formatDuration(totalDuration)}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-1.5 text-gray-500">
              <User size={12} /> <span className="line-clamp-1 max-w-[80px]">{instructorName}</span>
            </div>
          </div>
        </div>

      </Card>
    </Link>
  );
}
