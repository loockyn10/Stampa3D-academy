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
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div>
        <Link
          href="/admin/cursos"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={14} /> Volver a cursos
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Edit className="text-blue-600" />
          Editar Curso
        </h1>
      </div>

      <CourseForm courseId={id} />

      <ModulesManager courseId={id} />
    </div>
  );
}
