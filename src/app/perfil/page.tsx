"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrimaryButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";

function PerfilContent() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"perfil" | "configuracion">("perfil");

  // Sync tab with URL search parameter if present
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "configuracion") {
      setTab("configuracion");
    } else {
      setTab("perfil");
    }
  }, [searchParams]);

  const configRows = [
    "Notificaciones por email",
    "Notificaciones de sorteos",
    "Modo oscuro (próximamente)",
    "Recordatorios de cursos",
  ];

  return (
    <div>
      <SectionTitle eyebrow="Usuario" title={tab === "perfil" ? "Mi perfil" : "Configuración"} />

      {/* Tabs selectors */}
      <div className="mb-5 inline-flex rounded-xl bg-gray-100 p-1">
        <button
          onClick={() => setTab("perfil")}
          className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
            tab === "perfil" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Detalles de Perfil
        </button>
        <button
          onClick={() => setTab("configuracion")}
          className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
            tab === "configuracion" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Configuración de cuenta
        </button>
      </div>

      {tab === "perfil" ? (
        <Card className="max-w-xl p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-xl font-bold text-orange-600 select-none">
              MJ
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">Marcos Juárez</p>
              <p className="text-sm text-gray-400">marcos@correo.com</p>
              <div className="mt-1">
                <Badge tone="dark">Miembro Premium</Badge>
              </div>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Nombre</span>
              <input
                defaultValue="Marcos Juárez"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Email</span>
              <input
                defaultValue="marcos@correo.com"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
              />
            </label>
          </div>
          <PrimaryButton className="mt-5">Guardar cambios</PrimaryButton>
        </Card>
      ) : (
        <Card className="max-w-xl divide-y divide-gray-100 p-2">
          {configRows.map((r) => (
            <div key={r} className="flex items-center justify-between px-4 py-3.5">
              <span className="text-sm text-gray-700">{r}</span>
              <button className="h-5 w-9 rounded-full bg-gray-200 p-0.5 relative cursor-pointer focus:outline-none">
                <div className="h-4 w-4 rounded-full bg-white shadow transition-all duration-150" />
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

export default function PerfilPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500">Cargando perfil...</div>}>
      <PerfilContent />
    </Suspense>
  );
}
