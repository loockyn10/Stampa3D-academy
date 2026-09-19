import type * as ClipperLib from "clipper-lib";
import { isCutoutInsideSafeZone, validateBackCutoutShape } from "@/lib/maker/geometry/backCutouts";
import type { BackCutout } from "@/lib/maker/types";

/**
 * Lógica PURA del editor visual de recortes traseros (arrastrar con el mouse).
 * El editor no tiene un sistema de coordenadas propio: `x`/`y` del BackCutout
 * siguen siendo la única fuente de verdad (mm desde el centro del diseño,
 * visto DE FRENTE, Y arriba). Ver docs/STAMPA_MAKER.md sección 24.
 *
 * Cadena de conversión al arrastrar:
 *   pointer -> rayo -> plano Z=0 de la base -> punto de ESCENA (mm)
 *   -> `worldToDesign` (resta el centro del diseño) -> x/y del recorte.
 * La escena usa las mismas coordenadas que el diseño (X derecha visto de
 * frente, Y arriba, Z hacia el observador frontal), así que `worldToDesign` /
 * `designToWorld` son solo una traslación: NO hay ningún espejo en los datos.
 *
 * El espejo de la vista trasera lo aporta la CÁMARA: mirando desde -Z con Y
 * arriba, la derecha de la pantalla es -X. Por eso el handle sigue al mouse
 * exactamente (el rayo cae donde está el cursor) y, como consecuencia natural,
 * arrastrar hacia la derecha en pantalla DISMINUYE la X guardada. Las
 * funciones `designToBackViewScreen` / `backViewScreenToDesign` documentan y
 * testean ese mapeo (el signo se aplica una sola vez, aquí, nunca al guardar).
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Precisión con la que se guarda una posición arrastrada (mm). No es snapping: solo evita decimales de coma flotante. */
export const DRAG_POSITION_PRECISION_MM = 0.01;

export function roundMm(value: number): number {
  return Math.round(value / DRAG_POSITION_PRECISION_MM) * DRAG_POSITION_PRECISION_MM + 0;
}

/** Diseño (relativo al centro) -> punto de la escena/mundo. */
export function designToWorld(position: Vec2, origin: Vec2): Vec2 {
  return { x: origin.x + position.x, y: origin.y + position.y };
}

/** Punto de la escena/mundo -> diseño (relativo al centro). Inversa exacta de `designToWorld`. */
export function worldToDesign(world: Vec2, origin: Vec2): Vec2 {
  return { x: world.x - origin.x, y: world.y - origin.y };
}

/** Signo de la X de diseño sobre la derecha de la pantalla en la vista TRASERA (la cámara mira hacia +Z). */
export const BACK_VIEW_SCREEN_RIGHT_SIGN = -1;

/** Posición de diseño -> dirección en pantalla (mm hacia la derecha / hacia arriba, desde el centro) en la vista trasera. */
export function designToBackViewScreen(position: Vec2): { right: number; up: number } {
  return { right: BACK_VIEW_SCREEN_RIGHT_SIGN * position.x, up: position.y };
}

export function backViewScreenToDesign(screen: { right: number; up: number }): Vec2 {
  return { x: BACK_VIEW_SCREEN_RIGHT_SIGN * screen.right, y: screen.up };
}

/**
 * Pose de la cámara ortográfica trasera: mira perpendicularmente a la base
 * (hacia +Z) desde detrás (-Z), con Y arriba. `center` es el punto del diseño
 * que queda en el centro de la pantalla.
 */
export function backViewCameraPose(center: { x: number; y: number; z: number }, distance: number) {
  return {
    position: [center.x, center.y, center.z - distance] as [number, number, number],
    target: [center.x, center.y, center.z] as [number, number, number],
    up: [0, 1, 0] as [number, number, number],
  };
}

/** Actualiza SOLO x/y del recorte `id` (forma, medidas, rotación e id intactos). Sin clamp: una posición inválida se conserva y la validación la marca. */
export function updateBackCutoutPosition(cutouts: BackCutout[], id: string, x: number, y: number): BackCutout[] {
  let changed = false;
  const next = cutouts.map((c) => {
    if (c.id !== id) return c;
    if (c.x === x && c.y === y) return c;
    changed = true;
    return { ...c, x, y };
  });
  return changed ? next : cutouts;
}

/** Copia del recorte con las mismas medidas y rotación, desplazada (+5 mm en X e Y por defecto) para que no quede exactamente encima. */
export const DUPLICATE_OFFSET_MM = 5;
export function duplicateBackCutout(source: BackCutout, newId: string, offsetMm = DUPLICATE_OFFSET_MM): BackCutout {
  return { ...source, id: newId, x: source.x + offsetMm, y: source.y + offsetMm };
}

export const BACK_CUTOUT_EDGE_HINT = "El recorte está demasiado cerca del borde.";

/**
 * Validez de una posición para el feedback en vivo (rojo). Reusa exactamente la
 * prueba del motor (`isCutoutInsideSafeZone`). Sin zona segura conocida (aún no
 * se generó la geometría con recortes) se considera válido: la validación real
 * la sigue haciendo el motor y bloquea la exportación.
 */
export function checkBackCutoutPlacement(
  cutout: BackCutout,
  origin: Vec2,
  safeZone: ClipperLib.Paths | null,
): { valid: boolean; message: string | null } {
  const shapeError = validateBackCutoutShape(cutout);
  if (shapeError) return { valid: false, message: shapeError };
  if (!safeZone) return { valid: true, message: null };
  const valid = isCutoutInsideSafeZone(cutout, origin, safeZone);
  return { valid, message: valid ? null : BACK_CUTOUT_EDGE_HINT };
}

/** Ids de los recortes cuya posición actual es inválida. */
export function findInvalidBackCutouts(cutouts: BackCutout[], origin: Vec2, safeZone: ClipperLib.Paths | null): Set<string> {
  const invalid = new Set<string>();
  for (const c of cutouts) if (!checkBackCutoutPlacement(c, origin, safeZone).valid) invalid.add(c.id);
  return invalid;
}
