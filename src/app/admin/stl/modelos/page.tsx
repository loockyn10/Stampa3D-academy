import React from "react";
import Link from "next/link";
import { Box, Plus, ArrowLeft } from "lucide-react";
import { StlModelsTable } from "@/components/admin/stl-models-table";

export default function AdminStlModelsPage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Link
            href="/admin/stl"
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={14} /> Volver al panel STL
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Box className="text-emerald-600" />
            Modelos STL
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Gestiona los modelos 3D y sus variantes de la librería.
          </p>
        </div>
        
        <Link 
          href="/admin/stl/modelos/nuevo" 
          className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={18} />
          Nuevo Modelo
        </Link>
      </div>

      <StlModelsTable />
    </div>
  );
}
