"use client";

import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
  panelClassName?: string;
  /** En celulares (< 640 px) el panel ocupa toda la pantalla, sin márgenes ni bordes redondeados. */
  fullScreenOnMobile?: boolean;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Pila de diálogos abiertos: con diálogos anidados (p. ej. «Componentes y embalaje» dentro de «Configurar
 * valores») solo el de arriba responde a Escape y encierra el foco.
 */
const openDialogStack: symbol[] = [];
const isTopDialog = (id: symbol) => openDialogStack[openDialogStack.length - 1] === id;
const subscribeNothing = () => () => {};

export function Dialog({
  open,
  onClose,
  labelledBy,
  children,
  panelClassName = "",
  fullScreenOnMobile = false,
}: DialogProps) {
  // false en el servidor y en la hidratación, true en el cliente: un diálogo que se monta ya abierto
  // renderiza el panel en el primer render y el foco inicial lo encuentra.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // onClose suele ser una función nueva en cada render: se lee desde una ref para que el efecto de apertura
  // no se vuelva a ejecutar (y no robe el foco) cada vez que el padre se re-renderiza.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !mounted) return;

    const id = Symbol("dialog");
    openDialogStack.push(id);
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(id)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      // Foco encerrado en el panel (solo cuando el foco está dentro: los desplegables con portal quedan afuera).
      const panel = panelRef.current;
      const active = document.activeElement;
      if (active && !panel.contains(active)) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.getAttribute("aria-hidden") !== "true" && element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      const index = openDialogStack.indexOf(id);
      if (index !== -1) openDialogStack.splice(index, 1);
      document.body.style.overflow = previousOverflow;
      // preventScroll: quien abrió el diálogo estaba visible; no se mueve la página al devolverle el foco.
      window.setTimeout(() => previousFocusRef.current?.focus({ preventScroll: true }), 0);
    };
  }, [open, mounted]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[150] flex items-center justify-center overflow-hidden bg-stampa-bg/75 backdrop-blur-sm ${
        fullScreenOnMobile ? "p-0 sm:px-4 sm:py-3" : "px-3 sm:px-4"
      }`}
      style={fullScreenOnMobile ? undefined : {
        paddingTop: "max(0.75rem, env(safe-area-inset-top))",
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`w-full overflow-y-auto overscroll-contain shadow-2xl outline-none ${
          fullScreenOnMobile ? "h-full max-h-full sm:h-auto" : "max-h-full"
        } ${panelClassName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
