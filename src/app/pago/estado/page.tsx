"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2, Clock, XCircle } from "lucide-react";

export default function PagoEstadoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<{ active?: boolean, status?: string } | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch("/api/mercadopago/sync-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Error al verificar la suscripción");
      }

      setStatusData(data);

      if (data.active) {
        setTimeout(() => {
          router.push("/");
        }, 2000);
      }
    } catch (err: any) {
      console.error("Error verificando estado:", err);
      setError(err.message || "Ocurrió un error inesperado");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F7F9] px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
        
        {loading && (
          <div className="flex flex-col items-center justify-center">
            <Loader2 className="h-12 w-12 text-orange-500 animate-spin mb-4" />
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">
              Estamos verificando tu membresía...
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Por favor aguardá un momento.
            </p>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">
              Error de verificación
            </h2>
            <p className="mt-2 text-sm text-red-600 mb-6">
              {error}
            </p>
            <button
              onClick={checkStatus}
              className="w-full rounded-lg bg-orange-500 px-3 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
            >
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && statusData && (
          <div className="flex flex-col items-center justify-center">
            {statusData.active ? (
              <>
                <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
                <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                  Membresía activada correctamente
                </h2>
                <p className="mt-2 text-sm text-gray-600 mb-6">
                  Serás redirigido al inicio en breve...
                </p>
              </>
            ) : statusData.status === "pending" ? (
              <>
                <Clock className="h-12 w-12 text-yellow-500 mb-4" />
                <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                  Suscripción pendiente
                </h2>
                <p className="mt-2 text-sm text-gray-600 mb-6">
                  Tu pago/suscripción todavía está pendiente de confirmación.
                </p>
                <div className="flex flex-col w-full gap-3">
                  <button
                    onClick={checkStatus}
                    className="w-full rounded-lg bg-orange-500 px-3 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
                  >
                    Reintentar verificación
                  </button>
                  <button
                    onClick={() => router.push("/")}
                    className="w-full rounded-lg bg-white border border-gray-300 px-3 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Volver al inicio
                  </button>
                </div>
              </>
            ) : statusData.status === "not_found" ? (
              <>
                <XCircle className="h-12 w-12 text-gray-400 mb-4" />
                <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                  Suscripción no encontrada
                </h2>
                <p className="mt-2 text-sm text-gray-600 mb-6">
                  No encontramos una suscripción asociada a tu cuenta.
                </p>
                <button
                  onClick={() => router.push("/sin-acceso")}
                  className="w-full rounded-lg bg-orange-500 px-3 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
                >
                  Volver a Sin Acceso
                </button>
              </>
            ) : (
              <>
                <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
                <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                  Estado desconocido
                </h2>
                <p className="mt-2 text-sm text-gray-600 mb-6">
                  El estado de tu membresía es: {statusData.status}
                </p>
                <div className="flex flex-col w-full gap-3">
                  <button
                    onClick={checkStatus}
                    className="w-full rounded-lg bg-orange-500 px-3 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
                  >
                    Reintentar
                  </button>
                  <button
                    onClick={() => router.push("/")}
                    className="w-full rounded-lg bg-white border border-gray-300 px-3 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Volver al inicio
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
