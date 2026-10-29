// Estado de navegación del modal de tutoriales (puro: lo usa el componente y lo cubren los tests).

import type { TutorialDefinition, TutorialMode } from "./types";
import { resolveTutorialVideo, type ResolvedTutorialVideo } from "./video";

export interface TutorialViewState {
  step: number;
  mode: TutorialMode;
}

export type TutorialViewAction =
  | { type: "next" }
  | { type: "previous" }
  | { type: "goto"; step: number }
  | { type: "mode"; mode: TutorialMode };

export function initialViewState(): TutorialViewState {
  return { step: 0, mode: "guide" };
}

/** Video reproducible del tutorial (o `null` → no se ofrece nada de video). `override` es el de la base de datos. */
export function getTutorialVideo(
  tutorial: Pick<TutorialDefinition, "video">,
  override?: string | null,
): ResolvedTutorialVideo | null {
  return resolveTutorialVideo(tutorial.video?.url) ?? resolveTutorialVideo(override);
}

export function isLastStep(tutorial: Pick<TutorialDefinition, "steps">, state: TutorialViewState): boolean {
  return state.step >= tutorial.steps.length - 1;
}

export function tutorialViewReducer(
  tutorial: Pick<TutorialDefinition, "steps">,
  state: TutorialViewState,
  action: TutorialViewAction,
  hasVideo: boolean,
): TutorialViewState {
  const last = Math.max(0, tutorial.steps.length - 1);
  switch (action.type) {
    case "next":
      return { ...state, step: Math.min(state.step + 1, last) };
    case "previous":
      return { ...state, step: Math.max(state.step - 1, 0) };
    case "goto":
      return { ...state, step: Math.min(Math.max(Math.trunc(action.step), 0), last) };
    case "mode":
      // Sin video no hay modalidad "video": se ignora en vez de dejar al modal en un estado vacío.
      return action.mode === "video" && !hasVideo ? state : { ...state, mode: action.mode };
  }
}
