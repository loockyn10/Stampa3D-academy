"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Plus, Edit2, Save, Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";

export function PrintersManager() {
  const supabase = createClient();
  const [printers, setPrinters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    power_watts: 300,
    maintenance_cost_per_hour: 0,
    is_active: true,
  });

  useEffect(() => {
    fetchPrinters();
  }, []);

  const fetchPrinters = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("printers")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) setError(error.message);
    else setPrinters(data || []);
    setLoading(false);
  };

  const handleSave = async () => {
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      ...formData,
      user_id: user.id,
      power_watts: parseFloat(String(formData.power_watts)) || 0,
      maintenance_cost_per_hour: parseFloat(String(formData.maintenance_cost_per_hour)) || 0,
    };

    if (editingId === "new") {
      const { data, error } = await supabase.from("printers").insert([payload]).select().single();
      if (error) setError(error.message);
      else setPrinters([data, ...printers]);
    } else {
      const { error } = await supabase.from("printers").update(payload).eq("id", editingId);
      if (error) setError(error.message);
      else setPrinters(printers.map(p => p.id === editingId ? { ...p, ...payload } : p));
    }
    
    if (!error) setEditingId(null);
  };

  if (loading) return <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-orange-500" /></div>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Mis Impresoras</h3>
        <button
          onClick={() => {
            setFormData({
              name: "", power_watts: 300, maintenance_cost_per_hour: 0, is_active: true
            });
            setEditingId("new");
          }}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Añadir Impresora
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {editingId === "new" && (
          <PrinterEditor formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
        )}

        {printers.map((p) => (
          editingId === p.id ? (
            <PrinterEditor key={p.id} formData={formData} setFormData={setFormData} onSave={handleSave} onCancel={() => setEditingId(null)} />
          ) : (
            <Card key={p.id} className="p-4 flex flex-col hover:border-orange-200 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-bold text-gray-900">{p.name}</h4>
                <button onClick={() => { setFormData(p); setEditingId(p.id); }} className="text-gray-400 hover:text-orange-500 transition-colors">
                  <Edit2 size={16} />
                </button>
              </div>
              <div className="text-sm text-gray-500 space-y-1 mb-4 flex-1">
                <p>Consumo: <span className="font-medium text-gray-700">{p.power_watts}W</span></p>
                <p>Mantenimiento: <span className="font-medium text-gray-700">${p.maintenance_cost_per_hour}/h</span></p>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {p.is_active ? 'Activa' : 'Inactiva'}
                </span>
              </div>
            </Card>
          )
        ))}
        {printers.length === 0 && editingId !== "new" && (
          <div className="col-span-full py-12 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
            <p className="text-sm text-gray-500">No tienes impresoras registradas.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PrinterEditor({ formData, setFormData, onSave, onCancel }: any) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setFormData((prev: any) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setFormData((prev: any) => ({ ...prev, [name]: value }));
    }
  };

  return (
    <Card className="p-4 border-orange-200 shadow-md">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Nombre Impresora</label>
          <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900" placeholder="Ej. Ender 3 V2" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Consumo (Watts)</label>
            <input type="number" name="power_watts" value={formData.power_watts} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Mantenimiento ($/h)</label>
            <input type="number" name="maintenance_cost_per_hour" value={formData.maintenance_cost_per_hour} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500 text-gray-900" />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-orange-600 focus:ring-orange-500" />
          <label className="text-sm font-medium text-gray-700">Impresora Activa</label>
        </div>
      </div>
      <div className="mt-4 flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-md transition-colors">Cancelar</button>
        <button onClick={onSave} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-md transition-colors"><Save size={14} /> Guardar</button>
      </div>
    </Card>
  );
}
