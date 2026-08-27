"use client";

import React, { useState } from "react";
import {
  markStampyActionRequestOpened,
  cancelStampyActionRequest,
  confirmStampyActionRequest,
  confirmStampyCreateFilamentAction,
  confirmStampyCreatePrinterAction,
} from "@/lib/stampy/action-requests";
import { ExternalLink, AlertCircle, Trash2, CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export interface ActionIntentCardProps {
  actionIntent: any;
  actionRequestId?: string | null;
  initialStatus?: "suggested" | "opened_tool" | "cancelled" | "executed" | "error";
}

export function ActionIntentCard({ actionIntent, actionRequestId, initialStatus = "suggested" }: ActionIntentCardProps) {
  const router = useRouter();
  const autoExecution = actionIntent?.extracted?.autoExecution as
    | { executed?: boolean }
    | undefined;
  const [status, setStatus] = useState(
    autoExecution?.executed === true ? "executed" : initialStatus
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

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
    const { success, error } = await cancelStampyActionRequest({ actionRequestId });
    if (success) {
      setStatus("cancelled");
      setResultMessage(null);
    } else if (error) {
      setResultMessage(error);
    }
    setIsProcessing(false);
  };

  const handleConfirmMovement = async () => {
    if (!actionRequestId) return;

    setIsProcessing(true);
    setResultMessage(null);
    const result = await confirmStampyActionRequest({ actionRequestId });
    if (result.success) {
      setStatus("executed");
      setResultMessage(result.message);
    } else {
      if (result.errorCode === "already_executed") setStatus("executed");
      setResultMessage(result.message);
    }
    setIsProcessing(false);
  };

  const handleConfirmCreation = async () => {
    if (!actionRequestId) return;

    setIsProcessing(true);
    setResultMessage(null);
    const result = await confirmStampyCreateFilamentAction(actionRequestId);
    if (result.success) {
      setStatus("executed");
      setResultMessage(result.message);
    } else {
      if (result.errorCode === "already_executed") setStatus("executed");
      setResultMessage(result.message);
    }
    setIsProcessing(false);
  };

  const handleConfirmPrinterCreation = async () => {
    if (!actionRequestId) return;

    setIsProcessing(true);
    setResultMessage(null);
    const result = await confirmStampyCreatePrinterAction(actionRequestId);
    if (result.success) {
      setStatus("executed");
      setResultMessage(result.message);
    } else {
      if (result.errorCode === "already_executed") setStatus("executed");
      setResultMessage(result.message);
    }
    setIsProcessing(false);
  };

  const isCancelled = status === "cancelled";
  const isExecuted = status === "executed";
  const resolvedTarget = actionIntent.extracted?.resolvedTarget as
    | { label?: string; remainingGramsBefore?: number }
    | undefined;
  const isFilamentMovement =
    actionIntent.type === "increase_filament_stock" ||
    actionIntent.type === "discount_filament";
  const isCreateFilament = actionIntent.type === "add_filament";
  const isCreatePrinter = actionIntent.type === "add_printer";
  const canConfirmMovement =
    Boolean(actionRequestId) &&
    isFilamentMovement &&
    actionIntent.extracted?.requiresConfirmation === true &&
    Boolean(resolvedTarget?.label) &&
    !isCancelled &&
    !isExecuted;
  const canConfirmCreation =
    Boolean(actionRequestId) &&
    isCreateFilament &&
    actionIntent.extracted?.requiresConfirmation === true &&
    actionIntent.extracted?.duplicateStatus === "clear" &&
    !isCancelled &&
    !isExecuted;
  const canConfirmPrinterCreation =
    Boolean(actionRequestId) &&
    isCreatePrinter &&
    actionIntent.extracted?.requiresConfirmation === true &&
    actionIntent.extracted?.duplicateStatus === "clear" &&
    !isCancelled &&
    !isExecuted;
  const visibleExtracted = Object.entries(actionIntent.extracted || {}).filter(
    ([key]) =>
      ![
        "requiresConfirmation",
        "resolvedTarget",
        "matchStatus",
        "actionType",
        "duplicateStatus",
        "duplicateTarget",
        "totalGramsAssumed",
        "powerWattsAssumed",
        "maintenanceCostPerHourAssumed",
        "validationWarnings",
        "autoExecution",
        ...(isCreateFilament
          ? ["material", "brand", "name", "color", "totalGrams"]
          : []),
        ...(isCreatePrinter
          ? [
              "printerName",
              "brand",
              "model",
              "powerWatts",
              "maintenanceCostPerHour",
            ]
          : []),
      ].includes(key)
  );
  const creationSummary = isCreateFilament
    ? [
        ["Material", actionIntent.extracted?.material],
        ["Marca", actionIntent.extracted?.brand],
        ["Subtipo", actionIntent.extracted?.name],
        ["Color", actionIntent.extracted?.color],
        [
          "Peso total",
          actionIntent.extracted?.totalGrams
            ? `${actionIntent.extracted.totalGrams}g${
                actionIntent.extracted.totalGramsAssumed === true
                  ? " (asumido)"
                  : ""
              }`
            : null,
        ],
      ].filter((entry) => entry[1] !== null && entry[1] !== undefined && entry[1] !== "")
    : [];
  const printerSummary = isCreatePrinter
    ? [
        ["Nombre", actionIntent.extracted?.printerName],
        ["Potencia", `${Number(actionIntent.extracted?.powerWatts ?? 0)}W`],
        [
          "Mantenimiento/hora",
          `$${Number(actionIntent.extracted?.maintenanceCostPerHour ?? 0)}`,
        ],
      ]
    : [];
  const printerWarnings =
    isCreatePrinter && Array.isArray(actionIntent.extracted?.validationWarnings)
      ? (actionIntent.extracted.validationWarnings as string[])
      : [];
  
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
            {visibleExtracted.map(([key, val]) => (
              <div key={key} className="flex justify-between text-xs">
                <span className="text-gray-500 capitalize">{key}:</span>
                <span className="font-medium text-gray-300">{String(val)}</span>
              </div>
            ))}
            {creationSummary.map(([label, value]) => (
              <div key={String(label)} className="flex justify-between gap-3 text-xs">
                <span className="text-gray-500">{String(label)}:</span>
                <span className="text-right font-medium text-gray-300">
                  {String(value)}
                </span>
              </div>
            ))}
            {printerSummary.map(([label, value]) => (
              <div key={String(label)} className="flex justify-between gap-3 text-xs">
                <span className="text-gray-500">{String(label)}:</span>
                <span className="text-right font-medium text-gray-300">
                  {String(value)}
                </span>
              </div>
            ))}
            {resolvedTarget?.label && (
              <div className="flex justify-between gap-3 text-xs">
                <span className="text-gray-500">Filamento:</span>
                <span className="text-right font-medium text-gray-300">
                  {resolvedTarget.label}
                </span>
              </div>
            )}
          </div>

          {printerWarnings.length > 0 && !isCancelled && !isExecuted && (
            <div className="space-y-1 text-xs text-amber-300">
              {printerWarnings.map((warning) => (
                <p key={warning}>- {warning}</p>
              ))}
            </div>
          )}

          {!isCancelled && !isExecuted && (
            <p className="text-xs text-stampa-orange flex items-center gap-1.5">
              <CheckCircle2 size={12} />
              {canConfirmMovement
                ? "Stampy todavía no hizo cambios. Confirmá el movimiento para ejecutarlo."
                : canConfirmCreation
                  ? "Stampy todavía no hizo cambios. Confirmá la creación para ejecutarla."
                : canConfirmPrinterCreation
                  ? "Stampy todavía no hizo cambios. Confirmá la creación para ejecutarla."
                : "Stampy no hizo cambios. Revisá y confirmá en la herramienta."}
            </p>
          )}

          {!isCancelled && !isExecuted && actionIntent.toolHref && (
            <div className="flex flex-wrap gap-2 pt-2">
              {canConfirmMovement && (
                <button
                  onClick={handleConfirmMovement}
                  disabled={isProcessing}
                  className="flex-1 basis-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Confirmar movimiento
                </button>
              )}
              {canConfirmCreation && (
                <button
                  onClick={handleConfirmCreation}
                  disabled={isProcessing}
                  className="flex-1 basis-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Confirmar creación
                </button>
              )}
              {canConfirmPrinterCreation && (
                <button
                  onClick={handleConfirmPrinterCreation}
                  disabled={isProcessing}
                  className="flex-1 basis-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Confirmar creación
                </button>
              )}
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

          {isExecuted && (
            <p className="text-xs font-medium text-emerald-400">
              {resultMessage || (isCreateFilament
                ? "Listo, creé el filamento."
                : isCreatePrinter
                  ? "Listo, creé la impresora."
                  : "Listo, actualicé el stock de filamento.")}
            </p>
          )}

          {resultMessage && !isExecuted && !isCancelled && (
            <p className="text-xs font-medium text-red-400">{resultMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
