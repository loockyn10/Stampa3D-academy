import React from "react";
import Link from "next/link";
import { ArrowLeft, Settings2 } from "lucide-react";
import { ConfigManager } from "@/components/admin/config-manager";

export default function AdminConfigCursosPage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div>
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={14} /> Volver al admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings2 className="text-blue-600" />
          Configuración de Cursos
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Administra las categorías de los cursos y los instructores disponibles en la plataforma.
        </p>
      </div>

      <ConfigManager />
    </div>
  );
}
