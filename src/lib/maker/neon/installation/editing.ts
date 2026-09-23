// Editor manual de conexiones (Etapa 8, Sección 17-19 del pedido): reutiliza el editor
// de Back Cutouts YA EXISTENTE (`cutoutEditorScene.ts` / `MakerViewport`'s prop
// `cutoutEditing`) representando cada pass-through como un `BackCutout` sintético de
// tipo "capsule" — mismo patrón que Carteles ya usa para sus puntos de montaje
// (`installation/editing.ts`, `mountEditorCutouts()`). No se escribió un editor nuevo:
// el arrastre (raycast a Z=0, throttle, validación en vivo roja/verde) es EXACTAMENTE
// el mismo código, ya probado, de Carteles — "Reutilizar MakerViewport... No crear
// canvas separado" (Sección 17).
import type * as ClipperLib from "clipper-lib";
import type { BackCutout, ContourGroup, Point2D } from "@/lib/maker/types";
import { insetContourGroups } from "@/lib/maker/geometry/offsets";
import { PASS_THROUGH_EDGE_MARGIN_MM, type NeonPassThrough } from "@/lib/maker/neon/installation/passThrough";
import type { NeonInstallationOverrides } from "@/lib/maker/neon/installation/types";

const ID_PREFIX = "pt";

export function passThroughEditorId(segmentId: string, side: NeonPassThrough["side"]): string {
  return `${ID_PREFIX}:${segmentId}:${side}`;
}

export function parsePassThroughEditorId(id: string): { segmentId: string; side: NeonPassThrough["side"] } | null {
  const m = /^pt:(.+):(start|end)$/.exec(id);
  return m ? { segmentId: m[1], side: m[2] as NeonPassThrough["side"] } : null;
}

/** Pass-throughs -> BackCutout sintéticos ("capsule"), en las mismas coordenadas absolutas que ya usa el resto de Neon (sin origen separado). */
export function passThroughEditorCutouts(passThroughs: NeonPassThrough[]): BackCutout[] {
  return passThroughs.map((pt) => ({
    id: passThroughEditorId(pt.segmentId, pt.side),
    type: "capsule",
    x: pt.center[0],
    y: pt.center[1],
    widthMm: pt.widthMm,
    heightMm: pt.heightMm,
    rotationDeg: pt.rotationDeg,
  }));
}

/** Zona segura combinada para el feedback en vivo del editor: unión de las cavidades de todos los segmentos, erosionada el mismo margen que usa el motor (`isPassThroughValid`). */
export function computePassThroughSafeZone(cavityGroups: ContourGroup[]): ClipperLib.Paths {
  return insetContourGroups(cavityGroups, PASS_THROUGH_EDGE_MARGIN_MM);
}

/** Aplica un arrastre commiteado (x, y de un BackCutout sintético) a los overrides del segmento correspondiente. */
export function movePassThroughOverride(overrides: NeonInstallationOverrides, editorId: string, x: number, y: number): NeonInstallationOverrides {
  const parsed = parsePassThroughEditorId(editorId);
  if (!parsed) return overrides;
  const prevSeg = overrides.segments[parsed.segmentId] ?? {};
  const key = parsed.side === "start" ? "passThroughStart" : "passThroughEnd";
  return { ...overrides, segments: { ...overrides.segments, [parsed.segmentId]: { ...prevSeg, [key]: [x, y] as const } } };
}

/** Vuelve un pass-through a su posición automática (borra el override de esa punta). */
export function resetPassThroughOverride(overrides: NeonInstallationOverrides, editorId: string): NeonInstallationOverrides {
  const parsed = parsePassThroughEditorId(editorId);
  if (!parsed) return overrides;
  const seg = overrides.segments[parsed.segmentId];
  if (!seg) return overrides;
  const key = parsed.side === "start" ? "passThroughStart" : "passThroughEnd";
  if (!(key in seg)) return overrides;
  const nextSeg = { ...seg };
  delete nextSeg[key];
  const nextSegments = { ...overrides.segments };
  if (Object.keys(nextSeg).length > 0) nextSegments[parsed.segmentId] = nextSeg;
  else delete nextSegments[parsed.segmentId];
  return { ...overrides, segments: nextSegments };
}

/** Invierte IN/OUT de un segmento en los overrides (toggle absoluto: si ya estaba forzado, lo invierte; si no, fuerza lo opuesto al valor automático dado). */
export function toggleInvertOverride(overrides: NeonInstallationOverrides, segmentId: string, currentInverted: boolean): NeonInstallationOverrides {
  const prevSeg = overrides.segments[segmentId] ?? {};
  return { ...overrides, segments: { ...overrides.segments, [segmentId]: { ...prevSeg, invertedOrientation: !currentInverted } } };
}

/** Reordena manualmente (arrastre en una lista, o botones "mover antes/después" — Sección 19). */
export function setManualOrder(overrides: NeonInstallationOverrides, order: string[]): NeonInstallationOverrides {
  return { ...overrides, order };
}

/** Vuelve todo a automático: sin orden manual, overrides por segmento ni puentes manuales. */
export function resetAllOverrides(): NeonInstallationOverrides {
  return { order: null, segments: {}, manualBridges: [] };
}

// ------------------------------------------------------------ puentes manuales (modo Personalizada)

let manualBridgeCounter = 0;

/** Id estable dentro de la corrida para un puente manual nuevo (Sección 28 del pedido de corrección de puentes). */
export function nextManualBridgeId(existing: readonly { id: string }[]): string {
  manualBridgeCounter = Math.max(manualBridgeCounter, existing.length);
  let id: string;
  do {
    manualBridgeCounter++;
    id = `mb${manualBridgeCounter}`;
  } while (existing.some((b) => b.id === id));
  return id;
}

/** Agrega un puente manual entre dos segmentos (Sección 28: "selección de pair" como mínimo aceptado). */
export function addManualBridge(overrides: NeonInstallationOverrides, fromSegmentId: string, toSegmentId: string, a: Point2D, b: Point2D): NeonInstallationOverrides {
  const id = nextManualBridgeId(overrides.manualBridges);
  return { ...overrides, manualBridges: [...overrides.manualBridges, { id, fromSegmentId, toSegmentId, a, b }] };
}

/** Elimina un puente manual por id. */
export function removeManualBridge(overrides: NeonInstallationOverrides, id: string): NeonInstallationOverrides {
  return { ...overrides, manualBridges: overrides.manualBridges.filter((b) => b.id !== id) };
}

/** Vacía todos los puentes manuales (piso mínimo de la Sección 28: "eliminar"). */
export function clearManualBridges(overrides: NeonInstallationOverrides): NeonInstallationOverrides {
  return { ...overrides, manualBridges: [] };
}
