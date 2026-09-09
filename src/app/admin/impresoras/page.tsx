"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Plus, Edit2, Save, X, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";
import { PrinterCatalogImage } from "@/components/printers/PrinterCatalogImage";
import { getPrinterCatalogImageEditorConfig } from "@/lib/images/presets";
import { parseStorageReference } from "@/lib/storage";
import { PRINTER_CATALOG_IMAGES_BUCKET } from "@/lib/printers/catalog-image";

export default function AdminPrintersPage() {
  const supabase = createClient();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploadPathId, setUploadPathId] = useState<string | null>(null);
  const [persistedImagePath, setPersistedImagePath] = useState<string | null>(null);
  const [pendingImagePath, setPendingImagePath] = useState<string | null>(null);
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
    image_path: null as string | null,
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
      image_path: t.image_path || null,
    });
    setEditingId(t.id);
    setUploadPathId(t.id);
    setPersistedImagePath(t.image_path || null);
    setPendingImagePath(null);
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
      image_path: null,
    });
    setEditingId("new");
    setUploadPathId(crypto.randomUUID());
    setPersistedImagePath(null);
    setPendingImagePath(null);
  };

  const removeStoredImage = async (path: string) => {
    const { error: storageError } = await supabase.storage
      .from(PRINTER_CATALOG_IMAGES_BUCKET)
      .remove([path]);
    if (storageError) throw storageError;
  };

  const closeEditor = async () => {
    if (pendingImagePath && pendingImagePath !== persistedImagePath) {
      try {
        await removeStoredImage(pendingImagePath);
      } catch (cleanupError) {
        console.error("Could not clean up unsaved printer catalog image", cleanupError);
      }
    }
    setEditingId(null);
    setUploadPathId(null);
    setPersistedImagePath(null);
    setPendingImagePath(null);
  };

  const handleImageUploaded = async (reference: string) => {
    const parsed = parseStorageReference(reference);
    if (!parsed || parsed.bucket !== PRINTER_CATALOG_IMAGES_BUCKET || !uploadPathId) {
      setError("La imagen se subió con una referencia inválida.");
      return;
    }
    if (!parsed.path.startsWith(`printer-templates/${uploadPathId}/`)) {
      setError("La ruta de la imagen no corresponde a este modelo.");
      return;
    }

    if (pendingImagePath && pendingImagePath !== parsed.path && pendingImagePath !== persistedImagePath) {
      try {
        await removeStoredImage(pendingImagePath);
      } catch (cleanupError) {
        console.error("Could not clean up replaced printer catalog image", cleanupError);
      }
    }
    setPendingImagePath(parsed.path);
    setFormData((current) => ({ ...current, image_path: parsed.path }));
  };

  const handleRemoveImage = async () => {
    if (pendingImagePath && pendingImagePath !== persistedImagePath) {
      try {
        await removeStoredImage(pendingImagePath);
      } catch (cleanupError) {
        setError("No se pudo eliminar la imagen recién subida.");
        return;
      }
    }
    setPendingImagePath(null);
    setFormData((current) => ({ ...current, image_path: null }));
  };

  const handleSave = async () => {
    if (saving || !uploadPathId) return;
    setSaving(true);
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
      image_path: formData.image_path,
    };

    if (editingId === "new") {
      const { data, error } = await supabase.from("printer_templates").insert([{ id: uploadPathId, ...payload }]).select().single();
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
      else {
        setTemplates([data, ...templates]);
        setEditingId(null);
        setUploadPathId(null);
        setPendingImagePath(null);
      }
    } else {
      const { data, error } = await supabase.from("printer_templates").update(payload).eq("id", editingId).select().single();
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
      else {
        setTemplates(templates.map((t) => (t.id === editingId ? data : t)));
        setEditingId(null);
        setUploadPathId(null);
        setPendingImagePath(null);
      }
    }

    if (persistedImagePath && persistedImagePath !== formData.image_path) {
      try {
        await removeStoredImage(persistedImagePath);
      } catch (cleanupError) {
        console.error("Could not clean up previous printer catalog image", cleanupError);
      }
    }
    setPersistedImagePath(null);
    setSaving(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const val = type === "checkbox" ? (e.target as HTMLInputElement).checked : value;
    setFormData((prev) => ({ ...prev, [name]: val }));
  };

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-stampa-orange" /></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Catálogo Global de Impresoras</h1>
          <p className="text-sm text-gray-500 mt-1">Administra las plantillas que los usuarios pueden importar.</p>
        </div>
        <button
          onClick={handleCreateNew}
          disabled={editingId !== null}
          className="flex items-center gap-2 bg-stampa-orange/100 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-stampa-orange disabled:opacity-50 transition-colors"
        >
          <Plus size={16} /> Nueva Plantilla
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {editingId && (
        <div className="bg-stampa-surface p-6 rounded-xl border border-stampa-orange/30 shadow-sm ring-1 ring-orange-100 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-white">{editingId === "new" ? "Nueva Plantilla" : "Editar Plantilla"}</h3>
            <button onClick={() => void closeEditor()} className="text-gray-400 hover:text-gray-300" disabled={saving}>
              <X size={20} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Nombre Visible (Ej: Creality Ender 3 V2)</label>
              <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Marca</label>
                <input type="text" name="brand" value={formData.brand} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Modelo</label>
                <input type="text" name="model" value={formData.model} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Consumo Estimado (Watts)</label>
                <input type="number" name="power_watts" value={formData.power_watts} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Costo Mantenimiento ($/hora)</label>
                <input type="number" step="0.01" name="maintenance_cost_per_hour" value={formData.maintenance_cost_per_hour} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Volumen de Impresión (X, Y, Z mm)</label>
              <div className="flex gap-2">
                <input type="number" name="bed_size_x_mm" value={formData.bed_size_x_mm} onChange={handleChange} placeholder="X" className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
                <input type="number" name="bed_size_y_mm" value={formData.bed_size_y_mm} onChange={handleChange} placeholder="Y" className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
                <input type="number" name="bed_size_z_mm" value={formData.bed_size_z_mm} onChange={handleChange} placeholder="Z" className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Tipo de Impresora</label>
              <select name="printer_type" value={formData.printer_type} onChange={handleChange} className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500">
                <option value="FDM">FDM (Filamento)</option>
                <option value="SLA">SLA/DLP (Resina)</option>
              </select>
            </div>
            
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-300 mb-1">Notas</label>
              <textarea name="notes" value={formData.notes} onChange={handleChange} rows={2} className="w-full text-sm border-stampa-border rounded-md bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"></textarea>
            </div>

            <div className="space-y-3 md:col-span-2">
              <div>
                <label className="block text-xs font-semibold text-gray-300">Imagen de la impresora</label>
                <p className="mt-1 text-xs text-gray-500">Formato 4:3. Procurá que la impresora quede completa y centrada.</p>
              </div>
              {formData.image_path && (
                <div className="relative aspect-[4/3] w-full max-w-xs overflow-hidden rounded-xl border border-stampa-border">
                  <PrinterCatalogImage imagePath={formData.image_path} alt={formData.name || "Impresora del catálogo"} className="h-full w-full" />
                  <button
                    type="button"
                    onClick={() => void handleRemoveImage()}
                    className="absolute right-2 top-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-red-500/90 px-3 text-xs font-bold text-white shadow-lg hover:bg-red-500"
                  >
                    <Trash2 size={15} /> Eliminar imagen
                  </button>
                </div>
              )}
              {uploadPathId && (
                <FileUploadDropzone
                  key={uploadPathId}
                  bucket={PRINTER_CATALOG_IMAGES_BUCKET}
                  pathPrefix={`printer-templates/${uploadPathId}`}
                  accept="image/jpeg,image/png,image/webp"
                  maxSizeMb={5}
                  publicBucket={false}
                  label={formData.image_path ? "Reemplazar imagen" : "Subir imagen"}
                  helperText="Arrastrá una foto o seleccionála desde tu equipo"
                  imageEditor={getPrinterCatalogImageEditorConfig(formData.name || "Impresora")}
                  onUploaded={(reference) => void handleImageUploaded(reference)}
                />
              )}
            </div>

            <div className="flex items-center gap-4 mt-2">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="rounded text-stampa-orange focus:ring-[#ff6a00]/20 border-white/20" />
                <span>Plantilla Activa</span>
              </label>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <span className="text-xs font-semibold">Orden</span>
                  <input type="number" name="sort_order" value={formData.sort_order} onChange={handleChange} className="w-16 text-sm border-stampa-border rounded-md p-1 bg-stampa-surface border focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500" />
                </label>
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-4 border-t border-stampa-border">
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 bg-stampa-orange/100 hover:bg-stampa-orange text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar
            </button>
          </div>
        </div>
      )}

      <div className="bg-stampa-surface rounded-xl shadow-sm border border-stampa-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-stampa-bg-soft border-b border-stampa-border">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Imagen</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre / Marca</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Specs</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                    No hay plantillas creadas.
                  </td>
                </tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.id} className="hover:bg-stampa-bg-soft/50 transition-colors">
                    <td className="px-6 py-3">
                      <PrinterCatalogImage imagePath={t.image_path} alt={t.name} className="h-16 w-20 rounded-lg border border-stampa-border" />
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-white">{t.name}</div>
                      <div className="text-xs text-gray-500">{t.brand} {t.model}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-300">{t.power_watts}W, ${t.maintenance_cost_per_hour}/h</div>
                      {t.bed_size_x_mm && (
                        <div className="text-xs text-gray-500">{t.bed_size_x_mm}x{t.bed_size_y_mm}x{t.bed_size_z_mm} mm</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${t.is_active ? 'bg-green-500/100/20 text-green-400' : 'bg-stampa-surface/5 text-gray-200'}`}>
                        {t.is_active ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleEdit(t)}
                        className="p-2 text-gray-400 hover:text-stampa-orange hover:bg-stampa-orange/10 rounded-lg transition-colors"
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
