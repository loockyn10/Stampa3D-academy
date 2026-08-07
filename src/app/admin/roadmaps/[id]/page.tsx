"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Map, Loader2 } from "lucide-react";
import { RoadmapForm } from "@/components/admin/RoadmapForm";
import { createClient } from "@/utils/supabase/client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditarRoadmapPage({ params }: PageProps) {
  const { id } = use(params);
  const [roadmap, setRoadmap] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchRoadmap = async () => {
      const { data, error } = await supabase
        .from("learning_paths")
        .select(`
          *,
          learning_path_courses (*)
        `)
        .eq("id", id)
        .single();
      
      if (data) {
        // order learning_path_courses by sort_order
        if (data.learning_path_courses) {
          data.learning_path_courses.sort((a: any, b: any) => a.sort_order - b.sort_order);
        }
        setRoadmap(data);
      }
      setLoading(false);
    };

    fetchRoadmap();
  }, [id, supabase]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin text-pink-500 w-8 h-8" />
      </div>
    );
  }

  if (!roadmap) {
    return (
      <div className="text-center py-20 text-gray-400">
        Roadmap no encontrado.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link 
          href="/admin/roadmaps"
          className="p-2 bg-[#111] border border-white/10 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-all"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Map className="text-pink-500" /> Editar Roadmap
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Modificá la configuración y los cursos de esta ruta.
          </p>
        </div>
      </div>

      <RoadmapForm initialData={roadmap} />
    </div>
  );
}
