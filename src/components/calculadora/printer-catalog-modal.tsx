"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Search, Loader2, Printer } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

interface PrinterCatalogModalProps {
  onClose: () => void;
  onSelect: (printerId: string) => void;
  userId: string;
}

export function PrinterCatalogModal({ onClose, onSelect, userId }: PrinterCatalogModalProps) {
  const supabase = createClient();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [importingId, setImportingId] = useState<string | null>(null);
  const [userPrinters, setUserPrinters] = useState<any[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetchTemplates();
    fetchUserPrinters();
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted]);

  const fetchUserPrinters = async () => {
    const { data } = await supabase
      .from("printers")
      .select("id, source_template_id, is_active")
      .eq("user_id", userId);
    setUserPrinters(data || []);
  };

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("printer_templates")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("brand", { ascending: true });

    if (error) {
      setError(error.message);
    } else {
      setTemplates(data || []);
    }
    setLoading(false);
  };

  const handleSelect = async (template: any) => {
    setImportingId(template.id);
    setError(null);

    try {
      const existing = userPrinters.find(p => p.source_template_id === template.id);

      if (existing) {
        if (existing.is_active) {
          alert("Impresora seleccionada.");
          onSelect(existing.id);
          return;
        } else {
          // Reactivate
          const { error: updateError } = await supabase
            .from("printers")
            .update({ is_active: true, updated_at: new Date().toISOString() })
            .eq("id", existing.id);
            
          if (updateError) throw updateError;
          alert("Impresora agregada a la calculadora.");
          onSelect(existing.id);
          return;
        }
      }

      // Insert new printer mapped from template
      const payload = {
        user_id: userId,
        name: template.name,
        power_watts: template.power_watts,
        maintenance_cost_per_hour: template.maintenance_cost_per_hour,
        source_template_id: template.id,
        is_active: true,
      };

      const { data: newPrinter, error: insertError } = await supabase
        .from("printers")
        .insert([payload])
        .select("id")
        .single();

      if (insertError) throw insertError;

      if (newPrinter) {
        alert("Impresora agregada a tu taller.");
        onSelect(newPrinter.id);
      }
    } catch (err: any) {
      console.error("Error importing printer:", err);
      setError("No se pudo importar la impresora.");
      setImportingId(null);
    }
  };

  const handleRemove = async (templateId: string) => {
    const existing = userPrinters.find(p => p.source_template_id === templateId);
    if (!existing) return;
    
    setImportingId(templateId);
    try {
      const { error: updateError } = await supabase
        .from("printers")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
        
      if (updateError) throw updateError;
      
      alert("Impresora quitada de la calculadora.");
      await fetchUserPrinters();
      onSelect(""); // Signal parent to refresh but not close
    } catch (err: any) {
      console.error("Error removing printer:", err);
      setError("No se pudo quitar la impresora.");
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
      (t.model || "").toLowerCase().includes(term)
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
              <Printer size={20} className="text-stampa-orange" /> Catálogo de Impresoras
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1" disabled={!!importingId}>
              <X size={20} />
            </button>
          </div>
          
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input 
              type="text" 
              placeholder="Buscar por marca o modelo..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-stampa-surface border border-stampa-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white outline-none focus:border-stampa-orange focus:ring-1 focus:ring-stampa-orange/50 transition-all"
            />
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 max-h-[calc(90dvh-120px)]">
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
              <Printer size={48} className="text-gray-600 mb-4 opacity-50" />
              <p className="text-white font-medium mb-1">No hay impresoras disponibles en el catálogo por ahora.</p>
              <p className="text-sm text-gray-500">Puedes cerrar este panel y cargar una manualmente en Configuración.</p>
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              No se encontraron resultados para "{search}"
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredTemplates.map((t) => {
                const existing = userPrinters.find(p => p.source_template_id === t.id);
                const isAdded = existing && existing.is_active;
                const isHidden = existing && !existing.is_active;

                return (
                  <div 
                    key={t.id} 
                    className={`bg-stampa-bg border hover:border-stampa-orange/50 rounded-xl p-4 flex flex-col justify-between transition-all group ${isAdded ? 'border-stampa-orange/30 shadow-[0_0_15px_rgba(255,106,0,0.05)]' : 'border-stampa-border'}`}
                  >
                    <div>
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="font-bold text-white text-base leading-tight pr-2">{t.name}</h4>
                        {isAdded && (
                          <span className="shrink-0 bg-stampa-orange/20 text-stampa-orange text-[10px] font-bold px-2 py-0.5 rounded-full border border-stampa-orange/20">
                            Agregada
                          </span>
                        )}
                        {isHidden && (
                          <span className="shrink-0 bg-gray-500/20 text-gray-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-500/20">
                            Oculta
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-stampa-orange font-medium mb-3">{t.brand} {t.model !== t.name && `- ${t.model}`}</p>
                      
                      <div className="space-y-1 mb-4">
                        <p className="text-xs text-gray-400 flex justify-between">
                          <span>Consumo:</span>
                          <span className="text-gray-300 font-medium">{t.power_watts}W</span>
                        </p>
                        <p className="text-xs text-gray-400 flex justify-between">
                          <span>Mantenimiento:</span>
                          <span className="text-gray-300 font-medium">${t.maintenance_cost_per_hour}/h</span>
                        </p>
                        {t.printer_type && (
                          <p className="text-xs text-gray-400 flex justify-between">
                            <span>Tipo:</span>
                            <span className="text-gray-300 font-medium">{t.printer_type}</span>
                          </p>
                        )}
                        {t.bed_size_x_mm && t.bed_size_y_mm && t.bed_size_z_mm && (
                          <p className="text-xs text-gray-400 flex justify-between">
                            <span>Volumen:</span>
                            <span className="text-gray-300 font-medium">{t.bed_size_x_mm}x{t.bed_size_y_mm}x{t.bed_size_z_mm} mm</span>
                          </p>
                        )}
                      </div>
                    </div>
                    
                    {isAdded ? (
                      <button 
                        onClick={() => handleRemove(t.id)}
                        disabled={!!importingId}
                        className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg border border-red-500/20 hover:border-red-500/30 transition-all flex items-center justify-center gap-2"
                      >
                        {importingId === t.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          "Quitar"
                        )}
                      </button>
                    ) : (
                      <button 
                        onClick={() => handleSelect(t)}
                        disabled={!!importingId}
                        className="w-full py-2 bg-white/5 hover:bg-stampa-orange text-white text-xs font-bold rounded-lg border border-stampa-border hover:border-transparent transition-all flex items-center justify-center gap-2"
                      >
                        {importingId === t.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          "Seleccionar"
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
