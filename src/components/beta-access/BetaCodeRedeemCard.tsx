"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, FlaskConical, Loader2 } from "lucide-react";
import { redeemBetaAccessCodeAction } from "@/app/beta-access/actions";
import {
  BETA_CODE_MAX_INPUT_LENGTH,
  BETA_EMPTY_CODE_MESSAGE,
  normalizeBetaAccessCode,
  type BetaRedeemResult,
} from "@/lib/beta-access/code";
import { clearPendingBetaCode } from "@/lib/beta-access/pending-code";

interface BetaCodeRedeemCardProps {
  /** Where to go (full navigation, so access is re-evaluated) after a successful redemption. */
  redirectTo?: string;
  className?: string;
}

export function BetaCodeRedeemCard({ redirectTo = "/", className = "" }: BetaCodeRedeemCardProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BetaRedeemResult | null>(null);
  const [emptyError, setEmptyError] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;

    if (!normalizeBetaAccessCode(code)) {
      setEmptyError(true);
      setResult(null);
      return;
    }

    setEmptyError(false);
    setLoading(true);
    setResult(null);
    try {
      const outcome = await redeemBetaAccessCodeAction(code);
      setResult(outcome);
      if (outcome.status === "redeemed") {
        clearPendingBetaCode();
        window.setTimeout(() => window.location.assign(redirectTo), 900);
      }
    } finally {
      setLoading(false);
    }
  };

  const succeeded = result?.ok === true;
  const message = emptyError ? BETA_EMPTY_CODE_MESSAGE : result?.message ?? null;

  return (
    <section className={`min-w-0 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-left ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <FlaskConical size={16} className="shrink-0 text-cyan-400" aria-hidden="true" />
        <h3 className="text-sm font-bold text-white">Canjear código de invitación</h3>
      </div>

      <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-2 sm:flex-row" noValidate>
        <label htmlFor="beta-redeem-code" className="sr-only">Código de invitación</label>
        <input
          id="beta-redeem-code"
          name="beta-redeem-code"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={BETA_CODE_MAX_INPUT_LENGTH}
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setEmptyError(false);
          }}
          placeholder="UNIVERSO-BETA-XXXX"
          aria-describedby="beta-redeem-message"
          className="block min-w-0 flex-1 rounded-xl border border-stampa-border bg-white/5 px-3 py-3 font-mono text-base tracking-wider text-neutral-100 placeholder-neutral-600 outline-none transition-all focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 sm:text-sm"
        />
        <button
          type="submit"
          disabled={loading || succeeded}
          className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-500/15 px-4 py-3 text-sm font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
        >
          {loading && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          {loading ? "Canjeando..." : "Canjear"}
        </button>
      </form>

      <div id="beta-redeem-message" aria-live="polite" className="min-w-0">
        {message && (
          <p
            role={succeeded ? "status" : "alert"}
            className={`mt-3 flex items-start gap-2 text-sm leading-snug ${succeeded ? "text-emerald-300" : "text-red-300"}`}
          >
            {succeeded
              ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              : <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 break-words">{message}</span>
          </p>
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-gray-500">
        Si sos Beta Tester, ingresá el código que te compartimos para activar el acceso completo.
      </p>
    </section>
  );
}
