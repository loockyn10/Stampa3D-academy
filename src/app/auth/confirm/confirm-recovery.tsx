"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { AuthBrand } from "@/components/auth/AuthBrand";
import { friendlyAuthError } from "@/lib/auth/auth-errors";
import { parseRecoveryLink, RECOVERY_NEXT_PATH } from "@/lib/auth/recovery-link";

/**
 * Landing page of the password-recovery e-mail (`/auth/confirm?token_hash=…&type=recovery`).
 *
 * The token is NOT consumed when the page loads: e-mail security scanners and link previewers only GET the page and would
 * burn a one-time link. It is exchanged (`verifyOtp`) when the person presses the button. `token_hash` needs no PKCE
 * verifier, so the link works from any browser or device (Gmail/Outlook apps, another phone…).
 * Nothing here logs or displays the token.
 */
export function ConfirmRecovery() {
  const link = parseRecoveryLink(useSearchParams());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const handleContinue = async () => {
    if (!link || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: link.tokenHash });
      if (verifyError) {
        setError(friendlyAuthError(verifyError, "update_password").message);
        setIsLoading(false);
        return;
      }
      // Full navigation: the session cookie is already set and the proxy must see it on the next request.
      window.location.assign(RECOVERY_NEXT_PATH);
    } catch {
      setError(friendlyAuthError({ message: "network" }, "recovery").message);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-stampa-bg px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-stampa-border bg-stampa-surface p-8 shadow-sm">
        <div className="flex flex-col items-center justify-center">
          <AuthBrand />
          <h1 className="mt-6 text-center text-3xl font-bold tracking-tight text-fg">Cambiar contraseña</h1>
          <p className="mt-2 text-center text-sm text-gray-400">
            {link ? "Tocá el botón para elegir tu contraseña nueva." : "Este enlace no es válido."}
          </p>
        </div>

        {error && (
          <div role="alert" className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">
            <p>{error}</p>
            <Link href="/recuperar-password" className="inline-block font-semibold text-stampa-accent hover:underline">
              Pedir un enlace nuevo
            </Link>
          </div>
        )}

        {link ? (
          <button
            type="button"
            onClick={handleContinue}
            disabled={isLoading}
            className="group relative flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-stampa-orange px-3 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-stampa-orange-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-70"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {isLoading ? "Validando el enlace..." : "Continuar y elegir contraseña nueva"}
          </button>
        ) : (
          <div className="space-y-4 text-center">
            <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-500">
              El enlace está incompleto o no corresponde a un cambio de contraseña. Pedí uno nuevo.
            </p>
            <Link href="/recuperar-password" className="inline-block text-sm font-semibold text-stampa-accent hover:underline">
              Pedir un enlace nuevo
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
