"use client";

import { Building2, Loader2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

interface SinAccesoClientProps {
  price: string;
}

export function SinAccesoClient({ price }: SinAccesoClientProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const handleActivate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mercadopago/create-subscription", {
        method: "POST"
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Error al crear suscripción");
      }
      
      if (data.init_point) {
        window.location.href = data.init_point;
      } else {
        throw new Error("No se recibió la URL de pago");
      }
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const formatPrice = (amount: string) => {
    const num = parseInt(amount, 10);
    if (isNaN(num)) return amount;
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
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
          <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-100">
            <p className="text-sm font-semibold text-orange-800">
              Valor mensual: {formatPrice(price)}
            </p>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            Si ya realizaste el pago, aguardá unos minutos mientras procesamos la información.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100 text-left">
            <AlertCircle size={16} className="shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={handleActivate}
            disabled={loading}
            className="w-full rounded-lg bg-orange-500 px-3 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? "Generando link..." : "Activar membresía"}
          </button>
          
          <button
            onClick={() => window.location.reload()}
            disabled={loading}
            className="w-full rounded-lg bg-white px-3 py-3 text-sm font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Actualizar página
          </button>
          
          <button
            onClick={handleLogout}
            disabled={loading}
            className="w-full rounded-lg bg-white px-3 py-3 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
