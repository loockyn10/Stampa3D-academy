"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Clock, CreditCard, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { membershipOffer } from "@/components/landing-membership/landing-content";
import type { MembershipDto } from "@/lib/mercadopago/membership-http";

type MembershipState = MembershipDto["state"];

interface StateCopy {
  title: string;
  tone: "ok" | "warn" | "muted" | "error";
  badge: string;
}

const STATE_COPY: Record<MembershipState, StateCopy> = {
  active: { title: "Membresía Premium activa", tone: "ok", badge: "Activa" },
  payment_issue: { title: "Hubo un problema con tu último pago", tone: "error", badge: "Pago rechazado" },
  pending: { title: "Esperando la confirmación del pago", tone: "warn", badge: "Pago pendiente" },
  cancelled_with_access: { title: "Cancelaste la renovación", tone: "muted", badge: "No se renueva" },
  paused_with_access: { title: "Suscripción pausada", tone: "muted", badge: "Pausada" },
  paused: { title: "Suscripción pausada", tone: "warn", badge: "Pausada" },
  manual: { title: "Acceso otorgado por el equipo", tone: "ok", badge: "Acceso especial" },
  expired: { title: "Tu membresía venció", tone: "muted", badge: "Vencida" },
  none: { title: "Todavía no tenés una membresía", tone: "muted", badge: "Sin membresía" },
};

const TONE_CLASSES: Record<StateCopy["tone"], string> = {
  ok: "border-green-500/30 bg-green-500/10 text-green-500",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  muted: "border-stampa-border bg-fg/5 text-stampa-text-muted",
  error: "border-red-500/30 bg-red-500/10 text-red-500",
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

function formatMoney(amount: number | null, currency: string | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: currency || "ARS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount}`;
  }
}

function describe(m: MembershipDto): string {
  const until = formatDate(m.access_until);
  const next = formatDate(m.next_charge_at);
  switch (m.state) {
    case "active":
      return next ? `Se renueva automáticamente el ${next}.` : "Se renueva automáticamente cada mes.";
    case "payment_issue":
      return until
        ? `Mercado Pago va a reintentar el cobro. Revisá tu medio de pago en tu cuenta de Mercado Pago. Mantenés el acceso hasta el ${until}.`
        : "Mercado Pago va a reintentar el cobro. Revisá tu medio de pago en tu cuenta de Mercado Pago: el acceso vuelve cuando se acredite un pago.";
    case "pending":
      return "Tu acceso se activa cuando Mercado Pago aprueba el pago. Suele tardar unos minutos.";
    case "cancelled_with_access":
      return until ? `No se te va a cobrar de nuevo. Conservás el acceso hasta el ${until}.` : "No se te va a cobrar de nuevo.";
    case "paused_with_access":
      return until ? `No hay cobros mientras esté pausada. Conservás el acceso hasta el ${until}.` : "No hay cobros mientras esté pausada.";
    case "paused":
      return "No hay cobros mientras esté pausada y tu acceso Premium está inactivo.";
    case "manual":
      return until ? `Tenés acceso Premium hasta el ${until}.` : "Tenés acceso Premium sin cobros automáticos.";
    case "expired":
      return "Ya no tenés acceso Premium. Podés volver a suscribirte cuando quieras.";
    case "none":
      return "Suscribite para acceder a la Academia, Stampy y todas las herramientas de Universo Stampa.";
  }
}

async function fetchMembership(): Promise<MembershipDto | Error> {
  try {
    const response = await fetch("/api/mercadopago/membership", { cache: "no-store" });
    const data = await readJson(response);
    if (!response.ok || !data.membership) {
      return new Error(typeof data.error === "string" ? data.error : "No pudimos cargar tu membresía.");
    }
    return data.membership as MembershipDto;
  } catch {
    return new Error("No pudimos cargar tu membresía.");
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * "Mi membresía": plan, price, renewal, payment status, cancellation. Used in Configuración → Membresía and in Perfil
 * (Perfil is reachable without Premium access, so a user whose renewals fail can still cancel).
 */
export function MembershipPanel({ compact = false }: { compact?: boolean }) {
  const titleId = useId();
  const dialogTitleId = useId();
  const [membership, setMembership] = useState<MembershipDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const applyLoad = useCallback((result: MembershipDto | Error) => {
    if (result instanceof Error) setError(result.message);
    else setMembership(result);
    setLoading(false);
  }, []);

  const load = () => {
    setLoading(true);
    setError(null);
    void fetchMembership().then(applyLoad);
  };

  useEffect(() => {
    let active = true;
    void fetchMembership().then((result) => {
      if (active) applyLoad(result);
    });
    return () => {
      active = false;
    };
  }, [applyLoad]);

  const refresh = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/mercadopago/sync-subscription", { method: "POST", cache: "no-store" });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "No pudimos verificar tu membresía.");
      if (data.membership) setMembership(data.membership as MembershipDto);
      setNotice("Estado actualizado con Mercado Pago.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos verificar tu membresía.");
    } finally {
      setSyncing(false);
    }
  };

  const cancel = async () => {
    if (!membership?.subscription_id || cancelling) return;
    setCancelling(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/mercadopago/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription_id: membership.subscription_id, confirm: true }),
      });
      const data = await readJson(response);
      if (data.membership) setMembership(data.membership as MembershipDto);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "No pudimos cancelar la suscripción.");
      const until = formatDate((data.membership as MembershipDto | undefined)?.access_until ?? null);
      setNotice(
        data.already_cancelled
          ? "Tu suscripción ya estaba cancelada en Mercado Pago."
          : until
            ? `Listo: cancelaste la renovación. No se te va a cobrar de nuevo y conservás el acceso hasta el ${until}.`
            : "Listo: cancelaste la suscripción. No se te va a cobrar de nuevo.",
      );
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cancelar la suscripción.");
      setConfirmOpen(false);
    } finally {
      setCancelling(false);
    }
  };

  const copy = membership ? STATE_COPY[membership.state] : null;
  const price = membership ? formatMoney(membership.amount, membership.currency) : null;
  const until = membership ? formatDate(membership.access_until) : null;
  const needsCheckout = membership?.state === "none" || membership?.state === "expired";

  return (
    <section
      className={`max-w-4xl rounded-2xl border border-stampa-border bg-stampa-surface ${compact ? "p-4" : "p-5 sm:p-6"}`}
      aria-labelledby={titleId}
      aria-busy={loading || syncing || cancelling}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-bold text-fg">Mi membresía</h2>
          <p className="mt-1 text-sm text-gray-400">{membershipOffer.name} · {membershipOffer.frequency}</p>
        </div>
        {copy && (
          <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${TONE_CLASSES[copy.tone]}`}>{copy.badge}</span>
        )}
      </div>

      {loading && (
        <div className="mt-5 flex items-center gap-2 text-sm text-gray-400" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando tu membresía…
        </div>
      )}

      {!loading && !membership && error && (
        <div className="mt-5 flex flex-col items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500" role="alert">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" aria-hidden="true" /> {error}</span>
          <Button variant="ghost" onClick={load}>Reintentar</Button>
        </div>
      )}

      {!loading && membership && copy && (
        <>
          <div className="mt-5 rounded-xl border border-stampa-border bg-stampa-bg-soft p-4">
            <p className="flex items-center gap-2 font-bold text-fg">
              {copy.tone === "ok" ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-hidden="true" />
              ) : copy.tone === "error" ? (
                <XCircle className="h-5 w-5 shrink-0 text-red-500" aria-hidden="true" />
              ) : copy.tone === "warn" ? (
                <Clock className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
              ) : (
                <CalendarClock className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
              )}
              {copy.title}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-400">{describe(membership)}</p>

            <dl className="mt-4 grid gap-2 border-t border-stampa-border pt-3 text-sm sm:grid-cols-2">
              {price && (
                <div className="flex justify-between gap-3 sm:block">
                  <dt className="font-semibold text-gray-500">Precio</dt>
                  <dd className="font-bold text-fg">{price} por mes</dd>
                </div>
              )}
              {membership.state === "active" || membership.state === "payment_issue" ? (
                membership.next_charge_at && (
                  <div className="flex justify-between gap-3 sm:block">
                    <dt className="font-semibold text-gray-500">Próximo cobro</dt>
                    <dd className="font-bold text-fg">{formatDate(membership.next_charge_at)}</dd>
                  </div>
                )
              ) : null}
              {until && (
                <div className="flex justify-between gap-3 sm:block">
                  <dt className="font-semibold text-gray-500">Acceso hasta</dt>
                  <dd className="font-bold text-fg">{until}</dd>
                </div>
              )}
              {membership.subscription_id && (
                <div className="flex justify-between gap-3 sm:block">
                  <dt className="font-semibold text-gray-500">Medio de pago</dt>
                  <dd className="flex items-center gap-1.5 font-bold text-fg"><CreditCard className="h-4 w-4" aria-hidden="true" /> Mercado Pago</dd>
                </div>
              )}
            </dl>
          </div>

          {!compact && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-fg">Incluye</p>
              <ul className="mt-2 grid gap-1.5 text-sm text-gray-400 sm:grid-cols-2">
                {membershipOffer.included.map((item) => (
                  <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-stampa-accent" aria-hidden="true" />{item}</li>
                ))}
              </ul>
            </div>
          )}

          {notice && (
            <p className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-500" role="status">{notice}</p>
          )}
          {error && (
            <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500" role="alert">{error}</p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            {needsCheckout && (
              <Button href="/sin-acceso">{membership.state === "expired" ? "Volver a suscribirme" : "Ver la membresía"}</Button>
            )}
            {membership.state === "pending" && membership.subscription_status === "pending" && <Button href="/sin-acceso">Completar el pago</Button>}
            {membership.subscription_id && (
              <Button variant="ghost" onClick={() => void refresh()} disabled={syncing || cancelling}>
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                {syncing ? "Verificando…" : "Actualizar estado"}
              </Button>
            )}
            {membership.can_cancel && (
              <Button
                variant="ghost"
                className="text-red-500 hover:text-red-500"
                onClick={() => setConfirmOpen(true)}
                disabled={cancelling || syncing}
              >
                Cancelar suscripción
              </Button>
            )}
          </div>

          {!compact && (
            <p className="mt-4 text-xs leading-relaxed text-gray-500">{membershipOffer.cancellation}</p>
          )}
        </>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => (cancelling ? undefined : setConfirmOpen(false))}
        labelledBy={dialogTitleId}
        panelClassName="max-w-md rounded-2xl border border-stampa-border bg-stampa-surface"
      >
        <div className="p-5">
          <h2 id={dialogTitleId} className="text-lg font-black text-fg">¿Cancelar tu suscripción?</h2>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-gray-400">
            <p>Mercado Pago no te va a cobrar más renovaciones.</p>
            {until ? (
              <p>Conservás el acceso Premium hasta el <strong className="text-fg">{until}</strong>. Después tu cuenta pasa a Free.</p>
            ) : (
              <p>Tu cuenta no tiene un período pago vigente, así que no conserva acceso Premium.</p>
            )}
            <p>No se puede deshacer: para volver vas a tener que suscribirte de nuevo.</p>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={cancelling}>Mantener membresía</Button>
            <Button
              className="!bg-red-600 !text-white hover:!bg-red-700"
              onClick={() => void cancel()}
              disabled={cancelling}
            >
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {cancelling ? "Cancelando…" : "Sí, cancelar"}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
