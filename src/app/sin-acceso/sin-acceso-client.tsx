"use client";

import { Building2, Loader2, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

const CHECKOUT_ATTEMPT_STORAGE_KEY = "stampa_membership_checkout_attempt";

function getCheckoutIdempotencyKey(): string {
  const existing = window.sessionStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);

  if (existing) {
    return existing;
  }

  const idempotencyKey = window.crypto.randomUUID();
  window.sessionStorage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, idempotencyKey);
  return idempotencyKey;
}

export function SinAccesoClient() {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [price, setPrice] = useState<string | null>(null);
  const [loadingPrice, setLoadingPrice] = useState(true);

  const [isEmailConfirmed, setIsEmailConfirmed] = useState(true);
  const [checkingEmail, setCheckingEmail] = useState(true);

  useEffect(() => {
    async function checkEmailAndFetchPrice() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // Si el proveedor no es email, asumimos que está confirmado (ej. Google) o si tiene email_confirmed_at
          const isConfirmed = user.app_metadata?.provider !== "email" || !!user.email_confirmed_at;
          setIsEmailConfirmed(isConfirmed);
        }

        const { data } = await supabase
          .from("membership_settings")
          .select("monthly_price")
          .eq("id", "default")
          .single();
          
        if (data?.monthly_price) {
          setPrice(String(data.monthly_price));
        } else {
          setPrice(process.env.NEXT_PUBLIC_MEMBERSHIP_MONTHLY_PRICE || "19900");
        }
      } catch {
        setPrice(process.env.NEXT_PUBLIC_MEMBERSHIP_MONTHLY_PRICE || "19900");
      } finally {
        setLoadingPrice(false);
        setCheckingEmail(false);
      }
    }
    checkEmailAndFetchPrice();
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const handleCreateSubscription = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
    }
    
    try {
      setLoading(true);
      setError(null);
      console.log("Creando suscripción Mercado Pago");
      const idempotencyKey = getCheckoutIdempotencyKey();

      const response = await fetch("/api/mercadopago/create-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ idempotency_key: idempotencyKey }),
      });

      const text = await response.text();
      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        console.error("[MP frontend] invalid JSON response", text);
      }

      console.log("[MP frontend] status", response.status);
      console.log("[MP frontend] data", data);

      if (data?.new_attempt_required) {
        window.sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      }

      if (response.status === 202) {
        throw new Error(
          data?.error ||
            "Estamos verificando el intento con Mercado Pago. Probá nuevamente en unos instantes.",
        );
      }

      if (!response.ok) {
        console.error("Create subscription error response:", data || text);
        throw new Error(data?.error || "Error al crear la suscripción");
      }

      const initPoint = data?.init_point || data?.initPoint || data?.url;

      if (!initPoint) {
        console.error("[MP frontend] missing init point", data);
        throw new Error("No recibimos el link de pago.");
      }

      window.location.href = initPoint;
    } catch (error) {
      console.error(error);
      setError(
        error instanceof Error
          ? error.message
          : "Error al crear la suscripción"
      );
    } finally {
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
      <div className="w-full max-w-md space-y-8 bg-stampa-surface p-8 rounded-2xl shadow-sm border border-stampa-border text-center">
        <div className="flex flex-col items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 mb-4">
            <Building2 className="h-6 w-6 text-stampa-orange" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Cuenta inactiva
          </h2>
          {checkingEmail ? (
            <p className="mt-4 text-sm text-gray-400">Verificando estado de tu cuenta...</p>
          ) : !isEmailConfirmed ? (
            <>
              <p className="mt-4 text-sm text-gray-400">
                Tenés que confirmar tu email para activar tu cuenta.
              </p>
              <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-100 min-h-[56px] flex items-center justify-center">
                <p className="text-sm font-semibold text-orange-800">
                  Revisá tu bandeja de entrada o spam.
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm text-gray-400">
                Tu cuenta ha sido creada correctamente, pero tu membresía aún no se encuentra activa.
              </p>
              <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-100 min-h-[56px] flex items-center justify-center">
                {loadingPrice ? (
                  <p className="text-sm font-semibold text-orange-800 flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Cargando precio...
                  </p>
                ) : price ? (
                  <p className="text-sm font-semibold text-orange-800">
                    Valor mensual: {formatPrice(price)} / mes
                  </p>
                ) : (
                  <p className="text-sm font-semibold text-orange-800 opacity-70">
                    Precio no disponible
                  </p>
                )}
              </div>
              <p className="mt-4 text-sm text-gray-400">
                Si ya realizaste el pago, aguardá unos minutos mientras procesamos la información.
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100 text-left whitespace-pre-wrap">
            <AlertCircle size={16} className="shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3">
          {!checkingEmail && !isEmailConfirmed ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              disabled={loading}
              className="w-full rounded-lg bg-stampa-orange px-3 py-3 text-sm font-semibold text-white hover:bg-stampa-orange transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              Ya confirmé mi email, volver a intentar
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreateSubscription}
              disabled={loading || checkingEmail}
              className="w-full rounded-lg bg-stampa-orange px-3 py-3 text-sm font-semibold text-white hover:bg-stampa-orange transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? "Generando link..." : "Activar membresía"}
            </button>
          )}
          
          <button
            type="button"
            onClick={() => window.location.reload()}
            disabled={loading}
            className="w-full rounded-lg bg-stampa-surface px-3 py-3 text-sm font-semibold text-gray-300 border border-white/20 hover:bg-stampa-bg-soft transition-colors disabled:opacity-50"
          >
            Actualizar página
          </button>
          
          <button
            type="button"
            onClick={handleLogout}
            disabled={loading}
            className="w-full rounded-lg bg-stampa-surface px-3 py-3 text-sm font-semibold text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
