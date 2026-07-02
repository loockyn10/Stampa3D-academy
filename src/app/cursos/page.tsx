"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { CourseCard } from "@/components/cards/course-card";
import { SectionTitle } from "@/components/ui/section-title";
import { Loader2 } from "lucide-react";

export default function CursosPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const fetchCourses = async () => {
      setLoading(true);
      setError(null);
      const { data, error: fetchErr } = await supabase
        .from("courses")
        .select(`
          *,
          instructors ( name ),
          course_modules (
            lessons ( id, duration_minutes )
          )
        `)
        .eq("status", "published")
        .order("sort_order", { ascending: true });

      if (fetchErr) {
        console.error("Error fetching courses:", fetchErr);
        setError(fetchErr.message);
      } else if (data) {
        setCourses(data);
      }
      setLoading(false);
    };

    fetchCourses();
  }, [supabase]);

  return (
    <div>
      <SectionTitle eyebrow="Plataforma" title="Cursos" />
      
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm border border-red-100 mb-6">
          Error al cargar los cursos: {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-orange-500 h-8 w-8" />
        </div>
      ) : courses.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-500">Todavía no hay cursos publicados.</p>
        </div>
      )}
    </div>
  );
}
