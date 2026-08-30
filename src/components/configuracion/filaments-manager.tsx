"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Plus, Edit2, Save, Trash2, Loader2, AlertCircle } from "lucide-react";
import { ColorSwatchLabel } from "@/components/ui/color-swatch-label";
import { Card } from "@/components/ui/card";
import { FilamentEditor } from "@/components/filaments/FilamentEditor";
import {
  buildFilamentInsertPayload,
  buildFilamentMutationPayload,
} from "@/lib/filaments/mutation-payload";
import { TableSkeleton } from "@/components/ui/page-skeletons";
import { useAppFeedback } from "@/components/ui/app-feedback";

export function FilamentsManager() {
  const supabase = createClient();
  const { confirmAction } = useAppFeedback();
  const [filaments, setFilaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    filament_type: "PLA",
    color: "#000000",
    total_grams: 1000,
    remaining_grams: 1000,
    purchase_price: 0,
    is_active: true,
  });

  useEffect(() => {
    fetchFilaments();
  }, []);

  const fetchFilaments = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("filaments")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) setError(error.message);
    else setFilaments(data || []);
    setLoading(false);
  };

  const handleSave = async () => {
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = buildFilamentMutationPayload(formData);

    if (editingId === "new") {
      const insertPayload = buildFilamentInsertPayload(formData, user.id);
      const { data, error } = await supabase.from("filaments").insert([insertPayload]).select().single();
      if (error) setError(error.message);
      else setFilaments([data, ...filaments]);
    } else {
      const { error } = await supabase.from("filaments").update(payload).eq("id", editingId);
      if (error) setError(error.message);
      else setFilaments(filaments.map(f => f.id === editingId ? { ...f, ...payload } : f));
    }
    
    if (!error) setEditingId(null);
  };

  const handleDelete = async (filament: any) => {
    const confirmed = await confirmAction({
      title: "Eliminar filamento",
      description: "No aparecerá más para nuevos cálculos, pero los movimientos y productos anteriores se conservarán.",
      confirmLabel: "Eliminar filamento",
      destructive: true,
    });
    if (!confirmed) return;

    const { error } = await supabase.from("filaments").update({ is_active: false }).eq("id", filament.id);
    if (error) {
      setError(error.message);
    } else {
      setFilaments(filaments.map(f => f.id === filament.id ? { ...f, is_active: false } : f));
    }
  };

  if (loading) return <TableSkeleton rows={5} columns={5} />;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-500/20">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-white">Mis Filamentos</h3>
        <button
          onClick={() => {
            setFormData({
              name: "", filament_type: "PLA", color: "#000000", total_grams: 1000, remaining_grams: 1000, purchase_price: 0, is_active: true
            });
            setEditingId("new");
          }}
          className="flex items-center gap-1.5 bg-stampa-orange/100 hover:bg-stampa-orange text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Añadir Filamento
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {editingId === "new" && (
          <FilamentEditor formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
        )}

        {filaments.map((f) => (
          editingId === f.id ? (
            <FilamentEditor key={f.id} formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
          ) : (
            <Card key={f.id} className="p-4 flex flex-col hover:border-stampa-orange/30 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-white">{f.name}</h4>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setFormData(f); setEditingId(f.id); }} className="text-gray-400 hover:text-stampa-orange transition-colors">
                    <Edit2 size={16} />
                  </button>
                  <button onClick={() => handleDelete(f)} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 p-1 rounded transition-colors" title="Eliminar filamento">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-500 space-y-2 mb-4 flex-1">
                <p>Tipo: <span className="font-medium text-gray-300">{f.filament_type}</span></p>
                <div className="flex items-center gap-1.5">
                  <span>Color:</span>
                  <ColorSwatchLabel color={f.color} colorHex={f.color_hex} size="sm" />
                </div>
                <p>Precio: <span className="font-medium text-gray-300">${f.purchase_price}</span></p>
                <p>Restante: <span className="font-medium text-gray-300">{f.remaining_grams}g / {f.total_grams}g</span></p>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-stampa-border">
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${f.is_active ? 'bg-green-500/20 text-green-400' : 'bg-stampa-surface/5 text-gray-400'}`}>
                  {f.is_active ? 'Activo' : 'Inactivo'}
                </span>
              </div>
            </Card>
          )
        ))}
        {filaments.length === 0 && editingId !== "new" && (
          <div className="col-span-full py-12 text-center bg-stampa-bg-soft rounded-xl border border-dashed border-white/20">
            <p className="text-sm text-gray-500">No tienes filamentos registrados.</p>
          </div>
        )}
      </div>
    </div>
  );
}
