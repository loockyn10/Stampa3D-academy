"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  fetchTutorialOverride,
  hasSeenTutorial,
  loadSeenVersion,
  markTutorialSeen,
  shouldAutoOpenTutorial,
  type TutorialOverride,
} from "@/lib/tutorials/progress";
import { getTutorial, resolveTutorialId } from "@/lib/tutorials/registry";
import { TutorialModal } from "./TutorialModal";

interface TutorialStatus {
  /** `userId:tutorialId` al que corresponde esta lectura (evita usar datos de otra pantalla/cuenta). */
  key: string;
  seenVersion: number | null;
  override: TutorialOverride;
}

/**
 * Tutorial de la sección actual: se abre solo la primera vez (por versión), y el botón "¿Cómo funciona?" lo
 * reabre cuando la persona quiera. Todo el contenido sale de `lib/tutorials/registry` (ver docs/TUTORIALS.md).
 */
export function GlobalToolTutorial({
  userId,
  mobileMenuOpen = false,
}: {
  userId: string | null;
  mobileMenuOpen?: boolean;
}) {
  const pathname = usePathname();
  const [supabase] = useState(() => createClient());
  const tutorialId = useMemo(() => resolveTutorialId(pathname), [pathname]);
  const tutorial = getTutorial(tutorialId);
  const key = userId && tutorialId ? `${userId}:${tutorialId}` : null;

  const [status, setStatus] = useState<TutorialStatus | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const autoOpenedKeyRef = useRef<string | null>(null);

  const [measuredStampyBottom, setStampyBottom] = useState<number | null>(null);
  const isStampyRoute = pathname === "/stampy" || pathname.startsWith("/stampy/");
  const stampyBottom = isStampyRoute ? measuredStampyBottom : null;

  // En /stampy el botón sube para no tapar el compositor del chat.
  useEffect(() => {
    if (!isStampyRoute) return;

    const composer = document.querySelector<HTMLElement>("[data-stampy-composer]");
    if (!composer) return;

    const updatePosition = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const composerTop = composer.getBoundingClientRect().top;
      setStampyBottom(Math.max(0, viewportHeight - composerTop + 12));
    };

    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(composer);
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    updatePosition();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
    };
  }, [isStampyRoute]);

  // Qué vio ya esta cuenta + datos opcionales de `tool_tutorials` (interruptor y video).
  useEffect(() => {
    if (!key || !userId || !tutorialId) return;
    let cancelled = false;

    void Promise.all([loadSeenVersion(supabase, userId, tutorialId), fetchTutorialOverride(supabase, tutorialId)]).then(
      ([seenVersion, override]) => {
        if (!cancelled) setStatus({ key, seenVersion, override });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [key, userId, tutorialId, supabase]);

  const current = status && status.key === key ? status : null;
  const available = Boolean(tutorial && current && !current.override.disabled);

  // Primer acceso: una sola apertura automática por pantalla y cuenta.
  useEffect(() => {
    if (!tutorial || !current || !key || !available) return;
    const open = shouldAutoOpenTutorial({
      seenVersion: current.seenVersion,
      version: tutorial.version,
      checked: true,
      alreadyAutoOpened: autoOpenedKeyRef.current === key,
      blocked: mobileMenuOpen,
    });
    if (!open) return;
    autoOpenedKeyRef.current = key;
    setOpenKey(key);
  }, [tutorial, current, key, available, mobileMenuOpen]);

  const handleClose = useCallback(
    () => {
      setOpenKey(null);
      if (!tutorial || !userId || !key) return;
      // Cerrar, omitir o finalizar cuentan igual: no vuelve a aparecer sola hasta que cambie la versión.
      setStatus((prev) => (prev && prev.key === key ? { ...prev, seenVersion: tutorial.version } : prev));
      if (!hasSeenTutorial(current?.seenVersion ?? null, tutorial.version)) {
        void markTutorialSeen(supabase, userId, tutorial.id, tutorial.version);
      }
    },
    [tutorial, userId, key, current, supabase],
  );

  if (!tutorial || !current || !available) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenKey(key)}
        title="¿Cómo funciona?"
        aria-label={`¿Cómo funciona? Tutorial de ${tutorial.toolName}`}
        aria-haspopup="dialog"
        style={stampyBottom !== null ? ({ "--stampy-tutorial-bottom": `${stampyBottom}px` } as React.CSSProperties) : undefined}
        className={`mobile-floating-tutorial ${isStampyRoute ? "mobile-floating-tutorial-stampy" : ""} fixed z-[50] flex h-11 w-11 items-center justify-center gap-1.5 rounded-full border border-stampa-border bg-stampa-surface text-base font-bold text-stampa-accent shadow-lg shadow-shade/30 transition hover:border-stampa-orange/60 hover:bg-stampa-surface-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange active:scale-95 lg:z-[100] lg:h-10 lg:w-auto lg:px-3.5 ${
          mobileMenuOpen ? "mobile-floating-action-hidden" : ""
        }`}
      >
        <span aria-hidden="true">?</span>
        <span className="hidden text-xs font-semibold text-fg lg:inline">¿Cómo funciona?</span>
      </button>

      {openKey === key && !mobileMenuOpen && (
        <TutorialModal tutorial={tutorial} videoOverride={current.override.videoUrl} onClose={handleClose} />
      )}
    </>
  );
}
