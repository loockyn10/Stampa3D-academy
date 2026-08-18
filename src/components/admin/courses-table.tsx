"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Edit2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export function CoursesTable() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    fetchCourses();
  }, []);

  const fetchCourses = async () => {
    setLoading(true);
    setError(null);
    
    // We need to fetch courses along with category and instructor names
    const { data, error: fetchError } = await supabase
      .from("courses")
      .select(`
        *,
        course_categories ( name ),
        instructors ( name )
      `)
      .order("sort_order", { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setCourses(data || []);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="bg-[#111] border border-white/10 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left border-collapse">
            <thead>
              <tr className="bg-[#0a0a0a] border-b border-white/10 text-sm font-medium text-gray-500">
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Categoría</th>
                <th className="px-4 py-3">Instructor</th>
                <th className="px-4 py-3">Nivel</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Orden</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {courses.map((course) => (
                <tr key={course.id} className="text-sm hover:bg-[#0a0a0a] transition-colors">
                  <td className="px-4 py-3 font-medium text-white">
                    {course.title}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {course.course_categories?.name || "Sin categoría"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {course.instructors?.name || "Sin instructor"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="capitalize text-gray-400">{course.level}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={course.course_kind === "workshop" ? "dark" : "gray"}>
                      {course.course_kind === "workshop" ? "Taller" : "Curso"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={course.status === "published" ? "green" : course.status === "archived" ? "dark" : "dark"}>
                      {course.status === "published" ? "Publicado" : course.status === "archived" ? "Archivado" : "Borrador"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {course.sort_order}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/cursos/${course.id}`}
                      className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-medium"
                    >
                      <Edit2 size={16} />
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
              {courses.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    No se encontraron cursos creados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
