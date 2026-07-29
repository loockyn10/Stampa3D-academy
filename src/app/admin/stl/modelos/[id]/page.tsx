import React, { use } from "react";
import Link from "next/link";
import { ArrowLeft, Box } from "lucide-react";
import { StlModelForm } from "@/components/admin/stl-model-form";

interface EditModelPageProps {
  params: Promise<{ id: string }>;
}

export default function EditStlModelPage({ params }: EditModelPageProps) {
  const { id } = use(params);

  if (!id || id === "undefined") {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <Link href="/admin/stl/modelos" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-200 transition-colors">
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
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-200 transition-colors"
        >
          <ArrowLeft size={14} /> Volver a Modelos
        </Link>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Box className="text-emerald-600" />
          Editar Archivo STL
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Actualiza la información y el contenido del archivo STL.
        </p>
      </div>

      <StlModelForm modelId={id} />
    </div>
  );
}
