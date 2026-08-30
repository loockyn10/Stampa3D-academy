"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PromptOptions {
  title: string;
  label: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

interface PromptRequest extends PromptOptions {
  resolve: (value: string | null) => void;
}

interface AppFeedbackValue {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
  };
  confirmAction: (options: ConfirmOptions) => Promise<boolean>;
  promptForValue: (options: PromptOptions) => Promise<string | null>;
}

const AppFeedbackContext = createContext<AppFeedbackValue | null>(null);

export function useAppFeedback(): AppFeedbackValue {
  const context = useContext(AppFeedbackContext);
  if (!context) throw new Error("useAppFeedback must be used inside AppFeedbackProvider");
  return context;
}

export function AppFeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [promptRequest, setPromptRequest] = useState<PromptRequest | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const nextToastId = useRef(0);
  const previousFocus = useRef<HTMLElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);

  const pushToast = useCallback((message: string, tone: ToastTone) => {
    const id = ++nextToastId.current;
    setToasts((current) => [...current, { id, message, tone }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4_000);
  }, []);

  const toast = useMemo(() => ({
    success: (message: string) => pushToast(message, "success"),
    error: (message: string) => pushToast(message, "error"),
    info: (message: string) => pushToast(message, "info"),
  }), [pushToast]);

  const confirmAction = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmRequest({ ...options, resolve });
  }), []);

  const promptForValue = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPromptValue(options.initialValue ?? "");
    setPromptRequest({ ...options, resolve });
  }), []);

  const restoreFocus = useCallback(() => {
    window.setTimeout(() => previousFocus.current?.focus(), 0);
  }, []);

  const finishConfirm = useCallback((confirmed: boolean) => {
    if (!confirmRequest) return;
    confirmRequest.resolve(confirmed);
    setConfirmRequest(null);
    restoreFocus();
  }, [confirmRequest, restoreFocus]);

  const finishPrompt = useCallback((value: string | null) => {
    if (!promptRequest) return;
    promptRequest.resolve(value);
    setPromptRequest(null);
    setPromptValue("");
    restoreFocus();
  }, [promptRequest, restoreFocus]);

  const trapDialogFocus = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!confirmRequest && !promptRequest) return;
    const frame = window.requestAnimationFrame(() => {
      if (promptRequest) promptInputRef.current?.focus();
      else cancelButtonRef.current?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (promptRequest) finishPrompt(null);
      else finishConfirm(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmRequest, promptRequest, finishConfirm, finishPrompt]);

  const value = useMemo(() => ({ toast, confirmAction, promptForValue }), [toast, confirmAction, promptForValue]);

  return (
    <AppFeedbackContext.Provider value={value}>
      {children}

      <div
        className="pointer-events-none fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[120] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-5 sm:top-5 sm:w-[min(24rem,calc(100vw-2.5rem))]"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((item) => {
          const styles = item.tone === "success"
            ? "border-emerald-500/35 text-emerald-100"
            : item.tone === "error"
              ? "border-red-500/40 text-red-100"
              : "border-cyan-400/35 text-cyan-100";
          const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "error" ? AlertCircle : Info;
          return (
            <div key={item.id} role="status" className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-stampa-surface/95 p-3.5 shadow-xl shadow-black/30 backdrop-blur ${styles}`}>
              <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-gray-100">{item.message}</p>
              <button
                type="button"
                onClick={() => setToasts((current) => current.filter((toast) => toast.id !== item.id))}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-white/5 hover:text-white"
                aria-label="Cerrar aviso"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {confirmRequest && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-stampa-bg/75 p-4 backdrop-blur-sm">
          <div onKeyDown={trapDialogFocus} role="alertdialog" aria-modal="true" aria-labelledby="app-confirm-title" aria-describedby="app-confirm-description" className="w-full max-w-md overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface shadow-2xl">
            <div className="p-5 sm:p-6">
              <h2 id="app-confirm-title" className="text-lg font-bold text-white">{confirmRequest.title}</h2>
              <p id="app-confirm-description" className="mt-2 text-sm leading-relaxed text-gray-400">{confirmRequest.description}</p>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-stampa-border p-4 sm:flex-row sm:justify-end sm:p-5">
              <button ref={cancelButtonRef} type="button" onClick={() => finishConfirm(false)} className="min-h-11 rounded-xl border border-stampa-border px-4 py-2.5 text-sm font-bold text-gray-300 hover:bg-white/5 sm:min-w-28">
                {confirmRequest.cancelLabel ?? "Cancelar"}
              </button>
              <button type="button" onClick={() => finishConfirm(true)} className={`min-h-11 rounded-xl border px-4 py-2.5 text-sm font-bold text-white sm:min-w-32 ${confirmRequest.destructive ? "border-red-500/40 bg-red-600 hover:bg-red-500" : "border-stampa-orange bg-stampa-orange hover:brightness-110"}`}>
                {confirmRequest.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {promptRequest && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-stampa-bg/75 p-4 backdrop-blur-sm">
          <div onKeyDown={trapDialogFocus} role="dialog" aria-modal="true" aria-labelledby="app-prompt-title" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface shadow-2xl">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                finishPrompt(promptValue);
              }}
              className="flex min-h-0 flex-col"
            >
              <div className="overflow-y-auto p-5 sm:p-6">
                <h2 id="app-prompt-title" className="text-lg font-bold text-white">{promptRequest.title}</h2>
                {promptRequest.description && <p className="mt-2 text-sm text-gray-400">{promptRequest.description}</p>}
                <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-gray-400" htmlFor="app-prompt-input">
                  {promptRequest.label}
                </label>
                <input
                  ref={promptInputRef}
                  id="app-prompt-input"
                  value={promptValue}
                  onChange={(event) => setPromptValue(event.target.value)}
                  placeholder={promptRequest.placeholder}
                  inputMode={promptRequest.inputMode}
                  className="mt-2 min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-bg-soft px-3 py-2.5 text-sm text-white outline-none focus:border-stampa-orange focus:ring-2 focus:ring-stampa-orange/20"
                />
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-stampa-border p-4 sm:flex-row sm:justify-end sm:p-5">
                <button type="button" onClick={() => finishPrompt(null)} className="min-h-11 rounded-xl border border-stampa-border px-4 py-2.5 text-sm font-bold text-gray-300 hover:bg-white/5 sm:min-w-28">
                  {promptRequest.cancelLabel ?? "Cancelar"}
                </button>
                <button type="submit" className="min-h-11 rounded-xl border border-stampa-orange bg-stampa-orange px-4 py-2.5 text-sm font-bold text-white hover:brightness-110 sm:min-w-32">
                  {promptRequest.confirmLabel ?? "Confirmar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppFeedbackContext.Provider>
  );
}
