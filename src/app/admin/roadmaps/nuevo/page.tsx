import React from "react";
import Link from "next/link";
import { ArrowLeft, Map } from "lucide-react";
import { RoadmapForm } from "@/components/admin/RoadmapForm";

export default function NuevoRoadmapPage() {
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
            <Map className="text-pink-500" /> Nuevo Roadmap
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Configurá una nueva ruta de aprendizaje condicional.
          </p>
        </div>
      </div>

      <RoadmapForm />
    </div>
  );
}
