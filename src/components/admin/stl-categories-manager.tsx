"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, AlertCircle, Edit2, Plus, Save, X } from "lucide-react";
import { FileUploadDropzone } from "@/components/ui/file-upload-dropzone";
import { slugifyGroupName } from "@/lib/stl/library";

interface GroupForm {
  name: string;
  slug: string;
  description: string;
  thumbnail_url: string;
  sort_order: number;
  is_active: boolean;
}

interface GroupRow {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  thumbnail_url: string | null;
  sort_order: number | null;
  is_active: boolean | null;
}

const EMPTY_FORM: GroupForm = { name: "", slug: "", description: "", thumbnail_url: "", sort_order: 0, is_active: true };
const INPUT_CLASS =
  "w-full text-sm border-white/20 rounded-md focus:border-stampa-orange focus:ring-stampa-orange text-white bg-stampa-surface";

/**
 * Admin de Grupos de la Librería STL. Un "grupo" es una fila de `stl_categories`.
 * No hay borrado: se archiva con "Publicado" desactivado (los modelos conservan su grupo).
 */
export function StlCategoriesManager() {
  const supabase = createClient();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [ungroupedCount, setUngroupedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GroupForm>(EMPTY_FORM);

  const fetchData = async () => {
    const [groupsRes, modelsRes] = await Promise.all([
      supabase.from("stl_categories").select("*").order("sort_order", { ascending: true }),
      supabase.from("stl_models").select("id, category_id"),
    ]);
    if (groupsRes.error) setError(groupsRes.error.message);
    else setGroups(groupsRes.data || []);

    const nextCounts: Record<string, number> = {};
    let orphans = 0;
    for (const model of modelsRes.data || []) {
      if (model.category_id) nextCounts[model.category_id] = (nextCounts[model.category_id] || 0) + 1;
      else orphans += 1;
    }
    setCounts(nextCounts);
    setUngroupedCount(orphans);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = (id: string, values: GroupForm) => {
    setError(null);
    setForm(values);
    setEditingId(id);
  };

  const handleSave = async () => {
    setError(null);
    const name = form.name.trim();
    if (!name) {
      setError("El grupo necesita un nombre.");
      return;
    }
    const slug = slugifyGroupName(form.slug.trim() || name);
    if (!slug) {
      setError("No pude generar un slug válido para el grupo.");
      return;
    }
    if (groups.some((group) => group.slug === slug && group.id !== editingId)) {
      setError("Ya existe otro grupo con ese slug.");
      return;
    }

    const payload = {
      name,
      slug,
      description: form.description.trim() || null,
      thumbnail_url: form.thumbnail_url.trim() || null,
      sort_order: form.sort_order,
      is_active: form.is_active,
    };

    setSaving(true);
    if (editingId === "new") {
      const { data, error: err } = await supabase.from("stl_categories").insert([payload]).select().single();
      if (err) setError(err.message);
      else {
        setGroups([...groups, data]);
        setEditingId(null);
      }
    } else {
      const { error: err } = await supabase.from("stl_categories").update(payload).eq("id", editingId);
      if (err) setError(err.message);
      else {
        setGroups(groups.map((group) => (group.id === editingId ? { ...group, ...payload } : group)));
        setEditingId(null);
      }
    }
    setSaving(false);
  };

  const renderForm = (isNew: boolean) => (
    <div className="w-full space-y-3 rounded-lg border border-stampa-border bg-stampa-bg-soft p-4">
      <input type="text" placeholder="Nombre (ej. Dragones articulados)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT_CLASS} />
      <input type="text" placeholder="Slug de la URL (vacío = se genera del nombre)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className={INPUT_CLASS} />
      <textarea placeholder="Descripción breve (opcional)" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={INPUT_CLASS} />

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-300">Portada del grupo (opcional)</p>
        <FileUploadDropzone
          bucket="stl-thumbnails"
          pathPrefix={`stl-groups/${isNew ? "new" : editingId}`}
          accept=".jpg,.jpeg,.png,.webp"
          publicBucket={true}
          maxSizeMb={5}
          helperText="Imagen horizontal, máximo 5 MB."
          imageEditor={{ aspectRatio: 4 / 3, outputWidth: 1200, outputHeight: 900, quality: 0.9, outputType: "preserve" }}
          onUploaded={(url) => setForm((prev) => ({ ...prev, thumbnail_url: url }))}
          label={form.thumbnail_url ? "Reemplazar portada" : "Subir portada"}
        />
        <input type="text" placeholder="o URL pública de la imagen" value={form.thumbnail_url} onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })} className={INPUT_CLASS} />
        {form.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.thumbnail_url} alt="Portada" className="h-24 w-32 rounded-lg border border-stampa-border object-cover" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          Orden
          <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} className="w-24 text-sm border-white/20 rounded-md focus:border-stampa-orange focus:ring-stampa-orange text-white bg-stampa-surface" />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="rounded text-stampa-orange focus:ring-stampa-orange" />
          Publicado
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => setEditingId(null)} aria-label="Cancelar" className="rounded-md p-1.5 text-gray-400 hover:bg-white/10"><X size={16} /></button>
        <button type="button" disabled={saving} onClick={handleSave} aria-label="Guardar grupo" className="rounded-md p-1.5 text-stampa-orange hover:bg-stampa-orange/10 disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        </button>
      </div>
    </div>
  );

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-stampa-orange" /></div>;

  return (
    <div className="max-w-3xl">
      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="rounded-xl border border-stampa-border bg-stampa-surface p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-white">Grupos</h2>
          <button
            type="button"
            onClick={() => startEdit("new", { ...EMPTY_FORM, sort_order: groups.length + 1 })}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-stampa-orange transition-colors hover:bg-stampa-orange/10"
          >
            <Plus size={16} /> Nuevo
          </button>
        </div>

        <div className="space-y-3">
          {editingId === "new" && renderForm(true)}

          {groups.map((group) =>
            editingId === group.id ? (
              <div key={group.id}>{renderForm(false)}</div>
            ) : (
              <div key={group.id} className="flex items-center justify-between gap-3 rounded-lg border border-stampa-border p-3 transition-colors hover:bg-stampa-bg-soft">
                <div className="flex min-w-0 items-center gap-3">
                  {group.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={group.thumbnail_url} alt={group.name} className="h-10 w-10 shrink-0 rounded object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/5 text-gray-400">?</div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{group.name}</p>
                    <p className="truncate text-xs text-gray-500">
                      Orden: {group.sort_order} • /{group.slug} • {counts[group.id] || 0} modelos
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!group.is_active && <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-gray-400">No publicado</span>}
                  <button
                    type="button"
                    aria-label={`Editar ${group.name}`}
                    onClick={() =>
                      startEdit(group.id, {
                        name: group.name,
                        slug: group.slug || "",
                        description: group.description || "",
                        thumbnail_url: group.thumbnail_url || "",
                        sort_order: group.sort_order ?? 0,
                        is_active: group.is_active ?? true,
                      })
                    }
                    className="rounded-md p-1.5 text-gray-400 hover:bg-stampa-orange/10 hover:text-stampa-orange"
                  >
                    <Edit2 size={16} />
                  </button>
                </div>
              </div>
            ),
          )}

          {ungroupedCount > 0 && (
            <div className="rounded-lg border border-dashed border-stampa-border p-3 text-xs text-gray-400">
              <span className="font-semibold text-gray-300">Sin grupo:</span> {ungroupedCount} modelos. Se muestran al público en
              &laquo;Otros modelos&raquo; hasta que los asignes a un grupo.
            </div>
          )}

          {groups.length === 0 && editingId !== "new" && (
            <p className="py-4 text-center text-sm text-gray-500">No hay grupos. Creá el primero.</p>
          )}
        </div>
      </div>
    </div>
  );
}
