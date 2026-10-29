"use client";

import React, { useCallback, useId, useRef } from "react";
import { ArrowLeft, ArrowRight, Check, ExternalLink, HelpCircle, PlayCircle, X } from "lucide-react";
import { GhostButton, PrimaryButton } from "@/components/ui/button";
import { isLastStep, type TutorialViewAction, type TutorialViewState } from "@/lib/tutorials/state";
import type { TutorialDefinition } from "@/lib/tutorials/types";
import type { ResolvedTutorialVideo } from "@/lib/tutorials/video";
import { TutorialIllustration } from "./TutorialIllustration";

export type TutorialCloseReason = "close" | "skip" | "finish";

export interface TutorialPanelProps {
  tutorial: TutorialDefinition;
  state: TutorialViewState;
  /** `null` = el tutorial no tiene video: no se muestra ningún control ni reproductor de video. */
  video: ResolvedTutorialVideo | null;
  dispatch: (action: TutorialViewAction) => void;
  onClose: (reason: TutorialCloseReason) => void;
  /** Id del título (lo usa el diálogo contenedor para `aria-labelledby`). */
  titleId: string;
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const IFRAME_ALLOW = "encrypted-media; picture-in-picture; fullscreen";

function VideoPlayer({ video, title }: { video: ResolvedTutorialVideo; title: string }) {
  if (video.kind === "external") {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl border border-stampa-border bg-stampa-surface p-6 text-center">
        <PlayCircle size={40} aria-hidden="true" className="text-stampa-accent" />
        <a
          href={video.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stampa-orange px-5 text-sm font-bold text-neutral-950 transition hover:bg-stampa-orange-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/60"
        >
          Abrir video <ExternalLink size={15} aria-hidden="true" />
        </a>
      </div>
    );
  }
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface">
      <iframe
        src={video.embedUrl}
        title={title}
        loading="lazy"
        allow={IFRAME_ALLOW}
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}

/**
 * Contenido del tutorial: encabezado, paso (o video), progreso y botones. Presentacional: el estado vive en el
 * modal, así se prueba con renderToStaticMarkup.
 */
export function TutorialPanel({ tutorial, state, video, dispatch, onClose, titleId }: TutorialPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const step = tutorial.steps[state.step] ?? tutorial.steps[0];
  const total = tutorial.steps.length;
  const last = isLastStep(tutorial, state);
  const videoMode = state.mode === "video" && video !== null;
  const progressId = useId();

  // Foco contenido dentro del tutorial (aria-modal) y navegación con flechas.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Tab") {
        const nodes = rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const lastNode = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          lastNode.focus();
        } else if (!event.shiftKey && document.activeElement === lastNode) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (videoMode) return;
      if (event.key === "ArrowRight") dispatch({ type: "next" });
      else if (event.key === "ArrowLeft") dispatch({ type: "previous" });
    },
    [dispatch, videoMode],
  );

  return (
    <div ref={rootRef} onKeyDown={handleKeyDown} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-stampa-border px-4 py-3.5 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-stampa-accent">
            <HelpCircle size={13} aria-hidden="true" /> {tutorial.toolName}
          </p>
          <h2 id={titleId} className="mt-0.5 text-lg font-bold leading-snug text-fg sm:text-xl">
            {tutorial.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => onClose("close")}
          aria-label="Cerrar tutorial"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-fg/10 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      {video && (
        <div role="group" aria-label="Modalidad del tutorial" className="flex gap-1 border-b border-stampa-border px-4 py-2.5 sm:px-6">
          {(
            [
              { mode: "guide", label: "Guía visual" },
              { mode: "video", label: "Ver video" },
            ] as const
          ).map((option) => {
            const active = state.mode === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                aria-pressed={active}
                onClick={() => dispatch({ type: "mode", mode: option.mode })}
                className={`min-h-10 rounded-lg px-3.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange ${
                  active ? "bg-stampa-orange/15 text-stampa-accent" : "text-gray-400 hover:bg-fg/5 hover:text-fg"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6">
        {videoMode && video ? (
          <div className="space-y-3">
            <VideoPlayer video={video} title={`Video: ${tutorial.title}`} />
            <p className="text-sm text-gray-400">{tutorial.description}</p>
          </div>
        ) : (
          <div key={step.id} aria-live="polite" className="animate-slide-up space-y-5 motion-reduce:animate-none">
            <TutorialIllustration illustration={step.illustration} />
            <div className="text-center sm:text-left">
              <h3 className="text-base font-bold text-fg sm:text-lg">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-400 sm:text-[15px]">{step.text}</p>
            </div>
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-3 border-t border-stampa-border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
        {videoMode ? (
          <>
            <GhostButton type="button" className="min-h-11" onClick={() => dispatch({ type: "mode", mode: "guide" })}>
              <ArrowLeft size={16} aria-hidden="true" /> Volver a la guía
            </GhostButton>
            <PrimaryButton type="button" className="min-h-11" onClick={() => onClose("close")}>
              Cerrar
            </PrimaryButton>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div
                role="progressbar"
                aria-labelledby={progressId}
                aria-valuemin={1}
                aria-valuemax={total}
                aria-valuenow={state.step + 1}
                className="flex flex-1 items-center gap-1.5 sm:flex-none"
              >
                {tutorial.steps.map((item, index) => (
                  <span
                    key={item.id}
                    aria-hidden="true"
                    className={`h-1.5 flex-1 rounded-full transition-all sm:w-7 sm:flex-none ${
                      index === state.step ? "bg-stampa-orange" : index < state.step ? "bg-stampa-orange/50" : "bg-fg/15"
                    }`}
                  />
                ))}
              </div>
              <span id={progressId} className="shrink-0 text-xs font-semibold tabular-nums text-gray-400">
                Paso {state.step + 1} de {total}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!last && (
                <button
                  type="button"
                  onClick={() => onClose("skip")}
                  className="mr-auto min-h-11 rounded-xl px-3 text-sm font-semibold text-gray-400 transition-colors hover:bg-fg/5 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange sm:mr-1"
                >
                  Omitir
                </button>
              )}
              {state.step > 0 && (
                <GhostButton type="button" className="min-h-11" onClick={() => dispatch({ type: "previous" })}>
                  <ArrowLeft size={16} aria-hidden="true" /> Anterior
                </GhostButton>
              )}
              {last ? (
                <PrimaryButton type="button" className="ml-auto min-h-11 sm:ml-0" onClick={() => onClose("finish")}>
                  Finalizar <Check size={16} aria-hidden="true" />
                </PrimaryButton>
              ) : (
                <PrimaryButton type="button" className="min-h-11" onClick={() => dispatch({ type: "next" })}>
                  Siguiente <ArrowRight size={16} aria-hidden="true" />
                </PrimaryButton>
              )}
            </div>
          </>
        )}
      </footer>
    </div>
  );
}
