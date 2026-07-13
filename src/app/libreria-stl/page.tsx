"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Search, Boxes, ArrowLeft, Download, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/utils/supabase/client";
import { getFileAccessUrl } from "@/lib/storage";

export default function LibreriaStlPage() {
  const supabase = createClient();
  const [categories, setCategories] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [catsRes, modelsRes, varsRes] = await Promise.all([
      supabase.from("stl_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("stl_models").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("stl_variants").select("*").eq("is_active", true).order("sort_order")
    ]);
    
    if (catsRes.data) setCategories(catsRes.data);
    if (modelsRes.data) setModels(modelsRes.data);
    if (varsRes.data) setVariants(varsRes.data);
    setLoading(false);
  };

  // Group models and variants to display. 
  // For each variant, we want to show it as a downloadable item, linked to its model's category.
  const allStlItems = useMemo(() => {
    return variants.map(variant => {
      const model = models.find(m => m.id === variant.model_id);
      return {
        ...variant,
        model_name: model?.name || "Modelo Desconocido",
        category_id: model?.category_id
      };
    });
  }, [models, variants]);

  const filteredItems = useMemo(() => {
    let f = allStlItems;
    if (selectedCatId) f = f.filter((s) => s.category_id === selectedCatId);
    if (query) f = f.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()) || s.model_name.toLowerCase().includes(query.toLowerCase()));
    return f;
  }, [allStlItems, selectedCatId, query]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!selectedCatId && !query) {
    return (
      <div>
        <SectionTitle eyebrow="Plataforma" title="Librería STL" />
        {categories.length === 0 ? (
          <EmptyState icon={Boxes} title="Aún no hay categorías" hint="Vuelve pronto para descubrir nuevos modelos." />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((c) => {
              const count = allStlItems.filter(item => item.category_id === c.id).length;
              return (
                <Card key={c.id} onClick={() => setSelectedCatId(c.id)} className="p-5 text-center cursor-pointer hover:-translate-y-0.5 hover:shadow-md transition-all">
                  <div className="mb-2 flex justify-center">
                    {c.thumbnail_url ? (
                      <img src={c.thumbnail_url} alt={c.name} className="h-16 w-16 object-cover rounded-xl" />
                    ) : (
                      <div className="h-16 w-16 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400">
                        <Boxes size={32} />
                      </div>
                    )}
                  </div>
                  <p className="text-sm font-bold text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-400">{count} archivos</p>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const catInfo = categories.find((c) => c.id === selectedCatId);
  const title = catInfo ? catInfo.name : query ? `Búsqueda: ${query}` : "Librería STL";

  const translateDifficulty = (diff: string) => {
    if (diff === "easy") return "Fácil";
    if (diff === "medium") return "Medio";
    if (diff === "hard") return "Difícil";
    return diff;
  };

  return (
    <div>
      <button
        onClick={() => {
          setSelectedCatId(null);
          setQuery("");
        }}
        className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
      >
        <ArrowLeft size={14} /> Todas las categorías
      </button>
      <SectionTitle eyebrow="Librería STL" title={title} />

      <div className="relative mb-5 max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar modelos..."
          className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-100 transition-all"
        />
      </div>

      {filteredItems.length === 0 ? (
        <EmptyState icon={Boxes} title="No encontramos modelos" hint="Prueba con otra búsqueda o categoría." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredItems.map((f) => (
            <Card key={f.id} className="overflow-hidden p-0 flex flex-col h-full">
              <div className="relative flex h-36 items-center justify-center bg-gray-50">
                {f.thumbnail_url ? (
                  <img src={f.thumbnail_url} alt={f.name} className="w-full h-full object-cover" />
                ) : (
                  <Boxes size={48} className="text-gray-300" />
                )}
                <div className="absolute right-2 top-2">
                  <Badge tone="dark">{translateDifficulty(f.difficulty)}</Badge>
                </div>
              </div>
              <div className="p-4 flex flex-col flex-1">
                <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wider mb-1 truncate">{f.model_name}</p>
                <p className="font-bold text-gray-900 text-sm leading-tight mb-2 line-clamp-2">{f.name}</p>
                <div className="mt-auto space-y-1 mb-3">
                  <p className="text-xs text-gray-500 flex justify-between"><span>Material:</span> <span className="font-medium text-gray-700">{f.material_recommended || "N/A"}</span></p>
                  <p className="text-xs text-gray-500 flex justify-between"><span>Tiempo:</span> <span className="font-medium text-gray-700">{f.estimated_print_time_minutes} min</span></p>
                  <p className="text-xs text-gray-500 flex justify-between"><span>Peso:</span> <span className="font-medium text-gray-700">{f.estimated_weight_grams} g</span></p>
                </div>
                <button 
                  onClick={async (e) => {
                    e.preventDefault();
                    if (!f.file_url) return;
                    
                    const { data: { user } } = await supabase.auth.getUser();
                    if (user) {
                      await supabase.from("stl_downloads").upsert({
                        user_id: user.id,
                        variant_id: f.id
                      }, { onConflict: 'user_id, variant_id' });
                    }
                    
                    try {
                      const accessUrl = await getFileAccessUrl(supabase, f.file_url);
                      if (accessUrl) {
                        window.open(accessUrl, "_blank");
                      }
                    } catch (e) {
                      console.error("Error al abrir archivo STL:", e);
                    }
                  }}
                  className="mt-auto flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-900 py-2.5 text-xs font-semibold text-white hover:bg-gray-800 transition-colors"
                >
                  <Download size={14} /> Descargar
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
