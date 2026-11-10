"use client";

import { useEffect, type RefObject } from "react";

/**
 * Publica en `element.style[--name]` el avance (0..1) con el que una sección cruza la pantalla. `start` es la fracción de la altura de
 * la ventana desde la que empieza a contarse (0.62 → el avance llega a 1 cuando la base de la sección alcanza ese 62 %).
 * Con movimiento reducido no se anima: el valor queda en 1 (todo visible y estático).
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, name: string, start = 0.62): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.style.setProperty(name, "1");
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const viewport = window.innerHeight;
      const raw = (viewport * start - rect.top) / Math.max(1, rect.height - viewport * (1 - start) * 0.2);
      element.style.setProperty(name, Math.min(1, Math.max(0, raw)).toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, name, start]);
}
