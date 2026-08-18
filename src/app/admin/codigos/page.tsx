"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, Plus, Copy, Check, ToggleLeft, ToggleRight, AlertCircle, CheckCircle2, Link2, Tag, Gift, Percent, DollarSign, Edit } from "lucide-react";
import { Card } from "@/components/ui/card";
import Link from "next/link";

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://academia-stampa.com";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(prefix = ""): string {
  let suffix = "";
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[array[i] % ALPHABET.length];
  }
  return prefix ? `${prefix}-${suffix}` : suffix;
}

export default function AdminCodigosPage() {
  const supabase = createClient();

  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New/Edit form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  
  // Form Fields
  const [newCode, setNewCode] = useState("");
  const [title, setTitle] = useState("");
  const [codeType, setCodeType] = useState("beta_tester");
  const [discountValue, setDiscountValue] = useState("");
  const [discountDuration, setDiscountDuration] = useState("forever");
  
  const [maxUses, setMaxUses] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [accessExpiresAt, setAccessExpiresAt] = useState("");
  const [notes, setNotes] = useState("");

  // Copied tracking
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const showMsg = (msg: string, type: "success" | "error" = "success") => {
    if (type === "success") {
      setSuccess(msg);
      setTimeout(() => setSuccess(null), 3000);
    } else {
      setError(msg);
      setTimeout(() => setError(null), 5000);
    }
  };

  const fetchCodes = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("invite_codes")
      .select("*")
      .order("created_at", { ascending: false });
    if (err) showMsg(err.message, "error");
    else setCodes(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchCodes(); }, []);

  const openNewForm = () => {
    setEditingId(null);
    setNewCode(generateCode("BETA"));
    setTitle("");
    setCodeType("beta_tester");
    setDiscountValue("");
    setDiscountDuration("forever");
    setMaxUses("");
    setStartsAt("");
    setExpiresAt("");
    setAccessExpiresAt("");
    setNotes("");
    setShowForm(true);
  };

  const openEditForm = (code: any) => {
    setEditingId(code.id);
    setNewCode(code.code);
    setTitle(code.title || "");
    setCodeType(code.code_type || "beta_tester");
    setDiscountValue(code.discount_value?.toString() || "");
    setDiscountDuration(code.discount_duration || "forever");
    setMaxUses(code.max_uses?.toString() || "");
    setStartsAt(code.starts_at ? new Date(code.starts_at).toISOString().split('T')[0] : "");
    setExpiresAt(code.expires_at ? new Date(code.expires_at).toISOString().split('T')[0] : "");
    setAccessExpiresAt(code.access_expires_at ? new Date(code.access_expires_at).toISOString().split('T')[0] : "");
    setNotes(code.notes || "");
    setShowForm(true);
  };

  const handleSave = async () => {
    setCreating(true);
    setError(null);

    const codeToUse = newCode.trim().toUpperCase() || generateCode("STAMPA");
    const { data: { user } } = await supabase.auth.getUser();

    // Validations
    if (!codeToUse) {
      showMsg("El código no puede estar vacío.", "error");
      setCreating(false);
      return;
    }
    
    if (["discount_percent", "discount_fixed_amount", "fixed_price"].includes(codeType) && !discountValue) {
      showMsg("Debe ingresar un valor para el descuento/precio.", "error");
      setCreating(false);
      return;
    }

    const payload: any = {
      code: codeToUse,
      code_type: codeType,
      title: title.trim() || null,
      max_uses: maxUses ? parseInt(maxUses) : null,
      starts_at: startsAt || null,
      expires_at: expiresAt || null,
      notes: notes.trim() || null,
    };

    if (codeType === "beta_tester" || codeType === "manual_free_access") {
      payload.access_expires_at = accessExpiresAt || null;
      payload.discount_type = null;
      payload.discount_value = null;
      payload.discount_duration = null;
    } else {
      payload.access_expires_at = null;
      payload.discount_value = parseFloat(discountValue);
      payload.discount_duration = discountDuration;
      
      if (codeType === "discount_percent") payload.discount_type = "percent";
      if (codeType === "discount_fixed_amount") payload.discount_type = "fixed_amount";
      if (codeType === "fixed_price") payload.discount_type = "fixed_price";
    }

    let err;
    if (editingId) {
      const { error } = await supabase.from("invite_codes").update(payload).eq("id", editingId);
      err = error;
    } else {
      payload.status = "active";
      payload.created_by = user?.id;
      const { error } = await supabase.from("invite_codes").insert(payload);
      err = error;
    }

    if (err) {
      showMsg(err.message, "error");
    } else {
      showMsg(editingId ? `Código actualizado exitosamente.` : `Código ${codeToUse} creado exitosamente.`);
      setShowForm(false);
      fetchCodes();
    }
    setCreating(false);
  };

  const handleToggleStatus = async (id: string, current: string) => {
    const newStatus = current === "active" ? "inactive" : "active";
    const { error: err } = await supabase
      .from("invite_codes")
      .update({ status: newStatus })
      .eq("id", id);
    if (err) showMsg(err.message, "error");
    else {
      showMsg(`Código ${newStatus === "active" ? "activado" : "desactivado"}.`);
      setCodes(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
    }
  };

  const handleCopy = async (code: string, id: string) => {
    const link = `${APP_BASE_URL}/registro?ref=${code}`;
    await navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const getCodeTypeLabel = (type: string) => {
    switch(type) {
      case 'beta_tester': return 'Beta Tester';
      case 'manual_free_access': return 'Acceso Gratis';
      case 'discount_percent': return 'Descuento %';
      case 'discount_fixed_amount': return 'Descuento Fijo';
      case 'fixed_price': return 'Precio Especial';
      default: return type;
    }
  };

  const getBenefitDisplay = (c: any) => {
    if (c.code_type === 'beta_tester' || c.code_type === 'manual_free_access') {
      return c.access_expires_at 
        ? `Gratis hasta ${new Date(c.access_expires_at).toLocaleDateString("es-AR")}`
        : 'Gratis ilimitado';
    }
    if (c.code_type === 'discount_percent') return `${c.discount_value}% OFF`;
    if (c.code_type === 'discount_fixed_amount') return `$${c.discount_value} OFF`;
    if (c.code_type === 'fixed_price') return `Precio fijo: $${c.discount_value}`;
    return '—';
  };

  const getBadgeStyle = (type: string) => {
    if (type.includes('beta') || type.includes('free')) return "bg-cyan-500/10 text-cyan-300 border-cyan-500/30";
    if (type.includes('discount')) return "bg-violet-500/10 text-violet-300 border-violet-500/30";
    if (type.includes('price')) return "bg-amber-500/10 text-amber-300 border-amber-500/30";
    return "bg-gray-500/10 text-gray-300 border-gray-500/30";
  };

  const stats = {
    totalActive: codes.filter(c => c.status === 'active').length,
    totalUses: codes.reduce((acc, c) => acc + (c.used_count || 0), 0),
    totalBeta: codes.filter(c => c.code_type === 'beta_tester').length,
    totalPromo: codes.filter(c => c.code_type !== 'beta_tester' && c.code_type !== 'manual_free_access').length,
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Link href="/admin" className="text-sm font-medium text-orange-400 hover:text-orange-300">Admin</Link>
          <span className="text-gray-600">/</span>
          <span className="text-sm text-gray-500">Códigos</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Gift className="text-orange-400" size={24} />
              Gestión de Códigos
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Gestioná códigos beta, promocionales y beneficios temporales.
            </p>
          </div>
          <button
            onClick={openNewForm}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-stampa-orange hover:bg-stampa-orange text-white text-sm font-semibold transition-colors shadow-lg shadow-stampa-orange/20"
          >
            <Plus size={16} /> Nuevo código
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-stampa-border bg-stampa-surface flex flex-col items-center justify-center text-center">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">Activos</p>
          <p className="text-2xl font-bold text-white">{stats.totalActive}</p>
        </Card>
        <Card className="p-4 border-stampa-border bg-stampa-surface flex flex-col items-center justify-center text-center">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">Usos Totales</p>
          <p className="text-2xl font-bold text-white">{stats.totalUses}</p>
        </Card>
        <Card className="p-4 border-stampa-border bg-stampa-surface flex flex-col items-center justify-center text-center">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">Betas</p>
          <p className="text-2xl font-bold text-cyan-400">{stats.totalBeta}</p>
        </Card>
        <Card className="p-4 border-stampa-border bg-stampa-surface flex flex-col items-center justify-center text-center">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">Promos</p>
          <p className="text-2xl font-bold text-violet-400">{stats.totalPromo}</p>
        </Card>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-300 p-4 rounded-xl flex items-center gap-2 text-sm border border-red-500/30">
          <AlertCircle size={14} className="shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="bg-green-500/10 text-green-300 p-4 rounded-xl flex items-center gap-2 text-sm border border-green-500/30">
          <CheckCircle2 size={14} className="shrink-0" /> {success}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <Card className="p-6 border-stampa-orange/30 bg-stampa-orange/5">
          <h3 className="font-bold text-white text-base mb-4 flex items-center gap-2">
            {editingId ? <Edit size={16} className="text-orange-400" /> : <Plus size={16} className="text-orange-400" />}
            {editingId ? "Editar código" : "Nuevo código"}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Código</label>
              <input type="text" value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase().trim())}
                placeholder="EJ: PROMO50" className="w-full rounded-xl border border-stampa-border px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-stampa-orange/50 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Título (Opcional)</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Ej: Beta testers agosto" className="w-full rounded-xl border border-stampa-border px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-stampa-orange/50" />
            </div>

            <div className="sm:col-span-2 border-t border-stampa-border pt-4 mt-2">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Tipo de código</label>
              <select value={codeType} onChange={e => setCodeType(e.target.value)}
                className="w-full rounded-xl border border-stampa-border px-3 py-2.5 text-sm text-white bg-stampa-surface focus:outline-none focus:border-stampa-orange/50">
                <option value="beta_tester">Beta Tester (Acceso a la app)</option>
                <option value="manual_free_access">Acceso Gratis Temporal (Membresía bonificada)</option>
                <option value="discount_percent">Descuento Porcentual (%)</option>
                <option value="discount_fixed_amount">Descuento Monto Fijo ($)</option>
                <option value="fixed_price">Precio Especial Fijo ($)</option>
              </select>
            </div>

            {/* Benefit fields based on type */}
            {(codeType === "beta_tester" || codeType === "manual_free_access") ? (
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Acceso caduca el (Opcional)</label>
                <input type="date" value={accessExpiresAt} onChange={e => setAccessExpiresAt(e.target.value)}
                  className="w-full rounded-xl border border-stampa-border px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-stampa-orange/50" />
                <p className="text-xs text-gray-500 mt-1">Si queda vacío, el acceso no tiene fecha de vencimiento.</p>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    {codeType === "discount_percent" ? "Porcentaje de descuento" : "Monto / Precio"}
                  </label>
                  <input type="number" value={discountValue} onChange={e => setDiscountValue(e.target.value)}
                    placeholder={codeType === "discount_percent" ? "50" : "19900"}
                    className="w-full rounded-xl border border-stampa-border px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-stampa-orange/50" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Duración del descuento</label>
                  <select value={discountDuration} onChange={e => setDiscountDuration(e.target.value)}
                    className="w-full rounded-xl border border-stampa-border px-3 py-2.5 text-sm text-white bg-stampa-surface focus:outline-none focus:border-stampa-orange/50">
                    <option value="once">Un solo uso (primer mes)</option>
                    <option value="forever">Para siempre (recurrente)</option>
                  </select>
                </div>
              </>
            )}

            <div className="sm:col-span-2 border-t border-stampa-border pt-4 mt-2"></div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Límite de usos</label>
              <input type="number" value={maxUses} onChange={e => setMaxUses(e.target.value)}
                placeholder="Ej: 50 (vacío = sin límite)" min="1"
                className="w-full rounded-xl border border-stampa-border px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-stampa-orange/50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Vencimiento del código (No del acceso)</label>
              <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
                className="w-full rounded-xl border border-stampa-border px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-stampa-orange/50" />
            </div>
            
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Notas internas</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Opcional..." className="w-full rounded-xl border border-stampa-border px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-stampa-orange/50 resize-none" />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={() => setShowForm(false)} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-400 bg-white/5 border border-stampa-border hover:bg-white/10 transition-colors">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={creating} className="flex-1 flex justify-center items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-stampa-orange hover:bg-stampa-orange transition-colors disabled:opacity-60">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Guardar código
            </button>
          </div>
        </Card>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin h-8 w-8 text-orange-400" />
        </div>
      ) : codes.length === 0 ? (
        <Card className="p-10 text-center border-dashed border-white/20 bg-stampa-surface">
          <Tag size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 font-semibold">No hay códigos creados.</p>
        </Card>
      ) : (
        <div className="bg-stampa-surface border border-stampa-border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-stampa-bg-soft border-b border-stampa-border text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Código</th>
                  <th className="px-5 py-3">Tipo</th>
                  <th className="px-5 py-3">Beneficio</th>
                  <th className="px-5 py-3">Usos</th>
                  <th className="px-5 py-3">Vigencia</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {codes.map(c => {
                  const isActive = c.status === "active";
                  const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
                  const isDepleted = c.max_uses !== null && c.used_count >= c.max_uses;
                  const effectiveStatus = isExpired ? "expired" : isDepleted ? "depleted" : c.status;

                  return (
                    <tr key={c.id} className="text-sm hover:bg-stampa-bg-soft transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex flex-col">
                          <span className="font-mono font-bold text-white tracking-widest">{c.code}</span>
                          {c.title && <span className="text-[11px] text-gray-500">{c.title}</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getBadgeStyle(c.code_type)}`}>
                          {getCodeTypeLabel(c.code_type)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-300 font-medium">
                        {getBenefitDisplay(c)}
                      </td>
                      <td className="px-5 py-3 text-gray-300">
                        <span className={isDepleted ? "text-red-400 font-bold" : ""}>{c.used_count || 0}</span>
                        {c.max_uses !== null ? <span className="text-gray-500"> / {c.max_uses}</span> : <span className="text-gray-600"> / ∞</span>}
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {c.expires_at ? new Date(c.expires_at).toLocaleDateString("es-AR") : "Ilimitada"}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          effectiveStatus === "active" ? "bg-green-500/10 text-green-300 border border-green-500/30" :
                          effectiveStatus === "expired" || effectiveStatus === "depleted" ? "bg-red-500/10 text-red-300 border border-red-500/30" :
                          "bg-white/5 text-gray-400 border border-stampa-border"
                        }`}>
                          {effectiveStatus === "active" ? "Activo" : effectiveStatus === "inactive" ? "Inactivo" : effectiveStatus === "expired" ? "Vencido" : "Agotado"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleCopy(c.code, c.id)} title="Copiar link" className={`flex items-center gap-1 p-1.5 rounded-lg text-xs font-semibold transition-colors ${copiedId === c.id ? "bg-green-500/10 text-green-400" : "text-gray-400 hover:bg-white/10 hover:text-white"}`}>
                            {copiedId === c.id ? <Check size={14} /> : <Link2 size={14} />}
                          </button>
                          <button onClick={() => openEditForm(c)} title="Editar" className="p-1.5 rounded-lg text-gray-400 hover:bg-white/10 hover:text-white transition-colors">
                            <Edit size={14} />
                          </button>
                          <button onClick={() => handleToggleStatus(c.id, c.status)} title={isActive ? "Desactivar" : "Activar"} className={`p-1.5 rounded-lg transition-colors ${isActive ? "text-red-400 hover:bg-red-500/10" : "text-green-400 hover:bg-green-500/10"}`}>
                            {isActive ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
