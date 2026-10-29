"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import {
  getTutorialVideo,
  initialViewState,
  tutorialViewReducer,
  type TutorialViewAction,
  type TutorialViewState,
} from "@/lib/tutorials/state";
import type { TutorialDefinition } from "@/lib/tutorials/types";
import { TutorialPanel, type TutorialCloseReason } from "./TutorialPanel";

interface TutorialModalProps {
  tutorial: TutorialDefinition;
  /** Video de `tool_tutorials` si el tutorial no define uno en el código. */
  videoOverride?: string | null;
  onClose: (reason: TutorialCloseReason) => void;
}

/** Modal reutilizable de tutoriales: una sola implementación para todas las secciones. */
export function TutorialModal({ tutorial, videoOverride = null, onClose }: TutorialModalProps) {
  const titleId = useId();
  const video = useMemo(() => getTutorialVideo(tutorial, videoOverride), [tutorial, videoOverride]);
  const [state, setState] = useState<TutorialViewState>(initialViewState);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  // Referencia estable: el Dialog reinicia el foco si cambia la identidad de `onClose`.
  const handleDialogClose = useCallback(() => onCloseRef.current("close"), []);

  const dispatch = useCallback(
    (action: TutorialViewAction) =>
      setState((current) => tutorialViewReducer(tutorial, current, action, video !== null)),
    [tutorial, video],
  );

  return (
    <Dialog
      open
      onClose={handleDialogClose}
      labelledBy={titleId}
      panelClassName="flex max-w-2xl flex-col overflow-hidden! rounded-2xl border border-stampa-border bg-stampa-bg"
    >
      <TutorialPanel
        tutorial={tutorial}
        state={state}
        video={video}
        dispatch={dispatch}
        onClose={onClose}
        titleId={titleId}
      />
    </Dialog>
  );
}
