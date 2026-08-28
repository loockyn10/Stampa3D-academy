"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Search, Loader2, Package, Check, Plus } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

interface FilamentCatalogModalProps {
  onClose: () => void;
  onSelect?: (filamentId: string) => void; // Kept for backwards compatibility if needed
  onImported?: (importedFilaments: any[]) => void;
  mode?: "single" | "multiple";
  userId: string;
}

export function FilamentCatalogModal({ onClose, onSelect, onImported, mode = "single", userId }: FilamentCatalogModalProps) {
  const supabase = createClient();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [importingId, setImportingId] = useState<string | null>(null);
  const [userFilaments, setUserFilaments] = useState<any[]>([]);
  const [mounted, setMounted] = useState(false);
  
  // Multi-select state
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [isBulkImporting, setIsBulkImporting] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetchTemplates();
    fetchUserFilaments();
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted]);

  const fetchUserFilaments = async () => {
    const { data } = await supabase
      .from("filaments")
      .select("id, source_template_id, is_active")
      .eq("user_id", userId);
    setUserFilaments(data || []);
  };

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("filament_templates")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      setError(error.message);
    } else {
      setTemplates(data || []);
    }
    setLoading(false);
  };

  const toggleSelection = (templateId: string) => {
    if (mode === "single") return; // Handled directly by handleSelect
    
    setSelectedTemplateIds(prev => 
      prev.includes(templateId) 
        ? prev.filter(id => id !== templateId)
        : [...prev, templateId]
    );
  };

  // Helper to build safe display name
  const buildDisplayName = (template: any) => {
    return [
      template.filament_type,
      template.brand,
      template.name
    ].filter(Boolean).join(" ");
  };

  // The original single select function
  const handleSelect = async (template: any) => {
    if (mode === "multiple") {
      toggleSelection(template.id);
      return;
    }

    setImportingId(template.id);
    setError(null);

    try {
      const existing = userFilaments.find(p => p.source_template_id === template.id);

      if (existing) {
        if (existing.is_active) {
          onSelect?.(existing.id);
          return;
        } else {
          // Reactivate
          const { error: updateError } = await supabase
            .from("filaments")
            .update({ is_active: true })
            .eq("id", existing.id);

          if (updateError) throw updateError;
          onSelect?.(existing.id);
          return;
        }
      }

      const payload = {
        user_id: userId,
        brand: template.brand || null,
        name: template.name || null,
        filament_type: template.filament_type,
        color: template.color || null,
        color_hex: template.color_hex || null,
        total_grams: template.default_total_grams,
        remaining_grams: template.default_total_grams,
        purchase_price: template.default_purchase_price,
        is_active: true,
        source_template_id: template.id,
      };

      const { data: newFilament, error: insertError } = await supabase
        .from("filaments")
        .insert([payload])
        .select("id")
        .single();

      if (insertError) throw insertError;

      if (newFilament) {
        onSelect?.(newFilament.id);
      }
    } catch (err: any) {
      console.error("Error importing filament:", err);
      setError("No se pudo importar el filamento.");
    } finally {
      setImportingId(null);
    }
  };

  // New bulk import logic
  const handleBulkImport = async () => {
    if (selectedTemplateIds.length === 0) return;
    
    setIsBulkImporting(true);
    setError(null);
    
    try {
      const importedFilaments: any[] = [];
      for (const tId of selectedTemplateIds) {
        const template = templates.find(t => t.id === tId);
        if (!template) continue;
        
        const existing = userFilaments.find(p => p.source_template_id === template.id);
        
        if (existing) {
          if (!existing.is_active) {
            // Reactivate
            const { data, error: updateError } = await supabase
              .from("filaments")
              .update({ is_active: true })
              .eq("id", existing.id)
              .select()
              .single();
              
            if (updateError) throw updateError;
            importedFilaments.push(data);
          } else {
            // Already active, just push it (though UI prevents selecting it)
            importedFilaments.push(existing);
          }
        } else {
          // Insert new
          const payload = {
            user_id: userId,
            brand: template.brand || null,
            name: template.name || null,
            filament_type: template.filament_type,
            color: template.color || null,
            color_hex: template.color_hex || null,
            total_grams: template.default_total_grams,
            remaining_grams: template.default_total_grams,
            purchase_price: template.default_purchase_price,
            is_active: true,
            source_template_id: template.id,
          };

          const { data, error: insertError } = await supabase
            .from("filaments")
            .insert([payload])
            .select()
            .single();

          if (insertError) throw insertError;
          importedFilaments.push(data);
        }
      }
      
      // Notify parent
      onImported?.(importedFilaments);
      onClose(); // Multiple mode bulk import closes the modal explicitly
      
    } catch (err: any) {
      console.error("Error bulk importing filaments:", err);
      setError("Ocurrió un error al importar los filamentos seleccionados.");
    } finally {
      setIsBulkImporting(false);
    }
  };

  const handleRemove = async (templateId: string) => {
    const existing = userFilaments.find(p => p.source_template_id === templateId);
    if (!existing) return;

    setImportingId(templateId);
    try {
      const { error: updateError } = await supabase
        .from("filaments")
        .update({ is_active: false })
        .eq("id", existing.id);

      if (updateError) throw updateError;

      await fetchUserFilaments();
      if (mode === "single") {
        onSelect?.(""); // Signal parent to refresh but not close
      } else {
        // In multiple mode, just refresh local state so it appears as "Oculto"
      }
    } catch (err: any) {
      console.error("Error removing filament:", err);
      setError("No se pudo quitar el filamento.");
    } finally {
      setImportingId(null);
    }
  };

  const filteredTemplates = templates.filter(t => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      (t.name || "").toLowerCase().includes(term) ||
      (t.brand || "").toLowerCase().includes(term) ||
      (t.filament_type || "").toLowerCase().includes(term) ||
      (t.color || "").toLowerCase().includes(term)
    );
  });

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="flex min-h-dvh items-start justify-center overflow-y-auto px-4 py-[5dvh]">
        <div
          className="bg-stampa-surface w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 shadow-2xl flex flex-col max-h-[90dvh] animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >

          {/* Header */}
          <div className="sticky top-0 z-10 flex flex-col gap-3 px-6 py-5 border-b border-white/10 bg-stampa-bg-soft shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Package size={20} className="text-stampa-orange" /> Catálogo de Filamentos
              </h3>
              <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1" disabled={!!importingId || isBulkImporting}>
                <X size={20} />
              </button>
            </div>

            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Buscar por marca, nombre, color o material..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-stampa-surface border border-stampa-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white outline-none focus:border-stampa-orange focus:ring-1 focus:ring-stampa-orange/50 transition-all"
              />
            </div>
          </div>

          {/* Content */}
          <div className="p-4 sm:p-6 overflow-y-auto stampa-scrollbar flex-1 pb-24">
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 text-red-400 text-sm border border-red-500/20 text-center">
                {error}
              </div>
            )}

            {loading ? (
              <div className="py-16 flex flex-col items-center justify-center gap-3">
                <Loader2 className="animate-spin text-stampa-orange h-8 w-8" />
                <p className="text-sm text-gray-400">Cargando catálogo...</p>
              </div>
            ) : templates.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-center">
                <Package size={48} className="text-gray-600 mb-4 opacity-50" />
                <p className="text-white font-medium mb-1">No hay filamentos disponibles en el catálogo por ahora.</p>
                <p className="text-sm text-gray-500">Puedes cerrar este panel y cargar uno manualmente en Configuración.</p>
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">
                No se encontraron resultados para "{search}"
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredTemplates.map((t) => {
                  const existing = userFilaments.find(p => p.source_template_id === t.id);
                  const isAdded = existing && existing.is_active;
                  const isHidden = existing && !existing.is_active;
                  const isSelected = selectedTemplateIds.includes(t.id);

                  return (
                    <div
                      key={t.id}
                      className={`bg-stampa-bg border rounded-xl p-4 flex flex-col justify-between transition-all group cursor-pointer ${
                        isAdded ? 'border-stampa-orange/30 shadow-[0_0_15px_rgba(255,106,0,0.05)]' : 
                        isSelected ? 'border-stampa-orange bg-stampa-orange/5' :
                        'border-stampa-border hover:border-stampa-orange/50'
                      }`}
                      onClick={() => {
                        if (!isAdded && mode === "multiple") {
                          toggleSelection(t.id);
                        }
                      }}
                    >
                      <div>
                        <div className="flex justify-between items-start mb-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2 flex-wrap">
                              {mode === "multiple" && !isAdded && (
                                <div className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                                  isSelected ? "bg-stampa-orange border-stampa-orange text-white" : "border-gray-500 text-transparent"
                                }`}>
                                  <Check size={14} />
                                </div>
                              )}
                              {t.color_hex && (
                                <span className="shrink-0 h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: t.color_hex }} />
                              )}
                              
                              {t.filament_type && (
                                <span className="text-xs font-semibold uppercase tracking-wide text-orange-400 shrink-0">
                                  {t.filament_type}
                                </span>
                              )}
                              
                              {t.brand && (
                                <span className="truncate text-sm font-medium text-white">
                                  {t.brand}
                                </span>
                              )}

                              {t.name && (
                                <span className="truncate text-sm font-medium text-white">
                                  {t.name}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0 flex flex-col gap-1 items-end pl-2">
                            {isAdded && (
                              <span className="bg-stampa-orange/20 text-stampa-orange text-[10px] font-bold px-2 py-0.5 rounded-full border border-stampa-orange/20">
                                Agregado
                              </span>
                            )}
                            {isHidden && (
                              <span className="bg-gray-500/20 text-gray-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-500/20">
                                Oculto
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-1 mb-4">
                          <p className="text-xs text-gray-400 flex justify-between">
                            <span>Color:</span>
                            <span className="text-gray-300 font-medium">{t.color || "-"}</span>
                          </p>
                          <p className="text-xs text-gray-400 flex justify-between">
                            <span>Cantidad p/ defecto:</span>
                            <span className="text-gray-300 font-medium">{t.default_total_grams}g</span>
                          </p>
                          <p className="text-xs text-gray-400 flex justify-between">
                            <span>Precio sugerido:</span>
                            <span className="text-gray-300 font-medium">${t.default_purchase_price}</span>
                          </p>
                        </div>
                      </div>

                      {isAdded ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemove(t.id);
                          }}
                          disabled={!!importingId || isBulkImporting}
                          className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg border border-red-500/20 hover:border-red-500/30 transition-all flex items-center justify-center gap-2"
                        >
                          {importingId === t.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            "Quitar"
                          )}
                        </button>
                      ) : (
                        mode === "single" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelect(t);
                            }}
                            disabled={!!importingId}
                            className="w-full py-2 bg-white/5 hover:bg-stampa-orange text-white text-xs font-bold rounded-lg border border-stampa-border hover:border-transparent transition-all flex items-center justify-center gap-2"
                          >
                            {importingId === t.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              "Seleccionar"
                            )}
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          
          {/* Footer for multiple selection */}
          {mode === "multiple" && !loading && (
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-stampa-bg-soft border-t border-white/10 backdrop-blur-md">
              <button
                onClick={handleBulkImport}
                disabled={selectedTemplateIds.length === 0 || isBulkImporting}
                className="w-full py-3 bg-stampa-orange hover:bg-orange-600 disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg"
              >
                {isBulkImporting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Procesando...
                  </>
                ) : (
                  <>
                    <Plus size={18} /> Agregar {selectedTemplateIds.length} {selectedTemplateIds.length === 1 ? 'filamento' : 'filamentos'}
                  </>
                )}
              </button>
            </div>
          )}
          
        </div>
      </div>
    </div>,
    document.body
  );
}
