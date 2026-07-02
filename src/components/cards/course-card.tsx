import React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Layers, User } from "lucide-react";

interface CourseCardProps {
  course: any;
}

export function CourseCard({ course }: CourseCardProps) {
  // Try to use real DB data
  const title = course.title || "Curso sin título";
  const badgeText = course.level === "advanced" ? "Avanzado" : course.level === "intermediate" ? "Intermedio" : "Principiante";
  const badgeTone = course.level === "advanced" ? "dark" : "green";
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
    <Link href={`/cursos/${course.slug || course.id}`}>
      <Card className="overflow-hidden p-0 hover:-translate-y-0.5 hover:shadow-md cursor-pointer h-full flex flex-col">
        <div className="relative flex h-36 items-center justify-center bg-gray-100 shrink-0 overflow-hidden">
          {course.thumbnail_url ? (
            <img src={course.thumbnail_url} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="text-5xl text-gray-300">🎓</div>
          )}
          <div className="absolute right-3 top-3">
            <Badge tone={badgeTone}>{badgeText}</Badge>
          </div>
        </div>
        <div className="p-4 flex-1 flex flex-col justify-between">
          <div>
            <p className="text-sm font-bold leading-snug text-gray-900 line-clamp-2">{title}</p>
            <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
              <span className="flex items-center gap-1">
                <User size={12} /> {instructorName}
              </span>
              <span className="flex items-center gap-1">
                <Layers size={12} /> {lessonsCount} clases
              </span>
              {totalDuration > 0 && (
                <span className="flex items-center gap-1">
                  <Clock size={12} /> {formatDuration(totalDuration)}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
