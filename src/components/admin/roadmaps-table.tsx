"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Edit, Loader2, CheckCircle2, XCircle, Star } from "lucide-react";
import Link from "next/link";
import { 
  formatPrinterBrandLabel, 
  formatExperienceLevelLabel, 
  formatMainGoalLabel,
  formatCommercialStageLabel
} from "@/lib/learning-roadmaps";

export function RoadmapsTable() {
  const [roadmaps, setRoadmaps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchRoadmaps = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("learning_paths")
        .select(`
          *,
          learning_path_courses (count)
        `)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      
      if (data) {
        setRoadmaps(data);
      }
      setLoading(false);
    };

    fetchRoadmaps();
  }, [supabase]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20 bg-[#111] rounded-2xl border border-white/5">
        <Loader2 className="animate-spin text-pink-500 w-8 h-8" />
      </div>
    );
  }

  if (roadmaps.length === 0) {
    return (
      <div className="text-center py-16 bg-[#111] rounded-2xl border border-white/5 shadow-lg">
        <p className="text-gray-400 font-medium">Todavía no creaste roadmaps.</p>
        <Link 
          href="/admin/roadmaps/nuevo" 
          className="mt-4 inline-block text-pink-500 hover:text-pink-400 font-medium"
        >
          Crear el primero
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-[#111] rounded-2xl border border-white/5 shadow-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left border-collapse">
          <thead>
            <tr className="bg-[#1a1a1a] border-b border-white/5 text-xs uppercase tracking-wider text-gray-500">
              <th className="px-6 py-4 font-bold">Roadmap</th>
              <th className="px-6 py-4 font-bold">Filtros</th>
              <th className="px-6 py-4 font-bold">Cursos</th>
              <th className="px-6 py-4 font-bold">Estado</th>
              <th className="px-6 py-4 font-bold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {roadmaps.map((r) => (
              <tr key={r.id} className="hover:bg-white/[0.02] transition-colors group">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    {r.is_default && (
                      <Star className="text-amber-500" size={16} fill="currentColor" />
                    )}
                    <span className="font-bold text-white block">{r.name}</span>
                  </div>
                  <span className="text-xs text-gray-500 block truncate max-w-xs">{r.description}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs px-2 py-0.5 bg-white/5 rounded text-gray-300 w-fit">
                      <span className="text-gray-500 mr-1">Marca:</span> {formatPrinterBrandLabel(r.printer_brand)}
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-white/5 rounded text-gray-300 w-fit">
                      <span className="text-gray-500 mr-1">Nivel:</span> {formatExperienceLevelLabel(r.experience_level)}
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-white/5 rounded text-gray-300 w-fit">
                      <span className="text-gray-500 mr-1">Objetivo:</span> {formatMainGoalLabel(r.main_goal)}
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-white/5 rounded text-gray-300 w-fit">
                      <span className="text-gray-500 mr-1">Etapa:</span> {formatCommercialStageLabel(r.commercial_stage)}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-400 font-medium">
                  {r.learning_path_courses[0]?.count || 0} cursos
                </td>
                <td className="px-6 py-4">
                  {r.is_active ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold">
                      <CheckCircle2 size={12} /> Activo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-bold">
                      <XCircle size={12} /> Inactivo
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <Link 
                    href={`/admin/roadmaps/${r.id}`}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                  >
                    <Edit size={16} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
