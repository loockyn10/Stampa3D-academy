import React, { use } from "react";
import Link from "next/link";
import { ArrowLeft, Box } from "lucide-react";
import { StlModelForm } from "@/components/admin/stl-model-form";
import { StlVariantsManager } from "@/components/admin/stl-variants-manager";

interface EditModelPageProps {
  params: Promise<{ id: string }>;
}

export default function EditStlModelPage({ params }: EditModelPageProps) {
  const { id } = use(params);

  if (!id || id === "undefined") {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <Link href="/admin/stl/modelos" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft size={14} /> Volver a Modelos
        </Link>
        <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-100 text-sm">
          ID de modelo no válido o no especificado.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div>
        <Link
          href="/admin/stl/modelos"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={14} /> Volver a Modelos
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Box className="text-emerald-600" />
          Editar Modelo STL
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Actualiza la información del modelo y gestiona sus variantes.
        </p>
      </div>

      <StlModelForm modelId={id} />
      
      <div className="border-t border-gray-200 pt-8 mt-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Variantes del Modelo</h2>
        <p className="text-sm text-gray-500 mb-6">
          Añade o edita los distintos archivos y especificaciones de este modelo 3D.
        </p>
        <StlVariantsManager modelId={id} />
      </div>
    </div>
  );
}
