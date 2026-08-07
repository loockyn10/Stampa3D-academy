"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Search, Boxes, ArrowLeft, Download, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import { EmptyState } from "@/components/ui/empty-state";
import { getFileAccessUrl } from "@/lib/storage";

import { createClient } from "@/utils/supabase/client";

export default function LibreriaStlPage() {
  const supabase = createClient();
  const [categories, setCategories] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [catsRes, modelsRes, varsRes] = await Promise.all([
        supabase.from("stl_categories").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("stl_models").select("*").eq("is_active", true).order("created_at", { ascending: false }),
        supabase.from("stl_variants").select("*").eq("is_active", true).order("created_at")
      ]);
      
      if (catsRes.error) console.error("Error cats:", catsRes.error);
      if (modelsRes.error) console.error("Error models:", modelsRes.error);
      if (varsRes.error) console.error("Error variants:", varsRes.error);

      if (catsRes.data) setCategories(catsRes.data);
      if (modelsRes.data) setModels(modelsRes.data);
      if (varsRes.data) setVariants(varsRes.data);
    } catch (err) {
      console.error("Error fetching STL data:", err);
    }
    setLoading(false);
  };

  const modelsWithData = useMemo(() => {
    return models.map(model => {
      const modelVariants = variants.filter(v => v.model_id === model.id);
      const category = categories.find(c => c.id === model.category_id) || null;
      return {
        ...model,
        category,
        variants: modelVariants
      };
    });
  }, [models, variants, categories]);

  const filteredItems = useMemo(() => {
    let f = modelsWithData;
    if (selectedCatId) f = f.filter((s) => s.category_id === selectedCatId);
    if (query) {
      f = f.filter((s) => 
        s.title.toLowerCase().includes(query.toLowerCase()) || 
        (s.category?.name || "").toLowerCase().includes(query.toLowerCase())
      );
    }
    console.log("categories", categories);
    console.log("models", models);
    console.log("selectedCategoryId", selectedCatId);
    console.log("filteredModels", f);
    return f;
  }, [modelsWithData, selectedCatId, query, categories, models]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  // Remove the early return.
  const translateDifficulty = (diff: string) => {
    if (diff === "beginner") return "Fácil";
    if (diff === "intermediate") return "Medio";
    if (diff === "advanced") return "Difícil";
    return diff;
  };

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* 1. Header Premium & Buscador Integrado */}
      <div className="bg-[#111] border border-white/10 rounded-2xl p-6 sm:p-8 flex flex-col gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/5 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 mb-4 justify-between">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] font-bold uppercase tracking-wider rounded-full">
                <span className="text-[10px]">✨</span> Recursos para miembros
              </div>

            </div>
            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-2">
              Librería STL
            </h1>
            <p className="text-sm text-gray-400">
              Encontrá modelos organizados por categorías y descargalos directo desde la plataforma listos para imprimir.
            </p>
          </div>
          
          <div className="w-full md:w-80 shrink-0">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar modelos, materiales..."
                className="w-full bg-[#0a0a0a] border border-white/10 text-white text-sm rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 2. Selector de Categorías (Chips) */}
      {!query && categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedCatId(null)}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all border ${
              selectedCatId === null 
                ? "bg-orange-500/10 border-orange-500/50 text-orange-400 shadow-[0_0_10px_rgba(255,106,0,0.1)]" 
                : "bg-[#0a0a0a] border-white/5 text-gray-400 hover:text-white hover:border-white/10"
            }`}
          >
            Todas
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCatId(c.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all border ${
                selectedCatId === c.id
                  ? "bg-orange-500/10 border-orange-500/50 text-orange-400 shadow-[0_0_10px_rgba(255,106,0,0.1)]"
                  : "bg-[#0a0a0a] border-white/5 text-gray-400 hover:text-white hover:border-white/10"
              }`}
            >
              {c.name}
              <span className={`px-1.5 py-0.5 rounded-md text-[9px] ${selectedCatId === c.id ? "bg-orange-500/20" : "bg-white/5"}`}>
                {models.filter(m => m.category_id === c.id).length}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 3. Cards de Archivos STL */}
      {filteredItems.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center bg-[#111] rounded-2xl border border-white/5 shadow-xl">
          <div className="w-16 h-16 bg-[#0a0a0a] rounded-2xl flex items-center justify-center mb-4 border border-white/10 shadow-inner">
            <span className="text-3xl grayscale opacity-50">📁</span>
          </div>
          <h3 className="text-xl font-bold text-white mb-2">
            {query ? "No hay resultados para tu búsqueda" : "No hay archivos en esta categoría"}
          </h3>
          <p className="text-sm text-gray-400 font-medium max-w-sm text-center mb-6">
            {query 
              ? "Intentá con otras palabras clave o revisá las categorías disponibles." 
              : "Cuando se carguen modelos, van a aparecer acá listos para descargar."}
          </p>
          {(query || selectedCatId) && (
            <button 
              onClick={() => { setQuery(""); setSelectedCatId(null); }}
              className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold rounded-lg transition-colors"
            >
              Ver todos los archivos
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredItems.map((f) => {
            const activeVariant = f.variants?.find((v: any) => v.is_active && v.file_url);
            const isDownloading = downloadingId === (activeVariant?.id || null);

            return (
              <Card key={f.id} className="group overflow-hidden bg-[#111] border border-white/10 hover:border-orange-500/30 hover:shadow-[0_0_20px_rgba(255,106,0,0.05)] transition-all flex flex-col h-full rounded-2xl">
                {/* Thumbnail */}
                <div className="relative flex h-48 items-center justify-center bg-[#0a0a0a] border-b border-white/5 overflow-hidden">
                  {f.thumbnail_url ? (
                    <img src={f.thumbnail_url} alt={f.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <Boxes size={48} className="text-gray-600" />
                  )}
                  {/* Badges Flotantes */}
                  <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
                    {f.difficulty && (
                      <span className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-black/60 backdrop-blur-md border border-white/10 text-white">
                        {translateDifficulty(f.difficulty)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Contenido */}
                <div className="p-5 flex flex-col flex-1">
                  <p className="text-[10px] font-bold text-orange-500 uppercase tracking-wider mb-1.5 truncate">
                    {f.category?.name || "Categoría General"}
                  </p>
                  <h3 className="font-bold text-white text-base leading-snug mb-3 line-clamp-2 group-hover:text-orange-100 transition-colors">
                    {f.title}
                  </h3>
                  
                  <div className="mt-auto grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-[#0a0a0a] rounded-lg p-2 border border-white/5">
                      <span className="block text-[10px] text-gray-500 font-medium mb-0.5">Material</span>
                      <span className="block text-xs text-white font-bold truncate">{f.material_type || "-"}</span>
                    </div>
                    <div className="bg-[#0a0a0a] rounded-lg p-2 border border-white/5">
                      <span className="block text-[10px] text-gray-500 font-medium mb-0.5">Tiempo Imp.</span>
                      <span className="block text-xs text-white font-bold truncate">{f.estimated_print_time || "-"}</span>
                    </div>
                  </div>
                  
                  {/* Botón de Acción */}
                  {activeVariant ? (
                    <button 
                      disabled={isDownloading}
                      onClick={async (e) => {
                        e.preventDefault();
                        setDownloadingId(activeVariant.id);
                        
                        try {
                          const { data: { user } } = await supabase.auth.getUser();
                          if (user) {
                            await supabase.from("stl_downloads").upsert({
                              user_id: user.id,
                              variant_id: activeVariant.id
                            }, { onConflict: 'user_id, variant_id' });
                          }
                          
                          const res = await fetch('/api/stl/download', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ variantId: activeVariant.id })
                          });
                          
                          const data = await res.json();
                          
                          if (res.ok && data.url) {
                            window.location.href = data.url;
                          } else {
                            alert(data.error || "No pude preparar la descarga. Probá de nuevo.");
                          }
                        } catch (e) {
                          console.error("Error al descargar STL:", e);
                          alert("Ocurrió un error inesperado al intentar descargar.");
                        } finally {
                          setDownloadingId(null);
                        }
                      }}
                      className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold transition-all shadow-lg ${
                        isDownloading 
                          ? 'bg-orange-500/50 text-white cursor-not-allowed shadow-none' 
                          : 'bg-orange-500 hover:bg-orange-600 text-white shadow-orange-500/20 hover:shadow-orange-500/40'
                      }`}
                    >
                      {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                      {isDownloading ? "Preparando..." : "Descargar Archivo"}
                    </button>
                  ) : (
                    <button 
                      disabled
                      className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold bg-[#0a0a0a] text-gray-600 border border-white/5 cursor-not-allowed"
                    >
                      Archivo no disponible
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 4. Bloque Informativo */}
      <div className="mt-8 bg-gradient-to-r from-[#111] to-[#151515] border border-white/10 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0a0a0a] rounded-xl flex items-center justify-center border border-white/5 shrink-0 shadow-inner">
            <span className="text-2xl">💡</span>
          </div>
          <div>
            <h4 className="font-bold text-white mb-1">Usá estos archivos como punto de partida</h4>
            <p className="text-sm text-gray-400">
              Descargá el archivo, revisá la configuración recomendada y adaptalo a tu impresora y material.
            </p>
          </div>
        </div>
        <a 
          href="/stampy"
          className="shrink-0 px-6 py-2.5 bg-[#0a0a0a] hover:bg-white/5 text-white text-sm font-bold rounded-xl border border-white/10 transition-colors shadow-sm"
        >
          Preguntarle a Stampy
        </a>
      </div>

    </div>
  );
}
