"use client";

import React, { useEffect, useRef } from "react";
import { Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { normalizeFilamentColor } from "@/lib/colors/filament-colors";

export function FilamentEditor({ formData, setFormData, onSave, onCancel }: any) {
  const lastColorTextRef = useRef(formData.color);

  useEffect(() => {
    // Si el texto del color cambia, intentamos autodetectar el hex
    if (formData.color !== lastColorTextRef.current) {
      lastColorTextRef.current = formData.color;
      const result = normalizeFilamentColor(formData.color || "");
      if (result.confidence !== "low") {
        setFormData((prev: any) => ({ ...prev, color_hex: result.hex }));
      } else if (!formData.color_hex) {
        setFormData((prev: any) => ({ ...prev, color_hex: result.hex }));
      }
    }
  }, [formData.color, formData.color_hex, setFormData]);

  // Si color_hex no está definido aún en la primera carga, lo inicializamos
  useEffect(() => {
    if (!formData.color_hex && formData.color) {
      const result = normalizeFilamentColor(formData.color);
      setFormData((prev: any) => ({ ...prev, color_hex: result.hex }));
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setFormData((prev: any) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setFormData((prev: any) => ({ ...prev, [name]: value }));
    }
  };

  const colorResult = normalizeFilamentColor(formData.color || "");

  return (
    <Card className="p-4 border-orange-500/30 shadow-md">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Nombre</label>
          <input type="text" name="name" value={formData.name || ""} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="Ej. Grilon3 PLA Negro" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Tipo</label>
            <input type="text" name="filament_type" value={formData.filament_type || ""} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="PLA, PETG" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Color</label>
            <input type="text" name="color" value={formData.color || ""} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" placeholder="Ej. Naranja" />
            
            <div className="flex items-center gap-2 mt-2">
              <input type="color" name="color_hex" value={formData.color_hex || colorResult.hex} onChange={handleChange} className="h-6 w-8 rounded cursor-pointer p-0 bg-transparent border-0" title="Ajustar color manualmente" />
              <span className="text-[10px] text-gray-400">
                {colorResult.confidence === "high" || colorResult.confidence === "medium" 
                  ? `Detectado: ${colorResult.label}` 
                  : "Ajustá manualmente"}
              </span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Gramos Total</label>
            <input type="number" name="total_grams" value={formData.total_grams !== undefined ? formData.total_grams : ""} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Gramos Restantes</label>
            <input type="number" name="remaining_grams" value={formData.remaining_grams !== undefined ? formData.remaining_grams : ""} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Precio Compra ($)</label>
          <input type="number" name="purchase_price" value={formData.purchase_price !== undefined ? formData.purchase_price : ""} onChange={handleChange} className="w-full text-sm border-white/10 rounded-md text-neutral-100 bg-neutral-900 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input type="checkbox" name="is_active" checked={formData.is_active !== undefined ? formData.is_active : true} onChange={handleChange} className="rounded text-[#ff6a00] focus:ring-[#ff6a00]/20" />
          <label className="text-sm font-medium text-gray-300">Filamento Activo</label>
        </div>
      </div>
      <div className="mt-4 flex flex-col-reverse sm:flex-row gap-2 justify-end">
        <button onClick={onCancel} className="w-full sm:w-auto px-3 py-1.5 text-xs font-bold text-gray-400 hover:bg-[#111]/5 rounded-md transition-colors text-center">Cancelar</button>
        <button onClick={onSave} className="w-full sm:w-auto flex justify-center items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-orange-500/100 hover:bg-orange-600 text-white rounded-md transition-colors"><Save size={14} /> Guardar</button>
      </div>
    </Card>
  );
}
