import React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Layers, User, Image as ImageIcon } from "lucide-react";
import { getCourseLevelLabel, getCourseLevelClasses } from "@/lib/course-style";

interface CourseCardProps {
  course: any;
}

export function CourseCard({ course }: CourseCardProps) {
  // Try to use real DB data
  const title = course.title || "Curso sin título";
  const instructorName = course.instructors?.name || "Stampa3D";
  
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
    <Link href={`/cursos/${course.slug || course.id}`} className="group w-full min-w-0 aspect-[10/7] flex flex-col block">
      <Card className="overflow-hidden p-0 h-full flex flex-col bg-[#111] border-white/10 hover:border-[#ff6a00]/50 transition-all duration-300 shadow-lg group-hover:shadow-[0_8px_30px_rgb(255,106,0,0.12)] group-hover:-translate-y-1">
        
        {/* 70% Superior: Imagen */}
        <div className="relative flex-[7] bg-[#0a0a0a] overflow-hidden">
          {course.thumbnail_url ? (
            <img 
              src={course.thumbnail_url} 
              alt={title} 
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-neutral-900 to-neutral-950 relative overflow-hidden">
              <div className="absolute inset-0 bg-[#ff6a00]/5 opacity-50" />
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-2 shadow-inner">
                <ImageIcon size={20} className="text-gray-500" />
              </div>
              <span className="text-xs font-bold text-gray-600 tracking-widest uppercase">Academia Stampa</span>
            </div>
          )}
          
          {/* Badge Nivel o Taller */}
          <div className="absolute right-3 top-3 z-10">
            {course.course_kind === "workshop" ? (
              <span className="rounded-full border text-xs font-medium px-2.5 sm:px-3 py-1 shadow-sm backdrop-blur-sm bg-sky-500/10 text-sky-300 border-sky-500/30">
                Taller
              </span>
            ) : (
              <span className={`${getCourseLevelClasses(course)} shadow-sm backdrop-blur-sm bg-opacity-90`}>
                {getCourseLevelLabel(course)}
              </span>
            )}
          </div>
          
          {/* Badges Top Left */}
          <div className="absolute left-3 top-3 z-10 flex flex-col gap-2 items-start">
            {/* Badge Estado Especial (solo si no es published) */}
            {course.status && course.status !== "published" && (
              <span className="inline-flex items-center rounded-full bg-black/60 backdrop-blur-md border border-white/20 px-2.5 py-1 text-[10px] font-bold text-white uppercase tracking-wider">
                {course.status === "draft" ? "En desarrollo" : course.status}
              </span>
            )}
          </div>
        </div>
        
        {/* 30% Inferior: Info Compacta */}
        <div className="flex-[3] flex flex-col justify-center px-4 py-3 bg-gradient-to-t from-neutral-950 to-neutral-900 border-t border-white/5 relative z-20">
          <h3 className="text-sm sm:text-base font-bold leading-tight text-white line-clamp-1 group-hover:text-[#ff6a00] transition-colors">
            {title}
          </h3>
          
          <div className="mt-2 flex items-center justify-between text-xs font-medium">
            <div className="flex items-center gap-3 text-gray-400">
              <span className="flex items-center gap-1.5">
                <Layers size={13} className="text-[#ff6a00]" /> {lessonsCount} clases
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
