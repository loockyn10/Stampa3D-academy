import React, { use } from "react";
import Link from "next/link";
import { ArrowLeft, Edit } from "lucide-react";
import { CourseForm } from "@/components/admin/course-form";
import { ModulesManager } from "@/components/admin/modules-manager";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function AdminCursoEditPage({ params }: PageProps) {
  const { id } = use(params);

  return (
    <div className="@container">
      <div className="mx-auto max-w-4xl space-y-8 pb-12 @7xl:max-w-none">
        <div>
          <Link
            href="/admin/cursos"
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-200 transition-colors"
          >
            <ArrowLeft size={14} /> Volver a cursos
          </Link>
          <h1 className="text-2xl font-bold text-fg flex items-center gap-2">
            <Edit className="text-blue-400" />
            Editar Curso
          </h1>
        </div>

        {/* Con espacio (≥ 80rem útiles) los datos del curso y sus módulos se editan lado a lado. */}
        <div className="grid grid-cols-1 gap-8 @7xl:grid-cols-2 @7xl:items-start">
          <CourseForm courseId={id} />
          <ModulesManager courseId={id} />
        </div>
      </div>
    </div>
  );
}
