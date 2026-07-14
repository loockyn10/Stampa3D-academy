"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Plus, Edit2, Save, X, Loader2, AlertCircle } from "lucide-react";

export default function AdminPrintersPage() {
  const supabase = createClient();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    brand: "",
    model: "",
    name: "",
    power_watts: 300,
    maintenance_cost_per_hour: 0,
    bed_size_x_mm: 0,
    bed_size_y_mm: 0,
    bed_size_z_mm: 0,
    printer_type: "FDM",
    notes: "",
    is_active: true,
    sort_order: 0,
  });

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("printer_templates")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) setError(error.message);
    else setTemplates(data || []);
    setLoading(false);
  };

  const handleEdit = (t: any) => {
    setFormData({
      brand: t.brand || "",
      model: t.model || "",
      name: t.name,
      power_watts: t.power_watts,
      maintenance_cost_per_hour: t.maintenance_cost_per_hour,
      bed_size_x_mm: t.bed_size_x_mm || 0,
      bed_size_y_mm: t.bed_size_y_mm || 0,
      bed_size_z_mm: t.bed_size_z_mm || 0,
      printer_type: t.printer_type || "FDM",
      notes: t.notes || "",
      is_active: t.is_active,
      sort_order: t.sort_order || 0,
    });
    setEditingId(t.id);
  };

  const handleCreateNew = () => {
    setFormData({
      brand: "",
      model: "",
      name: "",
      power_watts: 300,
      maintenance_cost_per_hour: 0,
      bed_size_x_mm: 0,
      bed_size_y_mm: 0,
      bed_size_z_mm: 0,
      printer_type: "FDM",
      notes: "",
      is_active: true,
      sort_order: 0,
    });
    setEditingId("new");
  };

  const handleSave = async () => {
    setError(null);
    const payload = {
      brand: formData.brand,
      model: formData.model,
      name: formData.name,
      power_watts: parseFloat(String(formData.power_watts)) || 0,
      maintenance_cost_per_hour: parseFloat(String(formData.maintenance_cost_per_hour)) || 0,
      bed_size_x_mm: parseFloat(String(formData.bed_size_x_mm)) || null,
      bed_size_y_mm: parseFloat(String(formData.bed_size_y_mm)) || null,
      bed_size_z_mm: parseFloat(String(formData.bed_size_z_mm)) || null,
      printer_type: formData.printer_type,
      notes: formData.notes,
      is_active: formData.is_active,
      sort_order: parseInt(String(formData.sort_order)) || 0,
    };

    if (editingId === "new") {
      const { data, error } = await supabase.from("printer_templates").insert([payload]).select().single();
      if (error) setError(error.message);
      else {
        setTemplates([data, ...templates]);
        setEditingId(null);
      }
    } else {
      const { data, error } = await supabase.from("printer_templates").update(payload).eq("id", editingId).select().single();
      if (error) setError(error.message);
      else {
        setTemplates(templates.map((t) => (t.id === editingId ? data : t)));
        setEditingId(null);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const val = type === "checkbox" ? (e.target as HTMLInputElement).checked : value;
    setFormData((prev) => ({ ...prev, [name]: val }));
  };

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Catálogo Global de Impresoras</h1>
          <p className="text-sm text-gray-500 mt-1">Administra las plantillas que los usuarios pueden importar.</p>
        </div>
        <button
          onClick={handleCreateNew}
          disabled={editingId !== null}
          className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-50 transition-colors"
        >
          <Plus size={16} /> Nueva Plantilla
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {editingId && (
        <div className="bg-white p-6 rounded-xl border border-orange-200 shadow-sm ring-1 ring-orange-100 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-900">{editingId === "new" ? "Nueva Plantilla" : "Editar Plantilla"}</h3>
            <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-700">
              <X size={20} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Nombre Visible (Ej: Creality Ender 3 V2)</label>
              <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500" required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Marca</label>
                <input type="text" name="brand" value={formData.brand} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Modelo</label>
                <input type="text" name="model" value={formData.model} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500" />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Consumo Estimado (Watts)</label>
                <input type="number" name="power_watts" value={formData.power_watts} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Costo Mantenimiento ($/hora)</label>
                <input type="number" step="0.01" name="maintenance_cost_per_hour" value={formData.maintenance_cost_per_hour} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Volumen de Impresión (X, Y, Z mm)</label>
              <div className="flex gap-2">
                <input type="number" name="bed_size_x_mm" value={formData.bed_size_x_mm} onChange={handleChange} placeholder="X" className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500" />
                <input type="number" name="bed_size_y_mm" value={formData.bed_size_y_mm} onChange={handleChange} placeholder="Y" className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500" />
                <input type="number" name="bed_size_z_mm" value={formData.bed_size_z_mm} onChange={handleChange} placeholder="Z" className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Tipo de Impresora</label>
              <select name="printer_type" value={formData.printer_type} onChange={handleChange} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500">
                <option value="FDM">FDM (Filamento)</option>
                <option value="SLA">SLA/DLP (Resina)</option>
              </select>
            </div>
            
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Notas</label>
              <textarea name="notes" value={formData.notes} onChange={handleChange} rows={2} className="w-full text-sm border-gray-300 rounded-md focus:border-orange-500 focus:ring-orange-500"></textarea>
            </div>

            <div className="flex items-center gap-4 mt-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-orange-500 focus:ring-orange-500 border-gray-300" />
                <span>Plantilla Activa</span>
              </label>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-xs font-semibold">Orden</span>
                  <input type="number" name="sort_order" value={formData.sort_order} onChange={handleChange} className="w-16 text-sm border-gray-300 rounded-md p-1 focus:border-orange-500 focus:ring-orange-500" />
                </label>
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-4 border-t border-gray-100">
            <button onClick={handleSave} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors">
              <Save size={16} /> Guardar
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre / Marca</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Specs</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                    No hay plantillas creadas.
                  </td>
                </tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-gray-900">{t.name}</div>
                      <div className="text-xs text-gray-500">{t.brand} {t.model}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-700">{t.power_watts}W, ${t.maintenance_cost_per_hour}/h</div>
                      {t.bed_size_x_mm && (
                        <div className="text-xs text-gray-500">{t.bed_size_x_mm}x{t.bed_size_y_mm}x{t.bed_size_z_mm} mm</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${t.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                        {t.is_active ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleEdit(t)}
                        className="p-2 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg transition-colors"
                      >
                        <Edit2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
