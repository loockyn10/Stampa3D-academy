"use client";

import React, { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { useAppFeedback } from "@/components/ui/app-feedback";

interface StlDownloadButtonProps {
  variantId: string | null;
  label?: string;
  className?: string;
}

/** Descarga autorizada: registra stl_downloads y pide la URL firmada a /api/stl/download. */
export function StlDownloadButton({ variantId, label = "Descargar STL", className = "" }: StlDownloadButtonProps) {
  const { toast } = useAppFeedback();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);

  if (!variantId) {
    return (
      <button
        type="button"
        disabled
        className={`flex w-full items-center justify-center gap-2 rounded-xl border border-stampa-border bg-stampa-bg-soft py-3 text-xs font-bold text-gray-600 cursor-not-allowed ${className}`}
      >
        Archivo no disponible
      </button>
    );
  }

  const handleClick = async () => {
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("stl_downloads").upsert(
          { user_id: user.id, variant_id: variantId },
          { onConflict: "user_id, variant_id" },
        );
      }

      const res = await fetch("/api/stl/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId }),
      });
      const data = await res.json();

      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || "No pude preparar la descarga. Probá de nuevo.");
      }
    } catch (error) {
      console.error("Error al descargar STL:", error);
      toast.error("Ocurrió un error inesperado al intentar descargar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleClick}
      className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold text-white transition-all shadow-lg ${
        busy
          ? "bg-stampa-orange/50 cursor-not-allowed shadow-none"
          : "bg-stampa-orange hover:bg-stampa-orange-hover shadow-stampa-orange/20 hover:shadow-stampa-orange/40"
      } ${className}`}
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
      {busy ? "Preparando..." : label}
    </button>
  );
}
