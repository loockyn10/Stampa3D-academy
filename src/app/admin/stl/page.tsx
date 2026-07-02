import React from "react";
import Link from "next/link";
import { Boxes, Tags, Box } from "lucide-react";

export default function AdminStlDashboardPage() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Link href="/admin" className="text-sm font-medium text-emerald-600 hover:text-emerald-500">
            Admin
          </Link>
          <span className="text-gray-400">/</span>
          <span className="text-sm text-gray-500">STL</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Boxes className="text-emerald-600" />
          Administración de Librería STL
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Gestiona las categorías, modelos 3D y variantes disponibles en la plataforma.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href="/admin/stl/categorias" className="block">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer h-full">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
                <Tags size={24} />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Categorías</h2>
            </div>
            <p className="text-sm text-gray-600">
              Administra las categorías principales de la librería STL (ej. Funcionales, Macetas).
            </p>
          </div>
        </Link>
        
        <Link href="/admin/stl/modelos" className="block">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer h-full">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
                <Box size={24} /> {/* Placeholder icon */}
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Modelos y Variantes</h2>
            </div>
            <p className="text-sm text-gray-600">
              Crea nuevos modelos 3D y gestiona las distintas variantes o archivos asociados a cada uno.
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
