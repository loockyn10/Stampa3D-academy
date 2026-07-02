import React from "react";
import Link from "next/link";
import { Course } from "@/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Clock, Layers } from "lucide-react";

interface CourseCardProps {
  course: Course;
}

export function CourseCard({ course }: CourseCardProps) {
  return (
    <Link href={`/cursos/${course.id}`}>
      <Card className="overflow-hidden p-0 hover:-translate-y-0.5 hover:shadow-md cursor-pointer h-full flex flex-col">
        <div className="relative flex h-36 items-center justify-center bg-gray-50 text-5xl shrink-0">
          {course.img}
          <div className="absolute right-3 top-3">
            <Badge tone={course.badge === "Premium" ? "dark" : "green"}>{course.badge}</Badge>
          </div>
        </div>
        <div className="p-4 flex-1 flex flex-col justify-between">
          <div>
            <p className="text-sm font-bold leading-snug text-gray-900 line-clamp-2">{course.title}</p>
            <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Layers size={12} /> {course.lessons} lecciones
              </span>
              <span className="flex items-center gap-1">
                <Clock size={12} /> {course.duration}
              </span>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[11px] font-medium text-gray-400">
              <span>Progreso</span>
              <span>{course.progress}%</span>
            </div>
            <ProgressBar value={course.progress} />
          </div>
        </div>
      </Card>
    </Link>
  );
}
