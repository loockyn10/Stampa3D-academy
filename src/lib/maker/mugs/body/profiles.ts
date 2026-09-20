import type { MugBodyStyle } from "@/lib/maker/mugs/types";

/**
 * Perfiles de cuerpo: radio exterior como función CONTINUA de la altura normalizada t ∈ [0, 1] (0 = base).
 * Superficie continua (nada de bandas discretas); los diámetros de base y boca se conservan en todos los estilos.
 */
export interface BodyShape {
  style: MugBodyStyle;
  bottomRadius: number;
  topRadius: number;
  /** 0–1. Solo barril / abombado. */
  bulge: number;
}

/** Barril: sin(π·t), máximo en el centro. */
export function barrelBulge(t: number): number {
  return Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
}

/** Abombado: meseta redondeada 1 - |2t-1|^2.6 (pendiente finita en base y boca, más orgánico que el barril). */
export function bulgedBulge(t: number): number {
  const u = Math.abs(2 * Math.min(Math.max(t, 0), 1) - 1);
  return 1 - Math.pow(u, 2.6);
}

/** Radio exterior base (sin modificadores) a la altura normalizada t. */
export function bodyRadius(shape: BodyShape, t: number): number {
  const rMid = (shape.bottomRadius + shape.topRadius) / 2;
  const linear = shape.style === "straight" ? rMid : shape.bottomRadius + (shape.topRadius - shape.bottomRadius) * t;
  return linear + bodyBulgeExtra(shape, t);
}

/** Radio extra por abombado (0 en recto/cónico). */
export function bodyBulgeExtra(shape: BodyShape, t: number): number {
  const rMid = (shape.bottomRadius + shape.topRadius) / 2;
  if (shape.style === "barrel") return shape.bulge * 0.2 * rMid * barrelBulge(t);
  if (shape.style === "bulged") return shape.bulge * 0.26 * rMid * bulgedBulge(t);
  return 0;
}
