import type { ContourGroup } from "@/lib/maker/types";
import { insetContourGroups, differenceContourGroups, regroupClipperSolution, clipperPathsArea } from "@/lib/maker/geometry/offsets";

export interface WallAndCore {
  /** Huella de la pared visible (ink menos núcleo): la usa el "frente" del cuerpo, ver body/standard.ts y body/tapered.ts. */
  wallGroups: ContourGroup[];
  /** Huella de la cavidad interior oculta (núcleo erosionado por wallMm): la usa la "repisa" y las paredes internas. */
  coreGroups: ContourGroup[];
  fullyEroded: boolean;
}

/**
 * Cavidad interior (hueca) de UN contorno: erosiona por `wallMm`, misma
 * lógica sin importar el tipo de cuerpo — la cavidad oculta nunca depende
 * de si el cuerpo es standard o tapered (ver body/tapered.ts: el tapered
 * solo cambia la silueta VISIBLE, nunca la cavidad interna ni la interfaz
 * con frente/tapa). Extraído de createLetterGeometry.ts (0.4 Etapa 1) para
 * que ambos tipos de cuerpo reusen el mismo cálculo sin duplicar las
 * llamadas a Clipper.
 */
export function computeWallAndCore(group: ContourGroup, wallMm: number): WallAndCore {
  const insetPaths = insetContourGroups([group], wallMm);
  const insetArea = Math.abs(clipperPathsArea(insetPaths));
  const fullyEroded = insetArea < 1e-4;
  const wallGroups = differenceContourGroups([group], insetPaths);
  const coreGroups = regroupClipperSolution(insetPaths);
  return { wallGroups, coreGroups, fullyEroded };
}
