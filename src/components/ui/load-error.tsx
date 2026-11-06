import { AlertCircle, RefreshCw } from "lucide-react";

interface LoadErrorProps {
  /** Qué pasó, en lenguaje llano (ya viene con la frase completa: no se antepone nada). */
  message: string;
  /** Si se pasa, muestra «Reintentar» con zona táctil de 44 px. */
  onRetry?: () => void;
  className?: string;
}

/** Aviso de error de carga compartido: rol `alert`, mismo aspecto en todas las pantallas y reintento cuando se puede. */
export function LoadError({ message, onRetry, className = "" }: LoadErrorProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col gap-3 rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-400 sm:flex-row sm:items-center ${className}`}
    >
      <p className="flex min-w-0 flex-1 items-start gap-3">
        <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{message}</span>
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/30 px-4 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/10"
        >
          <RefreshCw size={14} aria-hidden="true" /> Reintentar
        </button>
      )}
    </div>
  );
}
