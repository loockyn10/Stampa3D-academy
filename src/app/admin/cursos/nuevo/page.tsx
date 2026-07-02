import React from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { CourseForm } from "@/components/admin/course-form";

export default function AdminNuevoCursoPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <Link
          href="/admin/cursos"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={14} /> Volver a cursos
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BookOpen className="text-blue-600" />
          Crear Nuevo Curso
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Completa los datos principales del curso. Los módulos y clases se configuran después de crearlo.
        </p>
      </div>

      <CourseForm />
    </div>
  );
}
