import React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Layers, User, PlayCircle } from "lucide-react";
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
    <Link href={`/cursos/${course.slug || course.id}`} className="group h-full flex flex-col block">
      <Card className="overflow-hidden p-0 h-full flex flex-col bg-[#111] border-white/10 hover:border-[#ff6a00]/30 transition-all duration-300 shadow-lg group-hover:shadow-[#ff6a00]/10 group-hover:-translate-y-1">
        <div className="relative flex h-40 items-center justify-center bg-[#0a0a0a] shrink-0 overflow-hidden border-b border-white/5">
          {course.thumbnail_url ? (
            <>
              <img src={course.thumbnail_url} alt={title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 opacity-80 group-hover:opacity-100" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#111] to-transparent opacity-80" />
            </>
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-950" />
              <div className="text-5xl opacity-40 group-hover:opacity-60 transition-opacity">🎓</div>
              <div className="absolute inset-0 bg-gradient-to-t from-[#111] to-transparent opacity-90" />
            </>
          )}
          <div className="absolute right-3 top-3">
            <span className={`${getCourseLevelClasses(course)} shadow-sm`}>
              {getCourseLevelLabel(course)}
            </span>
          </div>
        </div>
        
        <div className="p-5 flex-1 flex flex-col justify-between relative">
          <div>
            <h3 className="text-base font-bold leading-snug text-white line-clamp-2 group-hover:text-[#ff6a00] transition-colors">{title}</h3>
            <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1.5 font-medium">
              <User size={13} className="text-gray-400" /> {instructorName}
            </p>
            
            <div className="mt-4 flex items-center gap-3 text-xs text-gray-400 flex-wrap font-medium">
              <span className="flex items-center gap-1.5 bg-[#0a0a0a] px-2 py-1 rounded-md border border-white/5">
                <Layers size={13} className="text-[#ff6a00]" /> {lessonsCount} clases
              </span>
              {totalDuration > 0 && (
                <span className="flex items-center gap-1.5 bg-[#0a0a0a] px-2 py-1 rounded-md border border-white/5">
                  <Clock size={13} className="text-blue-400" /> {formatDuration(totalDuration)}
                </span>
              )}
            </div>
          </div>
          
          <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between">
            <span className="text-xs font-bold text-[#ff6a00] flex items-center gap-1.5">
              <PlayCircle size={16} /> Ver curso
            </span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold bg-white/5 px-2 py-1 rounded">
              Disponible
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
