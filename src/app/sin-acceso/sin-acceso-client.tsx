"use client";

import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { BetaCodeRedeemCard } from "@/components/beta-access/BetaCodeRedeemCard";
import { readPendingBetaCode } from "@/lib/beta-access/pending-code";
import { refreshAccessAction } from "./actions";

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

const LOCKED_FEATURES: Record<string, { title: string; description: string }> = {
  stampy: { title: "Stampy IA", description: "Resolvé dudas técnicas y trabajá con un asistente conectado a tus herramientas." },
  academia: { title: "Academia", description: "Aprendé con cursos y talleres prácticos de impresión 3D." },
  taller: { title: "Mi Taller", description: "Organizá tus impresoras, filamentos, productos e inventario." },
  negocio: { title: "Mi Negocio", description: "Gestioná catálogo, ventas, reposición y métricas desde un mismo lugar." },
};

export function SinAccesoClient({ feature }: { feature?: string | null }) {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activated, setActivated] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  const [price, setPrice] = useState<string | null>(null);
  const [loadingPrice, setLoadingPrice] = useState(true);

  const [isEmailConfirmed, setIsEmailConfirmed] = useState(true);
  const [checkingEmail, setCheckingEmail] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasPendingBetaCode, setHasPendingBetaCode] = useState(false);
  const lockedFeature = feature ? LOCKED_FEATURES[feature] : null;

  useEffect(() => {
    async function checkEmailAndFetchPrice() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setHasPendingBetaCode(readPendingBetaCode() !== null);
        if (user) {
          setIsAuthenticated(true);
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

  // Re-asks the server (canonical access policy) and continues if access is now active.
  const revalidateAccess = useCallback(async (): Promise<boolean> => {
    try {
      const result = await refreshAccessAction();
      if (result.hasAccess && result.destination) {
        setActivated(true);
        router.replace(result.destination);
        router.refresh();
        return true;
      }
    } catch {
      // Treated as "not active yet".
    }
    return false;
  }, [router]);

  const handleRefreshAccess = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshNotice(null);
    const ok = await revalidateAccess();
    if (!ok) {
      setRefreshNotice("Tu acceso todavía no está activo.");
      setRefreshing(false);
    }
  };

  const handleBetaRedeemed = () => {
    setActivated(true);
    void revalidateAccess().then((ok) => {
      if (!ok) {
        setActivated(false);
        setRefreshNotice("Tu acceso todavía no está activo. Probá actualizar en unos segundos.");
      }
    });
  };

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
    <div className="flex min-h-dvh w-full items-start justify-center bg-stampa-bg px-4 py-10 text-stampa-text sm:items-center sm:px-6">
      <div className="w-full min-w-0 max-w-md space-y-6">
        <header className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-stampa-orange-border bg-stampa-orange-muted">
            <Sparkles className="h-6 w-6 text-stampa-orange" aria-hidden="true" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stampa-orange">Universo Stampa</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-stampa-text sm:text-3xl">
            {lockedFeature ? `Desbloqueá ${lockedFeature.title}` : "Tu cuenta está lista"}
          </h1>
          {checkingEmail ? (
            <p className="mt-3 text-sm text-stampa-text-muted">Verificando estado de tu cuenta...</p>
          ) : !isEmailConfirmed ? (
            <p className="mt-3 text-sm text-stampa-text-muted">
              Confirmá tu email para activar tu cuenta. Revisá tu bandeja de entrada o spam.
            </p>
          ) : (
            <p className="mt-3 text-sm text-stampa-text-muted">
              {lockedFeature?.description ?? "Para acceder a Universo necesitás una membresía o una invitación Beta."}
            </p>
          )}
        </header>

        {activated && (
          <div role="status" className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-left">
            <CheckCircle2 size={20} className="shrink-0 text-emerald-400" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-300">Acceso Beta activado</p>
              <p className="text-xs text-stampa-text-muted">Preparando Universo…</p>
            </div>
            <Loader2 size={16} className="ml-auto shrink-0 animate-spin text-emerald-400" aria-hidden="true" />
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 whitespace-pre-wrap rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-left text-sm text-red-300">
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="min-w-0 break-words">{error}</p>
          </div>
        )}

        {!checkingEmail && !isEmailConfirmed && hasPendingBetaCode && (
          <p className="text-center text-xs text-stampa-text-muted">
            Tu código de invitación se aplicará automáticamente cuando confirmes tu email.
          </p>
        )}

        {!checkingEmail && isAuthenticated && isEmailConfirmed && !activated && (
          <>
            <BetaCodeRedeemCard
              title="¿Tenés un código de invitación?"
              submitLabel="Activar acceso"
              hint={null}
              onRedeemed={handleBetaRedeemed}
            />

            <section className="rounded-2xl border border-stampa-border bg-stampa-surface p-4 text-left">
              <h2 className="text-sm font-bold text-stampa-text">Membresía</h2>
              <p className="mt-1 text-sm text-stampa-text-muted">
                {loadingPrice ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Cargando precio...
                  </span>
                ) : price ? (
                  <>Valor mensual: <span className="font-semibold text-stampa-text">{formatPrice(price)}</span> / mes</>
                ) : (
                  "Precio no disponible"
                )}
              </p>
              <button
                type="button"
                onClick={handleCreateSubscription}
                disabled={loading || checkingEmail}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-stampa-orange px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-stampa-orange-hover disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {loading ? "Generando link..." : "Activar membresía"}
              </button>
            </section>
          </>
        )}

        <section className="space-y-3 border-t border-stampa-border pt-5 text-center">
          <p className="text-sm text-stampa-text-muted">
            {isEmailConfirmed ? "¿Ya activaste tu acceso?" : "¿Ya confirmaste tu email?"}
          </p>
          <button
            type="button"
            onClick={handleRefreshAccess}
            disabled={refreshing || loading || activated}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-stampa-border bg-stampa-surface px-3 py-3 text-sm font-semibold text-stampa-text-soft transition-colors hover:bg-stampa-surface-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
            {refreshing ? "Verificando..." : "Actualizar acceso"}
          </button>
          <p aria-live="polite" className="min-h-5 text-sm text-stampa-text-muted">{refreshNotice}</p>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loading}
            className="text-sm font-medium text-stampa-text-muted underline-offset-4 transition-colors hover:text-stampa-text hover:underline disabled:opacity-50"
          >
            Cerrar sesión
          </button>
        </section>
      </div>
    </div>
  );
}
