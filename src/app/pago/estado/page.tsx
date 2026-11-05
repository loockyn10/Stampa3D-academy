"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { MembershipDto } from "@/lib/mercadopago/membership-http";

// Mercado Pago usually confirms the first charge within seconds of the redirect; we re-check for ~40 s.
const AUTO_RETRY_DELAY_MS = 5_000;
const AUTO_RETRY_LIMIT = 8;

interface SyncResponse {
  active?: boolean;
  status?: string;
  /** Mercado Pago reports money collected that is not matched to an approved payment yet. */
  charge_unverified?: boolean;
  membership?: MembershipDto;
  error?: string;
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })
    : null;
}

type SyncOutcome =
  | { kind: "ok"; data: SyncResponse }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string };

async function requestSync(): Promise<SyncOutcome> {
  try {
    const response = await fetch("/api/mercadopago/sync-subscription", { method: "POST", cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as SyncResponse;
    if (response.status === 401) return { kind: "unauthenticated" };
    if (!response.ok) return { kind: "error", message: data.error || "No pudimos verificar tu membresía." };
    return { kind: "ok", data };
  } catch {
    return { kind: "error", message: "No pudimos verificar tu membresía." };
  }
}

const primaryButton =
  "w-full rounded-lg bg-stampa-orange px-3 py-3 text-sm font-semibold text-neutral-950 hover:bg-stampa-orange-hover transition-colors disabled:opacity-60";
const secondaryButton =
  "w-full rounded-lg bg-stampa-surface border border-fg/20 px-3 py-3 text-sm font-semibold text-gray-300 hover:bg-stampa-bg-soft transition-colors";

export default function PagoEstadoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [autoRetries, setAutoRetries] = useState(0);
  const timer = useRef<number | null>(null);

  const applyResult = useCallback((outcome: SyncOutcome) => {
    if (outcome.kind === "unauthenticated") {
      router.replace("/login?returnTo=%2Fpago%2Festado");
      return;
    }
    if (outcome.kind === "error") {
      setError(outcome.message);
    } else {
      setError(null);
      setResult(outcome.data);
      if (outcome.data.active) {
        timer.current = window.setTimeout(() => router.push("/"), 2500);
      }
    }
    setLoading(false);
  }, [router]);

  const checkStatus = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    void requestSync().then(applyResult);
  }, [applyResult]);

  useEffect(() => {
    let active = true;
    void requestSync().then((outcome) => {
      if (active) applyResult(outcome);
    });
    return () => {
      active = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [applyResult]);

  const state = result?.membership?.state ?? null;
  const chargeUnverified = !result?.active && result?.charge_unverified === true;
  const waitingForPayment = !result?.active && (state === "pending" || chargeUnverified);

  // While Mercado Pago confirms the first charge, re-check automatically a few times.
  useEffect(() => {
    if (!waitingForPayment || loading || autoRetries >= AUTO_RETRY_LIMIT) return;
    const handle = window.setTimeout(() => {
      setAutoRetries((count) => count + 1);
      void checkStatus(true);
    }, AUTO_RETRY_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [waitingForPayment, loading, autoRetries, checkStatus]);

  const accessUntil = formatDate(result?.membership?.access_until);
  const stillAutoChecking = waitingForPayment && autoRetries < AUTO_RETRY_LIMIT;

  return (
    <div className="flex min-h-screen items-center justify-center bg-stampa-bg px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-stampa-border bg-stampa-surface p-8 text-center shadow-sm">
        {loading && (
          <div className="flex flex-col items-center justify-center" role="status">
            <Loader2 className="mb-4 h-12 w-12 animate-spin text-stampa-accent" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight text-fg">Estamos verificando tu membresía…</h1>
            <p className="mt-2 text-sm text-gray-400">Por favor aguardá un momento.</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center" role="alert">
            <AlertCircle className="mb-4 h-12 w-12 text-red-500" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight text-fg">No pudimos verificar el pago</h1>
            <p className="mb-6 mt-2 text-sm text-gray-400">{error} Si ya pagaste, no vuelvas a pagar: tu acceso se activa cuando Mercado Pago lo confirme.</p>
            <button onClick={() => void checkStatus()} className={primaryButton}>Reintentar</button>
          </div>
        )}

        {!loading && !error && result && (
          <div className="flex flex-col items-center justify-center">
            {result.active ? (
              <>
                <CheckCircle2 className="mb-4 h-12 w-12 text-green-500" aria-hidden="true" />
                <h1 className="text-2xl font-bold tracking-tight text-fg">
                  {state === "cancelled_with_access" ? "Suscripción cancelada" : "¡Tu membresía está activa!"}
                </h1>
                <p className="mb-6 mt-2 text-sm text-gray-400">
                  {state === "cancelled_with_access" && accessUntil
                    ? `No se te va a cobrar de nuevo. Conservás el acceso hasta el ${accessUntil}. `
                    : ""}
                  Te llevamos al inicio en un instante…
                </p>
              </>
            ) : waitingForPayment ? (
              <>
                <Clock className="mb-4 h-12 w-12 text-amber-500" aria-hidden="true" />
                <h1 className="text-2xl font-bold tracking-tight text-fg">
                  {chargeUnverified ? "Estamos verificando tu pago" : "Esperando la confirmación del pago"}
                </h1>
                <p className="mb-6 mt-2 text-sm text-gray-400" role="status">
                  {chargeUnverified
                    ? "Mercado Pago registra un cobro de tu suscripción y lo estamos confirmando. No vuelvas a pagar: tu acceso se activa en cuanto se confirme. Si en unas horas no se activó, escribinos."
                    : stillAutoChecking
                    ? "Mercado Pago está procesando tu pago. Esta pantalla se actualiza sola."
                    : "Mercado Pago todavía no confirmó el pago. Puede tardar unos minutos: te avisamos en Mi membresía. No hace falta volver a pagar."}
                </p>
                <div className="flex w-full flex-col gap-3">
                  <button onClick={() => void checkStatus()} className={primaryButton} disabled={stillAutoChecking}>
                    {stillAutoChecking ? "Verificando…" : "Verificar de nuevo"}
                  </button>
                  <button onClick={() => router.push("/perfil")} className={secondaryButton}>Ir a Mi membresía</button>
                </div>
              </>
            ) : state === "payment_issue" ? (
              <>
                <XCircle className="mb-4 h-12 w-12 text-red-500" aria-hidden="true" />
                <h1 className="text-2xl font-bold tracking-tight text-fg">El pago fue rechazado</h1>
                <p className="mb-6 mt-2 text-sm text-gray-400">
                  Mercado Pago va a reintentar el cobro. Podés revisar tu medio de pago en tu cuenta de Mercado Pago o cancelar esta suscripción desde Mi membresía y volver a intentarlo.
                </p>
                <div className="flex w-full flex-col gap-3">
                  <button onClick={() => void checkStatus()} className={primaryButton}>Verificar de nuevo</button>
                  <button onClick={() => router.push("/perfil")} className={secondaryButton}>Ir a Mi membresía</button>
                </div>
              </>
            ) : result.status === "not_found" ? (
              <>
                <XCircle className="mb-4 h-12 w-12 text-gray-400" aria-hidden="true" />
                <h1 className="text-2xl font-bold tracking-tight text-fg">No encontramos una suscripción</h1>
                <p className="mb-6 mt-2 text-sm text-gray-400">No hay una suscripción asociada a tu cuenta.</p>
                <button onClick={() => router.push("/sin-acceso")} className={primaryButton}>Ver la membresía</button>
              </>
            ) : (
              <>
                <AlertCircle className="mb-4 h-12 w-12 text-gray-400" aria-hidden="true" />
                <h1 className="text-2xl font-bold tracking-tight text-fg">Tu membresía no está activa</h1>
                <p className="mb-6 mt-2 text-sm text-gray-400">
                  {state === "paused" ? "La suscripción está pausada." : state === "expired" ? "La suscripción terminó." : "No encontramos un pago aprobado."} Revisá el detalle en Mi membresía.
                </p>
                <div className="flex w-full flex-col gap-3">
                  <button onClick={() => router.push("/perfil")} className={primaryButton}>Ir a Mi membresía</button>
                  <button onClick={() => router.push("/sin-acceso")} className={secondaryButton}>Ver la membresía</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
