"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Edit2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export function StlModelsTable() {
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    
    const { data, error: fetchError } = await supabase
      .from("stl_models")
      .select(`
        *,
        stl_categories ( name )
      `)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setModels(data || []);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-500">
                <th className="px-4 py-3">Miniatura</th>
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Categoría</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {models.map((model) => (
                <tr key={model.id} className="text-sm hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    {model.thumbnail_url ? (
                      <img src={model.thumbnail_url} alt={model.title} className="w-10 h-10 rounded object-cover" />
                    ) : (
                      <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center text-gray-400 text-xs">Sin img</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {model.title}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {model.stl_categories?.name || "Sin categoría"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={model.is_active ? "green" : "dark"}>
                      {model.is_active ? "Activo" : "Inactivo"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Intl.DateTimeFormat("es-AR", { dateStyle: "short" }).format(new Date(model.created_at))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/stl/modelos/${model.id}`}
                      className="inline-flex items-center gap-1.5 text-emerald-600 hover:text-emerald-800 font-medium"
                    >
                      <Edit2 size={16} />
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
              {models.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No hay modelos creados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
