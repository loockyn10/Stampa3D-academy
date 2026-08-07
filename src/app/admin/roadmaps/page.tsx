import React from "react";
import Link from "next/link";
import { Map, Plus } from "lucide-react";
import { RoadmapsTable } from "@/components/admin/roadmaps-table";

export default function AdminRoadmapsPage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link href="/admin" className="text-sm font-medium text-blue-400 hover:text-blue-500">
              Admin
            </Link>
            <span className="text-gray-400">/</span>
            <span className="text-sm text-gray-500">Roadmaps</span>
          </div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Map className="text-pink-500" />
            Gestión de Roadmaps
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Configurá rutas recomendadas según impresora, nivel y objetivo.
          </p>
        </div>
        
        <Link 
          href="/admin/roadmaps/nuevo" 
          className="inline-flex items-center gap-2 bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={18} />
          Nuevo Roadmap
        </Link>
      </div>

      <RoadmapsTable />
    </div>
  );
}
