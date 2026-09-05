"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { CourseCard } from "@/components/cards/course-card";
import { Loader2, PenTool } from "lucide-react";
import Link from "next/link";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";

export default function TalleresPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      const { data, error: fetchErr } = await supabase
        .from("courses")
        .select(`
          *,
          instructors ( name ),
          course_modules (
            lessons ( id, duration_minutes )
          )
        `)
        .eq("status", "published")
        .eq("course_kind", "workshop")
        .order("sort_order", { ascending: true });

      if (fetchErr) {
        console.error("Error fetching courses:", fetchErr);
        setError(fetchErr.message);
      } else if (data) {
        setCourses(data);
      }
      
      setLoading(false);
    };

    fetchData();
  }, [supabase]);

  const filteredCourses = useMemo(() => courses.filter((c) => {
    const term = searchTerm.toLowerCase();
    return (
      (c.title || "").toLowerCase().includes(term) ||
      (c.description || "").toLowerCase().includes(term) ||
      (c.level || "").toLowerCase().includes(term) ||
      (c.slug || "").toLowerCase().includes(term) ||
      (c.instructors?.name || "").toLowerCase().includes(term)
    );
  }), [courses, searchTerm]);

  const stampyScreenContext = useMemo<StampyScreenContext>(() => ({
    page: { section: "workshops", route: "/talleres", title: "Talleres" },
    mode: "browse",
    visibleEntities: filteredCourses.slice(0, 20).map((workshop, index) => ({
      type: "workshop",
      id: String(workshop.id),
      name: workshop.title,
      position: index + 1,
      facts: workshop.level ? [{ label: "Nivel visible", value: String(workshop.level) }] : [],
    })),
    pageData: {
      kind: "pageFacts",
      facts: [
        { label: "Talleres publicados", value: courses.length },
        { label: "Talleres visibles con el filtro actual", value: filteredCourses.length },
      ],
    },
    uiState: {
      loading,
      ...(searchTerm ? { searchQuery: searchTerm } : {}),
    },
  }), [courses.length, filteredCourses, loading, searchTerm]);

  usePublishStampyScreenContext(stampyScreenContext);

  return (
    <div className="space-y-8 pb-10">
      {/* Header Premium & Buscador Integrado */}
      <div className="bg-stampa-surface border border-stampa-border rounded-2xl p-6 sm:p-8 flex flex-col gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 mb-4 justify-between">
              <Link 
                href="/academia"
                className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-wider rounded-full transition-colors hover:bg-blue-500/20"
              >
                ← Academia
              </Link>
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-2 flex items-center gap-3">
              <PenTool size={36} className="text-blue-500" /> Talleres
            </h1>
            <p className="text-sm text-gray-400">
              Proyectos prácticos para aplicar lo aprendido y crear productos reales.
            </p>
          </div>
          
          <div className="w-full md:w-80 shrink-0">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
              </svg>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar talleres..."
                className="w-full bg-stampa-bg-soft border border-stampa-border text-white text-sm rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white text-xs font-semibold"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-sm text-red-400">
          Error al cargar los talleres: {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-blue-500 h-10 w-10" />
        </div>
      ) : courses.length > 0 ? (
        <div>
          {filteredCourses.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCourses.map((c) => (
                <CourseCard key={c.id} course={c} />
              ))}
            </div>
          ) : (
            <div className="bg-stampa-surface border border-stampa-border p-8 rounded-xl text-center">
              <p className="text-gray-400 mb-4">No encontramos talleres con esa búsqueda.</p>
              <button
                onClick={() => setSearchTerm("")}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-stampa-border rounded-lg text-sm text-white transition-colors"
              >
                Limpiar búsqueda
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="max-w-xl mx-auto mt-12 text-center">
          <div className="bg-stampa-surface rounded-3xl p-10 border border-stampa-border shadow-xl">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
              <PenTool size={40} className="text-gray-500" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">Todavía no hay talleres publicados</h2>
            <p className="text-gray-400 mb-6">
              Cuando carguemos proyectos prácticos, van a aparecer acá.
            </p>
            <Link 
              href="/academia"
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors shadow-lg"
            >
              Volver a Academia
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
