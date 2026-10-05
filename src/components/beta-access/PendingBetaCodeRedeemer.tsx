"use client";

import { useEffect } from "react";
import { redeemBetaAccessCodeAction } from "@/app/beta-access/actions";
import { isDefinitiveBetaOutcome } from "@/lib/beta-access/code";
import { clearPendingBetaCode, readPendingBetaCode } from "@/lib/beta-access/pending-code";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { createClient } from "@/utils/supabase/client";

let inFlight = false;

/**
 * Completes a beta redemption that was started at signup but could not finish because the email had to
 * be confirmed first. It only acts when this browser has a pending code AND an authenticated session;
 * the code is always validated server-side (identity = the session user). The Perfil / Sin acceso
 * "Canjear código" card remains the manual fallback (e.g. email confirmed on another device).
 */
export function PendingBetaCodeRedeemer() {
  const { toast } = useAppFeedback();

  useEffect(() => {
    const supabase = createClient();

    const attempt = async () => {
      const pending = readPendingBetaCode();
      if (!pending || inFlight) return;
      inFlight = true;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;

        const result = await redeemBetaAccessCodeAction(pending);
        if (isDefinitiveBetaOutcome(result.status)) clearPendingBetaCode();

        if (result.status === "redeemed") {
          toast.success(result.message);
          const destination = window.location.pathname === "/sin-acceso" ? "/" : window.location.pathname;
          window.setTimeout(() => window.location.assign(destination), 900);
        } else if (!result.ok && isDefinitiveBetaOutcome(result.status)) {
          toast.error(`${result.message} Podés probar de nuevo desde Perfil.`);
        }
      } catch {
        // Keep the pending code; the manual card is always available.
      } finally {
        inFlight = false;
      }
    };

    void attempt();
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      // Deferred: supabase-js must not be re-entered from inside its own auth callback.
      if (event === "SIGNED_IN") window.setTimeout(() => void attempt(), 0);
    });

    return () => subscription.subscription.unsubscribe();
  }, [toast]);

  return null;
}
