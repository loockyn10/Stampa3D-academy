"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, Plus, Copy, Check, ToggleLeft, ToggleRight, AlertCircle, CheckCircle2, Link2, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import Link from "next/link";

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://academia-stampa.com";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateBetaCode(): string {
  let suffix = "";
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[array[i] % ALPHABET.length];
  }
  return `BETA-${suffix}`;
}

export default function AdminBetaCodesPage() {
  const supabase = createClient();

  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New code form
  const [showForm, setShowForm] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expires, setExpires] = useState("");
  const [accessExpires, setAccessExpires] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

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

  const handleCreate = async () => {
    setCreating(true);
    setError(null);

    const codeToUse = newCode.trim().toUpperCase() || generateBetaCode();
    const { data: { user } } = await supabase.auth.getUser();

    const { error: err } = await supabase.from("invite_codes").insert({
      code: codeToUse,
      status: "active",
      max_uses: maxUses ? parseInt(maxUses) : null,
      expires_at: expires || null,
      access_expires_at: accessExpires || null,
      notes: notes.trim() || null,
      created_by: user?.id,
    });

    if (err) {
      showMsg(err.message, "error");
    } else {
      showMsg(`Código ${codeToUse} creado exitosamente.`);
      setShowForm(false);
      setNewCode("");
      setMaxUses("");
      setExpires("");
      setAccessExpires("");
      setNotes("");
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
    const link = `${APP_BASE_URL}/registro?invite=${code}`;
    await navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Link href="/admin" className="text-sm font-medium text-orange-400 hover:text-orange-300">Admin</Link>
          <span className="text-gray-600">/</span>
          <span className="text-sm text-gray-500">Códigos Beta</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Tag className="text-cyan-400" size={22} />
              Códigos de Invitación Beta
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Creá y gestioná códigos de acceso anticipado para beta testers.
            </p>
          </div>
          <button
            onClick={() => { setShowForm(!showForm); setNewCode(generateBetaCode()); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-cyan-500/20"
          >
            <Plus size={16} /> Nuevo código
          </button>
        </div>
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

      {/* Creation form */}
      {showForm && (
        <Card className="p-6 border-cyan-500/30 bg-cyan-500/5">
          <h3 className="font-bold text-white text-base mb-4 flex items-center gap-2">
            <Plus size={15} className="text-cyan-400" /> Nuevo código de invitación
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Código <span className="text-gray-600 font-normal normal-case">(se genera si lo dejás vacío)</span>
              </label>
              <input
                type="text"
                value={newCode}
                onChange={e => setNewCode(e.target.value.toUpperCase().trim())}
                placeholder="BETA-XXXXXX"
                className="w-full rounded-xl border border-white/10 px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-cyan-500/50 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Usos máximos <span className="text-gray-600 font-normal normal-case">(vacío = ilimitado)</span>
              </label>
              <input
                type="number"
                value={maxUses}
                onChange={e => setMaxUses(e.target.value)}
                placeholder="Ej: 10"
                min="1"
                className="w-full rounded-xl border border-white/10 px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-cyan-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Vencimiento del código
              </label>
              <input
                type="date"
                value={expires}
                onChange={e => setExpires(e.target.value)}
                className="w-full rounded-xl border border-white/10 px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-cyan-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Acceso beta vence
              </label>
              <input
                type="date"
                value={accessExpires}
                onChange={e => setAccessExpires(e.target.value)}
                className="w-full rounded-xl border border-white/10 px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-cyan-500/50"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Notas
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Para qué es este código, quién lo recibe..."
                className="w-full rounded-xl border border-white/10 px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-cyan-500/50 resize-none"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-400 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex-1 flex justify-center items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-500 transition-colors disabled:opacity-60"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Crear código
            </button>
          </div>
        </Card>
      )}

      {/* Codes list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin h-8 w-8 text-cyan-400" />
        </div>
      ) : codes.length === 0 ? (
        <Card className="p-10 text-center border-dashed border-white/20">
          <Tag size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 font-semibold">No hay códigos creados todavía.</p>
          <p className="text-gray-600 text-sm mt-1">Creá el primero para empezar a invitar beta testers.</p>
        </Card>
      ) : (
        <div className="bg-[#111] border border-white/10 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#0a0a0a] border-b border-white/10 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Código</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3">Usos</th>
                  <th className="px-5 py-3">Vence código</th>
                  <th className="px-5 py-3">Vence acceso</th>
                  <th className="px-5 py-3">Notas</th>
                  <th className="px-5 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {codes.map(c => {
                  const isActive = c.status === "active";
                  const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
                  const isDepleted = c.max_uses !== null && c.used_count >= c.max_uses;
                  const effectiveStatus = isExpired ? "expired" : isDepleted ? "depleted" : c.status;

                  return (
                    <tr key={c.id} className="text-sm hover:bg-[#0a0a0a] transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-white tracking-widest">{c.code}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          effectiveStatus === "active" ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/30" :
                          effectiveStatus === "expired" || effectiveStatus === "depleted" ? "bg-red-500/10 text-red-300 border border-red-500/30" :
                          "bg-white/5 text-gray-400 border border-white/10"
                        }`}>
                          {effectiveStatus === "active" ? "Activo" :
                           effectiveStatus === "inactive" ? "Inactivo" :
                           effectiveStatus === "expired" ? "Vencido" : "Agotado"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-300">
                        <span className={isDepleted ? "text-red-400 font-bold" : ""}>
                          {c.used_count}
                        </span>
                        {c.max_uses !== null && (
                          <span className="text-gray-500"> / {c.max_uses}</span>
                        )}
                        {c.max_uses === null && <span className="text-gray-600"> / ∞</span>}
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {c.expires_at
                          ? new Date(c.expires_at).toLocaleDateString("es-AR")
                          : <span className="text-gray-700">Sin vencimiento</span>
                        }
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {c.access_expires_at
                          ? new Date(c.access_expires_at).toLocaleDateString("es-AR")
                          : <span className="text-gray-700">Sin límite</span>
                        }
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-500 max-w-[160px]">
                        <span className="truncate block">{c.notes || "—"}</span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleCopy(c.code, c.id)}
                            title="Copiar link de invitación"
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                              copiedId === c.id
                                ? "bg-green-500/10 text-green-400 border border-green-500/30"
                                : "bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10"
                            }`}
                          >
                            {copiedId === c.id ? <><Check size={11} /> Copiado</> : <><Link2 size={11} /> Link</>}
                          </button>
                          <button
                            onClick={() => handleToggleStatus(c.id, c.status)}
                            title={isActive ? "Desactivar" : "Activar"}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                              isActive
                                ? "bg-red-500/10 text-red-300 border-red-500/30 hover:bg-red-500/20"
                                : "bg-cyan-500/10 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/20"
                            }`}
                          >
                            {isActive ? <><ToggleLeft size={11} /> Desactivar</> : <><ToggleRight size={11} /> Activar</>}
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

      {/* Help text */}
      <div className="bg-[#111] border border-white/5 rounded-xl p-5 text-sm text-gray-500 space-y-1.5">
        <p className="font-semibold text-gray-400">¿Cómo funciona?</p>
        <p>1. Creá un código de invitación y copiá el link.</p>
        <p>2. Mandáselo a la persona que querés que tenga acceso beta.</p>
        <p>3. Al registrarse con ese link, el sistema le otorga acceso automáticamente.</p>
        <p>4. El acceso beta no requiere pago y no modifica el estado de membresía.</p>
      </div>
    </div>
  );
}
