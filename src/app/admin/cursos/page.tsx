import React from "react";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { CoursesTable } from "@/components/admin/courses-table";

export default function AdminCursosPage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link href="/admin" className="text-sm font-medium text-blue-600 hover:text-blue-500">
              Admin
            </Link>
            <span className="text-gray-400">/</span>
            <span className="text-sm text-gray-500">Cursos</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="text-blue-600" />
            Gestión de Cursos
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Crea y administra los cursos de la plataforma.
          </p>
        </div>
        
        <Link 
          href="/admin/cursos/nuevo" 
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={18} />
          Nuevo Curso
        </Link>
      </div>

      <CoursesTable />
    </div>
  );
}
