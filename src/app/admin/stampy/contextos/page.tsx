"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, Plus, Edit, Check, X, AlertCircle, ToggleLeft, ToggleRight, Bot } from "lucide-react";
import { Card } from "@/components/ui/card";
import Link from "next/link";

export default function AdminStampyContextosPage() {
  const supabase = createClient();
  const [contexts, setContexts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Form State
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form Fields
  const [routePattern, setRoutePattern] = useState("");
  const [matchType, setMatchType] = useState("exact");
  const [title, setTitle] = useState("");
  const [contextText, setContextText] = useState("");
  const [priority, setPriority] = useState("0");
  const [suggested, setSuggested] = useState("");
  const [related, setRelated] = useState("");

  const fetchContexts = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("stampy_page_contexts")
      .select("*")
      .order("priority", { ascending: false });
      
    if (err) {
      setError(err.message);
    } else {
      setContexts(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchContexts();
  }, []);

  const openNew = () => {
    setEditingId(null);
    setRoutePattern("/");
    setMatchType("exact");
    setTitle("");
    setContextText("");
    setPriority("0");
    setSuggested("");
    setRelated("");
    setShowForm(true);
  };

  const openEdit = (c: any) => {
    setEditingId(c.id);
    setRoutePattern(c.route_pattern);
    setMatchType(c.match_type);
    setTitle(c.title);
    setContextText(c.context);
    setPriority(c.priority.toString());
    setSuggested((c.suggested_questions || []).join("\n"));
    setRelated((c.related_tools || []).join("\n"));
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const payload = {
      route_pattern: routePattern.trim(),
      match_type: matchType,
      title: title.trim(),
      context: contextText.trim(),
      priority: parseInt(priority) || 0,
      suggested_questions: suggested.split("\n").map(s => s.trim()).filter(Boolean),
      related_tools: related.split("\n").map(s => s.trim()).filter(Boolean),
    };

    if (!payload.route_pattern.startsWith("/")) {
      setError("La ruta debe empezar con /");
      setSaving(false);
      return;
    }

    if (!payload.title || !payload.context) {
      setError("Título y contexto son requeridos.");
      setSaving(false);
      return;
    }

    let err;
    if (editingId) {
      const { error } = await supabase
        .from("stampy_page_contexts")
        .update(payload)
        .eq("id", editingId);
      err = error;
    } else {
      const { error } = await supabase
        .from("stampy_page_contexts")
        .insert({ ...payload, is_active: true });
      err = error;
    }

    if (err) {
      setError(err.message);
    } else {
      setShowForm(false);
      fetchContexts();
    }
    setSaving(false);
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    const { error: err } = await supabase
      .from("stampy_page_contexts")
      .update({ is_active: !currentStatus })
      .eq("id", id);
      
    if (err) {
      setError(err.message);
    } else {
      setContexts(contexts.map(c => c.id === id ? { ...c, is_active: !currentStatus } : c));
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Link href="/admin" className="text-sm font-medium text-cyan-400 hover:text-cyan-300">Admin</Link>
          <span className="text-gray-600">/</span>
          <span className="text-sm text-gray-500">Contextos Stampy</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Bot className="text-cyan-400" size={24} />
              Contextos de Stampy
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Definí qué debe saber Stampy según la sección donde esté el usuario.
            </p>
          </div>
          <button
            onClick={openNew}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-cyan-500/20"
          >
            <Plus size={16} /> Nuevo contexto
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-300 p-4 rounded-xl flex items-center gap-2 text-sm border border-red-500/30">
          <AlertCircle size={14} className="shrink-0" /> {error}
        </div>
      )}

      {showForm && (
        <Card className="p-6 border-cyan-500/30 bg-cyan-500/5">
          <h3 className="font-bold text-white mb-4 flex items-center gap-2">
            {editingId ? <Edit size={16} className="text-cyan-400" /> : <Plus size={16} className="text-cyan-400" />}
            {editingId ? "Editar contexto" : "Nuevo contexto"}
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Ruta</label>
              <input type="text" value={routePattern} onChange={e => setRoutePattern(e.target.value)}
                placeholder="/calculadora" className="w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-white bg-white/5 focus:border-cyan-500/50 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Tipo de Match</label>
              <select value={matchType} onChange={e => setMatchType(e.target.value)}
                className="w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-white bg-[#111] focus:border-cyan-500/50 outline-none">
                <option value="exact">Exacto (ej: /calculadora)</option>
                <option value="prefix">Prefijo (ej: /cursos engloba todo adentro)</option>
              </select>
            </div>
            
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Título de la pantalla</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Calculadora" className="w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-white bg-white/5 focus:border-cyan-500/50 outline-none" />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Contexto para Stampy</label>
              <textarea value={contextText} onChange={e => setContextText(e.target.value)} rows={3}
                placeholder="Herramienta para calcular precios de impresión 3D..." className="w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-white bg-white/5 focus:border-cyan-500/50 outline-none resize-none" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Preguntas Sugeridas (Una por línea)</label>
              <textarea value={suggested} onChange={e => setSuggested(e.target.value)} rows={3}
                placeholder="¿Cómo calculo el costo de luz?&#10;¿Qué margen me conviene?" className="w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-white bg-white/5 focus:border-cyan-500/50 outline-none resize-none" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Herramientas Relacionadas (Una por línea)</label>
              <textarea value={related} onChange={e => setRelated(e.target.value)} rows={3}
                placeholder="presupuestos&#10;productos" className="w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-white bg-white/5 focus:border-cyan-500/50 outline-none resize-none" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Prioridad (Mayor número gana)</label>
              <input type="number" value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-white bg-white/5 focus:border-cyan-500/50 outline-none" />
            </div>
          </div>

          <div className="flex gap-2 mt-5">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-400 hover:text-white bg-white/5 border border-white/10">Cancelar</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 flex items-center gap-2 rounded-xl text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              Guardar
            </button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-cyan-500" size={32} />
        </div>
      ) : contexts.length === 0 ? (
        <div className="text-center py-12 bg-[#111] border border-white/5 rounded-2xl">
          <p className="text-gray-500 text-sm">No hay contextos configurados.</p>
        </div>
      ) : (
        <div className="bg-[#111] border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#0a0a0a] border-b border-white/10 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Ruta</th>
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Prioridad</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {contexts.map(c => (
                <tr key={c.id} className="text-sm hover:bg-[#0a0a0a] transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-cyan-400">{c.route_pattern}</span>
                    <span className="ml-2 text-[10px] text-gray-500 uppercase border border-gray-700 rounded px-1">{c.match_type}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-300 font-medium">{c.title}</td>
                  <td className="px-4 py-3 text-gray-500">{c.priority}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${c.is_active ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>
                      {c.is_active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(c)} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg">
                        <Edit size={16} />
                      </button>
                      <button onClick={() => toggleStatus(c.id, c.is_active)} className={`p-1.5 rounded-lg ${c.is_active ? 'text-red-400 hover:bg-red-500/10' : 'text-green-400 hover:bg-green-500/10'}`}>
                        {c.is_active ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
