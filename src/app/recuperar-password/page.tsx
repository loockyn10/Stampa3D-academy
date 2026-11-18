"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import { Mail, ArrowLeft } from "lucide-react";
import { AuthBrand } from "@/components/auth/AuthBrand";
import { friendlyAuthError } from "@/lib/auth/auth-errors";
import {
  EMAIL_RESEND_COOLDOWN_SECONDS,
  formatCooldown,
  remainingEmailCooldown,
  startEmailCooldown,
} from "@/lib/auth/email-cooldown";

const EXPIRED_LINK_NOTICE = "El enlace para cambiar la contraseña venció o ya se usó. Pedí uno nuevo.";
/** The link was valid but could not be opened here (e-mail app's browser, another device, or a second click). */
const OTHER_BROWSER_NOTICE =
  "No pudimos abrir el enlace en este navegador. Abrilo en el mismo navegador y dispositivo desde donde pediste el cambio, o pedí uno nuevo acá y abrilo en este mismo lugar.";

export default function RecuperarPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stampa-bg" />}>
      <RecuperarPasswordContent />
    </Suspense>
  );
}

function RecuperarPasswordContent() {
  const estado = useSearchParams().get("estado");
  const linkNotice = estado === "otro-navegador" ? OTHER_BROWSER_NOTICE : estado === "enlace-invalido" ? EXPIRED_LINK_NOTICE : null;
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const supabase = createClient();

  // Same per-tab wait as the confirmation resend: a reload does not allow a burst of recovery e-mails.
  useEffect(() => {
    const left = remainingEmailCooldown("password_recovery");
    if (left <= 0) return;
    // Read from storage once mounted; the state is set from a callback (no synchronous setState in the effect).
    const timer = window.setTimeout(() => setCooldown(left), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || cooldown > 0) return;
    if (!email.trim()) {
      setError("Por favor ingresá tu correo electrónico.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    // Same origin as the request (like the sign-up): the PKCE verifier lives in THIS browser and origin, so a link
    // pointing to another host (e.g. www vs. apex, or a stale NEXT_PUBLIC_APP_URL) could never be exchanged.
    const redirectToUrl = `${window.location.origin}/auth/callback?next=/actualizar-password`;

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirectToUrl,
      });

      if (resetError) {
        const friendly = friendlyAuthError(resetError, "recovery");
        if (friendly.rateLimited) setCooldown(startEmailCooldown("password_recovery", friendly.retryAfterSeconds ?? EMAIL_RESEND_COOLDOWN_SECONDS));
        setError(friendly.message);
        return;
      }

      setCooldown(startEmailCooldown("password_recovery", EMAIL_RESEND_COOLDOWN_SECONDS));
      // Same answer whether or not the address has an account (no account enumeration).
      setSuccessMsg("Si hay una cuenta con ese email, te enviamos un enlace para cambiar la contraseña. Revisá la bandeja de entrada y spam.");
    } catch {
      setError(friendlyAuthError({ message: "network" }, "recovery").message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-stampa-bg px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-stampa-surface p-8 rounded-2xl shadow-sm border border-stampa-border">
        <div className="flex flex-col items-center justify-center">
          <AuthBrand />
          <h1 className="mt-6 text-center text-3xl font-bold tracking-tight text-fg">
            Recuperar contraseña
          </h1>
          <p className="mt-2 text-center text-sm text-gray-400">
            Ingresá tu correo para recibir las instrucciones de restablecimiento
          </p>
        </div>

        {linkNotice && !successMsg && (
          <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-500">
            {linkNotice}
          </div>
        )}

        {successMsg ? (
          <div className="space-y-6">
            <div role="status" className="space-y-2 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-500">
              <p>{successMsg}</p>
              <p className="text-stampa-text-muted">Abrí el enlace en este mismo navegador. Puede tardar unos minutos en llegar.</p>
            </div>
            <div className="flex flex-col items-center gap-3 text-center">
              <button
                type="button"
                onClick={() => setSuccessMsg(null)}
                disabled={cooldown > 0}
                className="text-sm font-medium text-stampa-text-muted hover:text-fg hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
              >
                {cooldown > 0 ? `¿No llegó? Podés pedir otro en ${formatCooldown(cooldown)}` : "¿No llegó? Pedir otro enlace"}
              </button>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-sm font-medium text-stampa-accent hover:text-stampa-accent transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Volver al inicio de sesión
              </Link>
            </div>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleResetPassword}>
            {error && (
              <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">
                {error}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="email-address"
                  className="block text-sm font-medium text-gray-300"
                >
                  Email
                </label>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Mail className="h-5 w-5 text-gray-400" aria-hidden="true" />
                  </div>
                  <input
                    id="email-address"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full rounded-xl border border-stampa-border bg-fg/5 py-3 pl-10 text-base text-fg outline-none transition-all placeholder:text-neutral-500 focus:border-stampa-orange/60 focus:ring-2 focus:ring-stampa-orange/20 sm:text-sm"
                    placeholder="tu@email.com"
                  />
                </div>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading || cooldown > 0}
                className="group relative flex w-full justify-center rounded-xl bg-stampa-orange px-3 py-3 text-sm font-semibold text-neutral-950 hover:bg-stampa-orange-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:cursor-not-allowed disabled:opacity-70 transition-colors cursor-pointer"
              >
                {isLoading ? "Enviando..." : cooldown > 0 ? `Podés pedir otro en ${formatCooldown(cooldown)}` : "Enviar instrucciones"}
              </button>
            </div>

            <div className="text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-fg transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Volver al inicio de sesión
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
