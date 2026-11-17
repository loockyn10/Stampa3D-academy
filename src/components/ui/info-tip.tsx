"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

interface InfoTipProps {
  /** Nombre accesible del botón («Cómo se calcula el margen»). */
  label: string;
  children: React.ReactNode;
  className?: string;
  iconSize?: number;
}

const GAP = 6;
const MARGIN = 12;

/**
 * Ayuda contextual (toggletip): un ícono «i» que muestra una explicación breve al tocarlo, hacer clic, pasar el
 * mouse o enfocarlo y presionar Enter. Se cierra con Escape, al tocar afuera o al desplazar la página.
 * El texto se monta en <body> para no quedar cortado por tarjetas con overflow ni por diálogos.
 */
export function InfoTip({ label, children, className = "", iconSize = 14 }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const openedByHover = useRef(false);
  const id = useId();

  const close = useCallback(() => {
    openedByHover.current = false;
    setOpen(false);
    setPosition(null);
  }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !popoverRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const popover = popoverRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let top = anchor.bottom + GAP;
    if (top + popover.height > viewportHeight - MARGIN && anchor.top - GAP - popover.height >= MARGIN) {
      top = anchor.top - GAP - popover.height;
    }
    const centered = anchor.left + anchor.width / 2 - popover.width / 2;
    const left = Math.min(Math.max(MARGIN, centered), viewportWidth - MARGIN - popover.width);
    setPosition({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      close();
    };
    const onViewportChange = () => close();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => {
          if (open && !openedByHover.current) close();
          else {
            openedByHover.current = false;
            setOpen(true);
          }
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse" || open) return;
          openedByHover.current = true;
          setOpen(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse" && openedByHover.current) close();
        }}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            // No cerrar también el diálogo que contiene la ayuda.
            event.stopPropagation();
            event.preventDefault();
            close();
          }
        }}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full align-middle text-gray-500 transition-colors hover:bg-fg/10 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange ${className}`}
      >
        <Info size={iconSize} aria-hidden="true" />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-[175] w-max max-w-[min(18rem,calc(100vw-1.5rem))] rounded-lg border border-stampa-border bg-stampa-raised px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-gray-200 shadow-xl"
          style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: "hidden" }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
