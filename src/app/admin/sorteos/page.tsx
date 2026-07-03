"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Pencil, Gift, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/utils/supabase/client";

export default function AdminSorteosPage() {
  const supabase = createClient();
  const [raffles, setRaffles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    // Fetch raffles with prizes count (assuming we do it via a second query or join)
    const { data: rafflesData, error } = await supabase
      .from("raffles")
      .select("*, raffle_prizes(id)")
      .order("created_at", { ascending: false });

    if (!error && rafflesData) {
      setRaffles(rafflesData);
    }
    setLoading(false);
  };

  const getStatusBadge = (status: string, isActive: boolean) => {
    if (!isActive) return <Badge tone="gray">Inactivo</Badge>;
    if (status === "draft") return <Badge tone="gray">Borrador</Badge>;
    if (status === "active") return <Badge tone="dark">Activo</Badge>;
    if (status === "completed") return <Badge tone="green">Completado</Badge>;
    if (status === "cancelled") return <Badge tone="orange">Cancelado</Badge>;
    return <Badge tone="gray">{status}</Badge>;
  };

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-orange-500" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Gestión de Sorteos</h1>
          <p className="text-sm text-gray-500 mt-1">Administra los sorteos y premios de la comunidad.</p>
        </div>
        <Link href="/admin/sorteos/nuevo">
          <PrimaryButton>
            <Plus size={15} /> Nuevo Sorteo
          </PrimaryButton>
        </Link>
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-5 py-3">Título</th>
              <th className="px-5 py-3">Fecha del Sorteo</th>
              <th className="px-5 py-3">Premios</th>
              <th className="px-5 py-3">Estado</th>
              <th className="px-5 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {raffles.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3.5 font-semibold text-gray-900">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-orange-50 flex items-center justify-center text-orange-500">
                      <Gift size={16} />
                    </div>
                    {r.title}
                  </div>
                </td>
                <td className="px-5 py-3.5 text-gray-600 font-medium">
                  {r.draw_date ? new Date(r.draw_date).toLocaleDateString() : "Sin fecha"}
                </td>
                <td className="px-5 py-3.5 text-gray-600 font-medium">
                  {r.raffle_prizes?.length || 0}
                </td>
                <td className="px-5 py-3.5">
                  {getStatusBadge(r.status, r.is_active)}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-1.5">
                    <Link href={`/admin/sorteos/${r.id}`}>
                      <GhostButton className="px-3 py-1.5 text-xs text-gray-700 bg-white border border-gray-200">
                        <Pencil size={13} className="mr-1" /> Editar / Premios
                      </GhostButton>
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {raffles.length === 0 && (
          <div className="py-12 text-center text-gray-500 text-sm">
            No hay sorteos creados todavía.
          </div>
        )}
      </Card>
    </div>
  );
}
