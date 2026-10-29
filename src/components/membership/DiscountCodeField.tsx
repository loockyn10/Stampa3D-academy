"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Tag, X } from "lucide-react";
import { previewDiscountCodeAction } from "@/app/sin-acceso/actions";
import {
  DISCOUNT_CODE_MAX_INPUT_LENGTH,
  normalizeDiscountCode,
  type DiscountPreview,
} from "@/lib/discounts/discount-codes";

export interface AppliedDiscount {
  /** Normalized code text: the only thing the checkout request carries. */
  code: string;
  preview: DiscountPreview;
}

interface DiscountCodeFieldProps {
  applied: AppliedDiscount | null;
  onApplied: (discount: AppliedDiscount | null) => void;
  disabled?: boolean;
}

/**
 * "Tengo un código" for the membership checkout. The preview comes from the server (database) for the session user;
 * the browser never computes a discounted price and only sends the code text when the checkout is created.
 */
export function DiscountCodeField({ applied, onApplied, disabled = false }: DiscountCodeFieldProps) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleApply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || disabled) return;

    const normalized = normalizeDiscountCode(code);
    if (!normalized) {
      setMessage("Ingresá tu código de descuento.");
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const preview = await previewDiscountCodeAction(normalized);
      if (preview.ok && preview.finalAmount !== null) {
        onApplied({ code: normalized, preview });
        setCode("");
      } else {
        setMessage(preview.message);
      }
    } catch {
      setMessage("No pudimos validar el código. Probá de nuevo en unos minutos.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = () => {
    onApplied(null);
    setMessage(null);
  };

  if (applied) {
    return (
      <p className="mt-3 flex min-w-0 items-start justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
        <span className="flex min-w-0 items-start gap-2">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            Código <span className="font-mono font-semibold">{applied.code}</span> aplicado
          </span>
        </span>
        <button
          type="button"
          onClick={handleRemove}
          disabled={disabled}
          aria-label="Quitar código de descuento"
          className="shrink-0 rounded-md p-1 text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-stampa-text-muted underline-offset-4 transition-colors hover:text-stampa-text hover:underline disabled:opacity-50"
      >
        <Tag size={14} aria-hidden="true" /> Tengo un código de descuento
      </button>
    );
  }

  return (
    <div className="mt-3 min-w-0">
      <form onSubmit={handleApply} className="flex min-w-0 flex-col gap-2 sm:flex-row" noValidate>
        <label htmlFor="discount-code" className="sr-only">Código de descuento</label>
        <input
          id="discount-code"
          name="discount-code"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={DISCOUNT_CODE_MAX_INPUT_LENGTH}
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setMessage(null);
          }}
          placeholder="PROMO-XXXXXX"
          aria-describedby="discount-code-message"
          className="block min-w-0 flex-1 rounded-xl border border-stampa-border bg-fg/5 px-3 py-3 font-mono text-base tracking-wider text-neutral-100 placeholder-neutral-600 outline-none transition-all focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 sm:text-sm"
        />
        <button
          type="submit"
          disabled={loading || disabled}
          className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-500/15 px-4 py-3 text-sm font-semibold text-violet-200 transition-colors hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
        >
          {loading && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          {loading ? "Validando..." : "Aplicar"}
        </button>
      </form>
      <div id="discount-code-message" aria-live="polite" className="min-w-0">
        {message && (
          <p role="alert" className="mt-2 flex items-start gap-2 text-sm leading-snug text-red-300">
            <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{message}</span>
          </p>
        )}
      </div>
    </div>
  );
}
