"use client";

import React from "react";
import { useAppState } from "@/context/state-context";
import { CourseCard } from "@/components/cards/course-card";
import { SectionTitle } from "@/components/ui/section-title";

export default function CursosPage() {
  const { courses } = useAppState();

  return (
    <div>
      <SectionTitle eyebrow="Plataforma" title="Cursos" />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((c) => (
          <CourseCard key={c.id} course={c} />
        ))}
      </div>
    </div>
  );
}
