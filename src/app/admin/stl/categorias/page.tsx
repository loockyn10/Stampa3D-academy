import React from "react";
import Link from "next/link";
import { ArrowLeft, Tags } from "lucide-react";
import { StlCategoriesManager } from "@/components/admin/stl-categories-manager";

export default function AdminStlCategoriesPage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div>
        <Link
          href="/admin/stl"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-200 transition-colors"
        >
          <ArrowLeft size={14} /> Volver al panel STL
        </Link>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Tags className="text-indigo-600" />
          Grupos STL
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Administra los grupos que organizan la Librería STL: nombre, portada, orden y publicación.
        </p>
      </div>

      <StlCategoriesManager />
    </div>
  );
}
