"use client";

import { AlertCircle, Calculator, CheckCircle2, Loader2, MailCheck, RefreshCw, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { comparison } from "@/components/landing-hero/commercial/commercial-content";
import { PREMIUM_RETURN_TO, premiumAuthHref } from "@/lib/auth/premium-intent";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { BetaCodeRedeemCard } from "@/components/beta-access/BetaCodeRedeemCard";
import { readPendingBetaCode } from "@/lib/beta-access/pending-code";
import { DiscountCodeField, type AppliedDiscount } from "@/components/membership/DiscountCodeField";
import { refreshAccessAction } from "./actions";

const CHECKOUT_ATTEMPT_STORAGE_KEY = "stampa_membership_checkout_attempt";

/**
 * One idempotency key per checkout attempt AND per discount code: applying, changing or removing a code starts a new
 * attempt (a preapproval's amount cannot change), while a retry with the same code reuses the same key.
 */
function getCheckoutIdempotencyKey(discountCode: string | null): string {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) ?? "null") as
      | { key?: unknown; code?: unknown }
      | null;
    if (stored && typeof stored.key === "string" && (stored.code ?? null) === discountCode) {
      return stored.key;
    }
  } catch {
    // A legacy plain-UUID value or unreadable storage: start a fresh attempt below.
  }

  const idempotencyKey = window.crypto.randomUUID();
  window.sessionStorage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, JSON.stringify({ key: idempotencyKey, code: discountCode }));
  return idempotencyKey;
}

const LOCKED_FEATURES: Record<string, { title: string; description: string }> = {
  stampy: { title: "Stampy IA", description: "Resolvé dudas técnicas y trabajá con un asistente conectado a tus herramientas." },
  academia: { title: "Academia", description: "Aprendé con cursos y talleres prácticos de impresión 3D." },
  taller: { title: "Mi Taller", description: "Organizá tus impresoras, filamentos, productos e inventario." },
  negocio: { title: "Mi Negocio", description: "Gestioná catálogo, ventas, reposición y métricas desde un mismo lugar." },
};

export function SinAccesoClient({
  feature,
  discountCodesEnabled = false,
  calculatorAvailable = true,
}: {
  feature?: string | null;
  /** Server-side kill switch (DISCOUNT_CODES_ENABLED): the code field is only shown when it is on. */
  discountCodesEnabled?: boolean;
  /** Feature flag of the free Calculator, resolved on the server. */
  calculatorAvailable?: boolean;
}) {
  const supabase = createClient();
  const [discount, setDiscount] = useState<AppliedDiscount | null>(null);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activated, setActivated] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [payerEmail, setPayerEmail] = useState("");
  // The code whose promotion terms were accepted. A different code (or none) means different conditions: the acceptance
  // never carries over, because it is only valid while it matches the code currently applied.
  const [promoAcceptedFor, setPromoAcceptedFor] = useState<string | null>(null);
  const appliedCode = discount?.code ?? null;
  const promoAccepted = appliedCode !== null && promoAcceptedFor === appliedCode;

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

        // The amount charged is always decided by the server (membership_settings): never show an invented fallback.
        setPrice(data?.monthly_price ? String(data.monthly_price) : null);
      } catch {
        setPrice(null);
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

  const handleCreateSubscription = async (e?: React.MouseEvent, restart = false) => {
    if (e) {
      e.preventDefault();
    }
    if (loading) return;
    if (discountCodesEnabled && discount?.preview.promo && !promoAccepted) {
      setError("Aceptá las condiciones de la promoción para continuar.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const discountCode = discountCodesEnabled && discount ? discount.code : null;
      const acceptPromoTerms = discountCode && discount?.preview.promo && promoAccepted ? discount.preview.promo.termsVersion : null;
      if (restart) window.sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      const idempotencyKey = getCheckoutIdempotencyKey(discountCode);
      const mpEmail = payerEmail.trim();

      const response = await fetch("/api/mercadopago/create-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // Only the code TEXT travels: the discounted amount is decided by the server.
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          ...(discountCode ? { discount_code: discountCode } : {}),
          ...(acceptPromoTerms ? { accept_promo_terms: acceptPromoTerms } : {}),
          ...(mpEmail ? { payer_email: mpEmail } : {}),
          ...(restart ? { restart: true } : {}),
        }),
      });

      const text = await response.text();
      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      if (data?.new_attempt_required) {
        window.sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      }

      // The server rejected the code (expired, exhausted...) or the switch is off: drop it so the user can continue at full price.
      if (typeof data?.code === "string" && data.code.startsWith("discount_") && data.code !== "discount_persistence_pending") {
        setDiscount(null);
      }

      // Already a member (e.g. a payment whose webhook was late was just recovered): go in instead of paying again.
      if (data?.code === "already_member") {
        if (await revalidateAccess()) return;
      }

      if (response.status === 202) {
        throw new Error(
          data?.error ||
            "Estamos verificando el intento con Mercado Pago. Probá nuevamente en unos instantes.",
        );
      }

      if (!response.ok) {
        throw new Error(data?.error || "Error al crear la suscripción");
      }

      const initPoint = data?.init_point || data?.initPoint || data?.url;

      if (!initPoint) {
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
    const num = Number.parseFloat(amount);
    if (!Number.isFinite(num)) return amount;
    // Solo informativo (el monto lo decide el servidor): sin «,00» cuando el valor es entero.
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(num);
  };

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);

  const discountedPrice = discountCodesEnabled && discount?.preview.finalAmount ? discount.preview.finalAmount : null;
  // Promotion by billing periods: the later price must be accepted expressly before the checkout is created.
  const promo = discountCodesEnabled && discount?.preview.promo ? discount.preview.promo : null;
  const promoBlocked = promo !== null && !promoAccepted;

  // Quien llega acá viene a contratar Premium: la membresía es el centro de la pantalla y las herramientas gratuitas quedan como apoyo.
  const canActivate = !checkingEmail && isAuthenticated && isEmailConfirmed && !activated;
  const premiumBenefits = comparison.rows.filter((row) => row.featured);
  // Si alguien llega sin sesión conserva la intención de contratar al iniciar sesión o registrarse.
  const returnPath = feature ? `${PREMIUM_RETURN_TO}?feature=${encodeURIComponent(feature)}` : PREMIUM_RETURN_TO;

  return (
    <div className="flex min-h-dvh w-full items-start justify-center bg-stampa-bg px-4 py-10 text-stampa-text sm:items-center sm:px-6">
      <div className="w-full min-w-0 max-w-lg space-y-6">
        <header className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-stampa-orange-border bg-stampa-orange-muted">
            <Sparkles className="h-6 w-6 text-stampa-accent" aria-hidden="true" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stampa-accent">Universo Stampa</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-stampa-text sm:text-3xl">
            {checkingEmail
              ? "Universo Stampa"
              : !isAuthenticated
                ? "Para activar Premium, entrá a tu cuenta"
                : !isEmailConfirmed
                  ? "Confirmá tu email para continuar"
                  : lockedFeature
                    ? `Desbloqueá ${lockedFeature.title} con Premium`
                    : "Activá tu membresía Premium"}
          </h1>
          {checkingEmail ? (
            <p className="mt-3 text-sm text-stampa-text-muted">Verificando estado de tu cuenta...</p>
          ) : !isAuthenticated ? (
            <p className="mt-3 text-sm text-stampa-text-muted">
              Primero iniciá sesión o creá tu cuenta. Después activás tu membresía con Mercado Pago.
            </p>
          ) : !isEmailConfirmed ? (
            <p className="mt-3 text-sm text-stampa-text-muted">
              Confirmá tu email para activar tu cuenta y seguir con tu membresía. Revisá tu bandeja de entrada o spam.
            </p>
          ) : (
            <p className="mt-3 text-sm text-stampa-text-muted">
              {lockedFeature?.description ?? "Mi Taller, Academia, Stampy IA y la Librería STL, en una sola membresía."}
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

        {!checkingEmail && !isAuthenticated && (
          <section className="space-y-3" aria-label="Acceder">
            <Link
              href={premiumAuthHref("registro", returnPath)}
              className="flex w-full items-center justify-center rounded-xl bg-stampa-orange px-3 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-stampa-orange-hover"
            >
              Crear mi cuenta
            </Link>
            <Link
              href={premiumAuthHref("login", returnPath)}
              className="flex w-full items-center justify-center rounded-xl border border-stampa-border bg-stampa-surface px-3 py-3 text-sm font-semibold text-stampa-text transition-colors hover:bg-stampa-surface-soft"
            >
              Ya tengo cuenta: iniciar sesión
            </Link>
            <Link
              href="/verificar-email"
              className="flex items-center justify-center gap-2 pt-1 text-sm text-stampa-text-muted hover:text-stampa-text hover:underline"
            >
              <MailCheck size={15} aria-hidden="true" /> ¿Te registraste y no confirmaste tu email?
            </Link>
          </section>
        )}

        {canActivate && (
          <section
            aria-labelledby="premium-title"
            className="relative overflow-hidden rounded-3xl border border-stampa-orange-border bg-stampa-surface p-5 text-left shadow-lg shadow-stampa-orange/10 sm:p-6"
          >
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-stampa-orange/15 blur-3xl" />
            <div className="relative">
              <h2
                id="premium-title"
                className="inline-flex rounded-full border border-stampa-orange-border bg-stampa-orange-muted px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-stampa-accent"
              >
                Membresía Premium
              </h2>

              <div className="mt-4" aria-live="polite">
                {loadingPrice ? (
                  <p className="inline-flex items-center gap-2 text-sm text-stampa-text-muted">
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Cargando precio...
                  </p>
                ) : price && discountedPrice !== null ? (
                  <>
                    <p className="text-sm text-stampa-text-muted line-through">{formatPrice(price)}</p>
                    <p className="text-4xl font-black tracking-tight text-stampa-text">
                      {formatMoney(discountedPrice)} <span className="text-base font-medium text-stampa-text-muted">/ mes</span>
                    </p>
                  </>
                ) : price ? (
                  <p className="text-4xl font-black tracking-tight text-stampa-text">
                    {formatPrice(price)} <span className="text-base font-medium text-stampa-text-muted">/ mes</span>
                  </p>
                ) : (
                  <p className="text-base text-stampa-text-muted">El precio se confirma en Mercado Pago antes de pagar.</p>
                )}
                <p className="mt-1 text-xs text-stampa-text-muted">Renovación mensual. Se paga con Mercado Pago.</p>
              </div>

              {discountCodesEnabled && !loadingPrice && price && (
                <DiscountCodeField applied={discount} onApplied={setDiscount} disabled={loading} />
              )}

              {promo && discountedPrice !== null && (
                <div className="mt-4 rounded-xl border border-stampa-orange-border bg-stampa-orange-muted/40 p-3 text-left text-sm text-stampa-text" data-testid="promo-terms">
                  <p className="font-semibold">Condiciones de la promoción</p>
                  <p className="mt-1 text-stampa-text-muted">
                    Pagás {formatMoney(discountedPrice)} por mes durante tus primeros {promo.promoCycles} períodos mensuales de facturación.
                    Desde el período {promo.promoCycles + 1} pagás <strong className="text-stampa-text">{formatMoney(promo.postPrice)} por mes</strong>.
                    Mercado Pago aplica el cambio automáticamente y te avisamos por correo y dentro de la plataforma antes de que ocurra. Podés cancelar cuando quieras.
                  </p>
                  <label className="mt-3 flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={promoAccepted}
                      onChange={(event) => setPromoAcceptedFor(event.target.checked ? appliedCode : null)}
                      disabled={loading}
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <span>
                      Acepto pagar {formatMoney(discountedPrice)} por mes durante {promo.promoCycles} períodos y {formatMoney(promo.postPrice)} por mes desde el período {promo.promoCycles + 1}.
                    </span>
                  </label>
                </div>
              )}

              <button
                type="button"
                onClick={handleCreateSubscription}
                disabled={loading || checkingEmail || promoBlocked}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-stampa-orange px-3 py-3.5 text-base font-semibold text-neutral-950 shadow-lg shadow-stampa-orange/20 transition-colors hover:bg-stampa-orange-hover disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {loading ? "Generando link..." : "Activar membresía"}
              </button>
              <p className="mt-2 text-center text-xs text-stampa-text-muted">El valor y los medios de pago se muestran antes de confirmar.</p>

              <h3 className="mt-6 border-t border-stampa-border pt-5 text-xs font-bold uppercase tracking-[0.16em] text-stampa-accent">Qué incluye</h3>
              <ul className="mt-2 divide-y divide-stampa-border">
                {premiumBenefits.map((row) => (
                  <li key={row.name} className="flex gap-3 py-3 text-sm">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-stampa-accent" aria-hidden="true" />
                    <span className="min-w-0 text-stampa-text-muted">
                      <strong className="block text-base font-semibold text-stampa-text">{row.name}</strong>
                      {row.premium}
                    </span>
                  </li>
                ))}
              </ul>

              <details className="mt-3 text-left text-xs text-stampa-text-muted">
                <summary className="cursor-pointer select-none py-1 hover:text-stampa-text">
                  ¿No pudiste pagar o querés pagar con otra cuenta de Mercado Pago?
                </summary>
                <div className="mt-2 space-y-2">
                  <p>
                    Tu membresía queda en esta cuenta de Universo. Si pagás con otra cuenta de Mercado Pago,
                    escribí su email: Mercado Pago solo deja pagar a la cuenta con ese email.
                  </p>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={payerEmail}
                    onChange={(event) => setPayerEmail(event.target.value)}
                    placeholder="Email de la cuenta de Mercado Pago (opcional)"
                    disabled={loading}
                    className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2 text-base text-stampa-text"
                  />
                  <button
                    type="button"
                    onClick={(event) => handleCreateSubscription(event, true)}
                    disabled={loading || checkingEmail}
                    className="w-full rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2 text-sm font-semibold text-stampa-text-soft hover:bg-stampa-surface-soft disabled:opacity-60"
                  >
                    Empezar un pago nuevo
                  </button>
                  <p>Si ya pagaste, no uses esta opción: tocá «Actualizar acceso». Un pago ya aprobado nunca se reemplaza.</p>
                </div>
              </details>
            </div>
          </section>
        )}

        {canActivate && (
          <BetaCodeRedeemCard
            title="¿Tenés un código de invitación?"
            submitLabel="Activar acceso"
            hint={null}
            onRedeemed={handleBetaRedeemed}
          />
        )}

        {canActivate && (
          <section className="rounded-2xl border border-stampa-border bg-stampa-surface p-4 text-left" aria-labelledby="free-tools-title">
            <h2 id="free-tools-title" className="text-sm font-bold text-stampa-text">También podés usar con tu cuenta</h2>
            <div className="mt-3 grid gap-2">
              {calculatorAvailable && (
                <Link
                  href="/calculadora"
                  className="flex items-center gap-3 rounded-xl border border-stampa-border bg-stampa-bg-soft p-3 transition-colors hover:border-stampa-orange-border"
                >
                  <Calculator size={18} className="shrink-0 text-stampa-accent" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-stampa-text">Calculadora</span>
                    <span className="block text-xs text-stampa-text-muted">Calculá costos y precios de tus impresiones.</span>
                  </span>
                </Link>
              )}
              <Link
                href="/perfil"
                className="flex items-center gap-3 rounded-xl border border-stampa-border bg-stampa-bg-soft p-3 transition-colors hover:border-stampa-orange-border"
              >
                <UserRound size={18} className="shrink-0 text-stampa-accent" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-stampa-text">Perfil y cuenta</span>
                  <span className="block text-xs text-stampa-text-muted">Tus datos, contraseña y estado de membresía.</span>
                </span>
              </Link>
            </div>
          </section>
        )}

        {isAuthenticated && (
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
        )}
      </div>
    </div>
  );
}
