"use client";

import React, { useState } from "react";
import { markStampyActionRequestOpened, cancelStampyActionRequest } from "@/lib/stampy/action-requests";
import { ExternalLink, AlertCircle, Trash2, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";

export interface ActionIntentCardProps {
  actionIntent: any;
  actionRequestId?: string | null;
  initialStatus?: "suggested" | "opened_tool" | "cancelled" | "executed" | "error";
}

export function ActionIntentCard({ actionIntent, actionRequestId, initialStatus = "suggested" }: ActionIntentCardProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!actionIntent) return null;

  const handleOpenTool = async () => {
    if (!actionIntent.toolHref) return;

    if (process.env.NODE_ENV !== "production") {
      console.log("[Stampy Tool Link]", {
        type: actionIntent.type,
        toolHref: actionIntent.toolHref,
      });
    }

    if (actionRequestId && status === "suggested") {
      setIsProcessing(true);
      const { success } = await markStampyActionRequestOpened({ actionRequestId });
      if (success) {
        setStatus("opened_tool");
      }
      setIsProcessing(false);
    }
    router.push(actionIntent.toolHref);
  };

  const handleCancel = async () => {
    if (!actionRequestId) {
      setStatus("cancelled");
      return;
    }
    
    setIsProcessing(true);
    const { success } = await cancelStampyActionRequest({ actionRequestId });
    if (success) {
      setStatus("cancelled");
    }
    setIsProcessing(false);
  };

  const isCancelled = status === "cancelled";
  
  return (
    <div className={`mt-4 rounded-xl border p-4 ${isCancelled ? 'border-gray-800 bg-gray-900/50 opacity-60' : 'border-stampa-orange/30 bg-stampa-orange/5'}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-full p-1.5 ${isCancelled ? 'bg-gray-800 text-gray-500' : 'bg-stampa-orange/20 text-stampa-orange'}`}>
          <AlertCircle size={16} />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h4 className={`text-sm font-bold ${isCancelled ? 'text-gray-500' : 'text-white'}`}>Acción detectada: {actionIntent.title}</h4>
            <p className="text-xs text-gray-400 mt-1">{actionIntent.summary}</p>
          </div>

          <div className="rounded-lg bg-black/40 p-3 border border-white/5 space-y-1.5">
            {Object.entries(actionIntent.extracted || {}).map(([key, val]) => (
              <div key={key} className="flex justify-between text-xs">
                <span className="text-gray-500 capitalize">{key}:</span>
                <span className="font-medium text-gray-300">{String(val)}</span>
              </div>
            ))}
          </div>

          {!isCancelled && (
            <p className="text-xs text-stampa-orange flex items-center gap-1.5">
              <CheckCircle2 size={12} />
              Stampy no hizo cambios. Revisá y confirmá en la herramienta.
            </p>
          )}

          {!isCancelled && actionIntent.toolHref && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleOpenTool}
                disabled={isProcessing}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50"
              >
                <ExternalLink size={14} />
                Abrir {actionIntent.toolLabel || "herramienta"}
              </button>
              
              <button
                onClick={handleCancel}
                disabled={isProcessing}
                className="flex items-center justify-center gap-2 rounded-lg border border-red-500/20 hover:bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 transition-colors disabled:opacity-50"
                title="Descartar esta acción"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}

          {isCancelled && (
            <p className="text-xs text-gray-500 italic">Acción descartada por el usuario.</p>
          )}
        </div>
      </div>
    </div>
  );
}
