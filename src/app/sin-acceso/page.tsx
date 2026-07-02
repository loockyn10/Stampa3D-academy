"use client";

import { Building2 } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

export default function SinAccesoPage() {
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F7F9] px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
        <div className="flex flex-col items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 mb-4">
            <Building2 className="h-6 w-6 text-orange-600" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">
            Cuenta inactiva
          </h2>
          <p className="mt-4 text-sm text-gray-600">
            Tu cuenta ha sido creada correctamente, pero tu membresía aún no se encuentra activa.
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Si ya realizaste el pago, aguardá unos minutos mientras procesamos la información.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-lg bg-blue-600 px-3 py-3 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
          >
            Actualizar página
          </button>
          
          <button
            onClick={handleLogout}
            className="w-full rounded-lg bg-white px-3 py-3 text-sm font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
