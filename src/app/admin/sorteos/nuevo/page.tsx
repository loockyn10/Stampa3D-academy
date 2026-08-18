"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, AlertCircle } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";

export default function NuevoSorteoPage() {
  const router = useRouter();
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    draw_date: "",
    status: "draft",
    is_active: false
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let val: any = value;
    if (type === "checkbox") val = (e.target as HTMLInputElement).checked;
    setFormData((prev) => ({ ...prev, [name]: val }));
  };

  const handleSave = async () => {
    if (!formData.title) return setError("El título es obligatorio.");
    
    setSaving(true);
    setError(null);
    
    // We assume the schema allows 'status', otherwise it will fail and we'll fix it.
    // We explicitly map values to ensure clean insertion
    const payload = {
      title: formData.title,
      description: formData.description,
      draw_date: formData.draw_date || null,
      status: formData.status,
      is_active: formData.is_active
    };

    const { data, error } = await supabase
      .from("raffles")
      .insert([payload])
      .select()
      .single();

    setSaving(false);

    if (error) {
      setError(error.message);
    } else if (data) {
      router.push(`/admin/sorteos/${data.id}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/sorteos">
          <GhostButton className="p-2 border border-stampa-border bg-stampa-surface">
            <ArrowLeft size={18} className="text-gray-400" />
          </GhostButton>
        </Link>
        <SectionTitle eyebrow="Administración" title="Nuevo Sorteo" />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <Card className="p-6 border-stampa-orange/30">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-gray-300 mb-1">Título del Sorteo</label>
            <input 
              type="text" 
              name="title" 
              value={formData.title} 
              onChange={handleChange} 
              className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface text-neutral-100 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" 
              placeholder="Ej. Sorteo de Primavera" 
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-gray-300 mb-1">Descripción y Reglas</label>
            <textarea 
              name="description" 
              value={formData.description} 
              onChange={handleChange} 
              rows={3}
              className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface text-neutral-100 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" 
              placeholder="¿Cómo participar? ¿Cuáles son los premios?..." 
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Fecha del Sorteo</label>
            <input 
              type="date" 
              name="draw_date" 
              value={formData.draw_date} 
              onChange={handleChange} 
              className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface text-neutral-100 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" 
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Estado</label>
            <select 
              name="status" 
              value={formData.status} 
              onChange={handleChange} 
              className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface text-neutral-100 border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"
            >
              <option value="draft">Borrador</option>
              <option value="active">Activo (Visible)</option>
              <option value="completed">Completado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-2">
              <input 
                type="checkbox" 
                name="is_active" 
                checked={formData.is_active} 
                onChange={handleChange} 
                className="rounded text-stampa-orange focus:ring-[#ff6a00]/20" 
              />
              <span className="text-sm font-semibold text-gray-300">Sorteo Activo en la plataforma (Sólo puede haber uno activo visible a la vez preferentemente)</span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-stampa-border">
          <Link href="/admin/sorteos">
            <GhostButton className="px-4 py-2 border border-stampa-border font-bold text-gray-400 hover:bg-stampa-bg-soft">Cancelar</GhostButton>
          </Link>
          <PrimaryButton onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-6">
            <Save size={16} /> {saving ? "Guardando..." : "Guardar y Continuar"}
          </PrimaryButton>
        </div>
      </Card>
    </div>
  );
}
