"use client";

import React, { useState, useEffect } from "react";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { PrimaryButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { createClient } from "@/utils/supabase/client";

export default function AdminMembresiaPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<any>(null);

  const [currentSettings, setCurrentSettings] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  const [newPrice, setNewPrice] = useState("");
  const [applyToExisting, setApplyToExisting] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch current price
      const { data: settings } = await supabase
        .from("membership_settings")
        .select("*")
        .eq("id", "default")
        .single();
      
      setCurrentSettings(settings);

      // Fetch history
      const { data: hist } = await supabase
        .from("membership_price_history")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      
      setHistory(hist || []);
    } catch (err: any) {
      console.error(err);
      setError("Error cargando configuración.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePrice = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const price = Number(newPrice);
      if (isNaN(price) || price <= 0) {
        throw new Error("El precio debe ser mayor a 0");
      }

      const res = await fetch("/api/admin/membership/update-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_price: price,
          apply_to_existing: applyToExisting,
          notes: notes
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al actualizar precio");
      }

      setSuccess(data);
      setNewPrice("");
      setNotes("");
      setApplyToExisting(false);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const formatPrice = (val: number) => {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(val);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  if (loading && !currentSettings) {
    return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-24">
      <SectionTitle eyebrow="Administración" title="Precio de Membresía" />

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-100 p-4 rounded-lg text-sm text-green-800 space-y-2">
          <div className="flex items-center gap-2 font-bold">
            <CheckCircle2 size={18} className="text-green-600" /> Precio actualizado correctamente
          </div>
          <p>
            El nuevo precio es <strong>{formatPrice(success.new_price)}</strong>.
          </p>
          {success.apply_to_existing && (
            <ul className="list-disc list-inside ml-2">
              <li>Suscripciones actualizadas en Mercado Pago: {success.affected_subscriptions}</li>
              {success.failed_subscriptions > 0 && (
                <li className="text-red-600 font-bold">
                  Suscripciones fallidas: {success.failed_subscriptions} (Ver historial)
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Estado Actual</h3>
            <p className="text-sm text-gray-500">Configuración vigente de la membresía.</p>
          </div>
          
          <div className="bg-orange-50 border border-orange-100 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-orange-600 uppercase mb-1">Precio Mensual</p>
              <p className="text-3xl font-black text-gray-900">
                {currentSettings?.monthly_price ? formatPrice(currentSettings.monthly_price) : "No definido"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Moneda</p>
              <p className="text-xl font-bold text-gray-700">{currentSettings?.currency || "ARS"}</p>
            </div>
          </div>
          
          {currentSettings?.updated_at && (
            <p className="text-xs text-gray-400">
              Última actualización: {formatDate(currentSettings.updated_at)}
            </p>
          )}
        </Card>

        <Card className="p-6 space-y-6 border-orange-200">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Actualizar Precio</h3>
            <p className="text-sm text-gray-500">Los nuevos usuarios pagarán este monto.</p>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-gray-700">Nuevo precio mensual (ARS)</span>
              <input
                type="number"
                min="0"
                placeholder="Ej. 15000"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-gray-700">Notas internas (opcional)</span>
              <input
                type="text"
                placeholder="Motivo del cambio..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
            </label>

            <label className="flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={applyToExisting}
                onChange={(e) => setApplyToExisting(e.target.checked)}
                className="mt-0.5 rounded text-orange-500 focus:ring-orange-500"
              />
              <div className="flex-1">
                <span className="block text-sm font-semibold text-gray-900">Aplicar también a suscripciones activas existentes</span>
                <span className="block text-xs text-gray-500 mt-1">Si está activado, Mercado Pago actualizará el monto del próximo cobro para todos los usuarios actuales.</span>
              </div>
            </label>
            
            <PrimaryButton 
              className="w-full" 
              onClick={handleUpdatePrice} 
              disabled={saving || !newPrice}
            >
              {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
              {saving ? "Actualizando..." : "Guardar nuevo precio"}
            </PrimaryButton>
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Historial de Cambios</h3>
        <Card className="overflow-hidden">
          {history.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">No hay cambios registrados.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-600">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Anterior</th>
                    <th className="px-4 py-3">Nuevo</th>
                    <th className="px-4 py-3">A existentes</th>
                    <th className="px-4 py-3">Resultado</th>
                    <th className="px-4 py-3">Notas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map((h) => (
                    <tr key={h.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(h.created_at)}</td>
                      <td className="px-4 py-3">{formatPrice(h.previous_price)}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{formatPrice(h.new_price)}</td>
                      <td className="px-4 py-3">
                        {h.apply_to_existing ? (
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">Sí</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {h.apply_to_existing ? (
                          <div className="flex flex-col text-xs">
                            <span className="text-green-600">{h.affected_subscriptions} OK</span>
                            {h.failed_subscriptions > 0 && (
                              <span className="text-red-600 font-bold">{h.failed_subscriptions} Fallaron</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[200px] truncate" title={h.notes || ""}>
                        {h.notes || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
