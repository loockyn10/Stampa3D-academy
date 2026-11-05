"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, MailCheck, RefreshCw } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { AuthBrand } from "@/components/auth/AuthBrand";
import { AUTH_NOTICE_MESSAGES, friendlyAuthError } from "@/lib/auth/auth-errors";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import {
  emailConfirmationRedirect,
  maskEmail,
  readPendingVerificationEmail,
  savePendingVerificationEmail,
} from "@/lib/auth/pending-verification";

// Supabase allows one confirmation email per address every 60 s by default.
const subscribeNoop = () => () => undefined;
const RESEND_COOLDOWN_SECONDS = 60;

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const notice = AUTH_NOTICE_MESSAGES[searchParams.get("estado") ?? ""] ?? null;
  // Read after hydration (sessionStorage does not exist on the server): avoids a hydration mismatch.
  const pendingEmail = useSyncExternalStore(subscribeNoop, readPendingVerificationEmail, () => null);
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const storedEmail = savedEmail ?? pendingEmail;
  const [email, setEmail] = useState("");
  const [editingRequested, setEditing] = useState(false);
  const editing = editingRequested || !storedEmail;
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const loginHref = returnTo === "/" ? "/login" : `/login?returnTo=${encodeURIComponent(returnTo)}`;

  const resend = async (event: React.FormEvent) => {
    event.preventDefault();
    const target = (editing ? email : storedEmail ?? "").trim();
    if (!target.includes("@")) {
      setResult({ ok: false, message: "Ingresá el email con el que te registraste." });
      return;
    }
    setSending(true);
    setResult(null);
    const { error } = await createClient().auth.resend({
      type: "signup",
      email: target,
      options: { emailRedirectTo: emailConfirmationRedirect(window.location.origin, returnTo) },
    });
    setSending(false);
    if (error) {
      const friendly = friendlyAuthError(error, "resend");
      if (friendly.rateLimited) setCooldown(RESEND_COOLDOWN_SECONDS);
      setResult({ ok: false, message: friendly.message });
      return;
    }
    savePendingVerificationEmail(target);
    setSavedEmail(target);
    setEditing(false);
    setCooldown(RESEND_COOLDOWN_SECONDS);
    // Same answer whether or not the address has a pending account (no account enumeration).
    setResult({ ok: true, message: "Si hay una cuenta pendiente de confirmar con ese email, te enviamos un nuevo enlace." });
  };

  return (
    <div className="flex min-h-dvh items-start justify-center bg-stampa-bg px-4 py-10 text-stampa-text sm:items-center">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-stampa-border bg-stampa-surface p-6 shadow-xl sm:p-8">
        <AuthBrand />

        <header className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-stampa-orange-border bg-stampa-orange-muted">
            <MailCheck className="h-6 w-6 text-stampa-accent" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">Confirmá tu email</h1>
          <p className="mt-2 text-sm leading-relaxed text-stampa-text-muted">
            {storedEmail ? (
              <>Te enviamos un enlace a <strong className="text-fg">{maskEmail(storedEmail)}</strong>. Abrilo para activar tu cuenta.</>
            ) : (
              "Te enviamos un enlace al email con el que te registraste. Abrilo para activar tu cuenta."
            )}
          </p>
        </header>

        {notice && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{notice}</p>
          </div>
        )}

        <ul className="space-y-2 rounded-xl border border-stampa-border bg-stampa-bg-soft p-4 text-sm text-stampa-text-muted">
          <li>• Revisá la bandeja de entrada y también <strong className="text-fg">spam</strong> o <strong className="text-fg">promociones</strong>.</li>
          <li>• Puede tardar unos minutos en llegar.</li>
          <li>• El enlace vence: si no funciona, pedí uno nuevo acá abajo.</li>
          <li>• Si abrís el enlace en otro dispositivo y no entra solo, volvé e iniciá sesión: tu email ya queda confirmado.</li>
        </ul>

        <form onSubmit={resend} className="space-y-3" noValidate>
          {editing ? (
            <div>
              <label htmlFor="verify-email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-stampa-text-muted">
                Email de tu cuenta
              </label>
              <input
                id="verify-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="block w-full rounded-xl border border-stampa-border bg-fg/5 px-3 py-3 text-sm text-fg outline-none transition-all placeholder:text-neutral-500 focus:border-stampa-orange/60 focus:ring-2 focus:ring-stampa-orange/20"
                placeholder="tu@email.com"
              />
            </div>
          ) : (
            <button type="button" onClick={() => { setEmail(storedEmail ?? ""); setEditing(true); }} className="text-sm font-medium text-stampa-accent hover:underline">
              ¿No es tu email? Corregirlo
            </button>
          )}

          <button
            type="submit"
            disabled={sending || cooldown > 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-stampa-orange px-4 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-stampa-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {sending ? "Enviando…" : cooldown > 0 ? `Podés reenviar en ${cooldown} s` : "Reenviar el email"}
          </button>

          {result && (
            <p
              role={result.ok ? "status" : "alert"}
              className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${result.ok ? "border-green-500/30 bg-green-500/10 text-green-500" : "border-red-500/30 bg-red-500/10 text-red-500"}`}
            >
              {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
              {result.message}
            </p>
          )}
        </form>

        <div className="flex flex-col gap-2 border-t border-stampa-border pt-5 text-center text-sm">
          <Link href={loginHref} className="font-semibold text-stampa-accent hover:underline">Ya confirmé: iniciar sesión</Link>
          <Link href="/registro" className="text-stampa-text-muted hover:text-fg hover:underline">Registrarme con otro email</Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stampa-bg" />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
