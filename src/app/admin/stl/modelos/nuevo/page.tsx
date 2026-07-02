import React from "react";
import Link from "next/link";
import { ArrowLeft, Box } from "lucide-react";
import { StlModelForm } from "@/components/admin/stl-model-form";

export default function NuevoStlModelPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <div>
        <Link
          href="/admin/stl/modelos"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={14} /> Volver a Modelos
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Box className="text-emerald-600" />
          Nuevo Modelo STL
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Crea la información base de un modelo 3D.
        </p>
      </div>

      <StlModelForm />
    </div>
  );
}
