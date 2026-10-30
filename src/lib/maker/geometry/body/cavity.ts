import type { ContourGroup, LetterGeometryWarning, LetterSignParams } from "@/lib/maker/types";
import type { ZBand } from "@/lib/maker/geometry/body/shared";
import { computeBevelBand, bevelBandToZBand } from "@/lib/maker/geometry/body/modifiers/bevel";
import { computeGrooveBand, grooveBandToZBand } from "@/lib/maker/geometry/body/modifiers/groove";
import { minStrokeHalfWidthMm } from "@/lib/maker/geometry/strokeLimits";

/**
 * Modificadores que angostan la silueta exterior hacia ADENTRO a cierta altura
 * (bisel superior, cintura lateral/"groove") y la protección que necesitan.
 *
 * La pared exterior y la cavidad son dos superficies: si sólo se corre la
 * exterior, el espesor de pared se consume (0.4.2: un bisel de 2.8 mm sobre
 * una pared de 3.2 mm dejaba 0.4 mm en el borde; con un desplazamiento mayor
 * que la pared las dos superficies se cruzaban y la malla quedaba abierta).
 * Desde 0.7.1 la cavidad acompaña a la exterior (body/shared.ts#
 * buildBandedCavityWallPieces): la pared sigue midiendo `wallMm` en horizontal
 * a cualquier altura y el bisel/cintura quedan independientes del espesor.
 */

/** Cuánto de la altura de pared puede ocupar como máximo el bisel superior: el resto queda como pared vertical. */
export const MAX_BEVEL_WALL_FRACTION = 0.5;

/** Ancho mínimo que debe conservar el trazo más fino en su cara más angosta (bisel/cintura), en mm. */
export const MIN_STROKE_TOP_WIDTH_MM = 1.2;

/** Por debajo de este desplazamiento (mm) un modificador no tiene efecto visible ni imprimible: se desactiva. */
const MIN_USEFUL_INSET_MM = 0.05;

/** Bandas (con signo, ver `ZBand`) que angostan la silueta: bisel superior y cintura lateral. Vacío si el cuerpo no tiene cavidad que acompañar. */
export function computeInwardBands(params: LetterSignParams): ZBand[] {
  if (params.bodyType !== "standard" || params.frontType === "light-channel") return [];
  if (params.depthMm - params.baseMm <= 0) return [];
  const bevel = computeBevelBand(params.baseMm, params.depthMm, params.bevelEnabled, params.bevelDepthMm);
  const groove = computeGrooveBand(params.baseMm, params.depthMm, params.grooveEnabled, params.groovePositionMm, params.grooveWidthMm);
  return [
    ...(bevel ? [bevelBandToZBand(bevel, params.bevelInsetMm)] : []),
    ...(groove ? [grooveBandToZBand(groove, params.grooveInsetMm)] : []),
  ];
}

// Redondea hacia abajo a 0.01 mm: la grilla a la que cuantiza el motor los offsets (ver body/shared.ts#quantizeOffset). Con valores fuera de esa grilla la cara del frente y la pared exterior no compartirían vértices.
function floorToGrid(value: number): number {
  return Math.floor(value * 100 + 1e-6) / 100;
}

const fmt = (mm: number) => (Math.round(mm * 100) / 100).toString();

export interface InwardResolution {
  /** Parámetros efectivos: lo que realmente se genera (el modelo y la exportación usan ESTOS). */
  params: LetterSignParams;
  warnings: LetterGeometryWarning[];
}

/**
 * Acota el bisel superior y la cintura lateral para que la geometría siga
 * siendo imprimible, SIN cambiar silenciosamente lo que pidió el usuario
 * (cada ajuste produce un warning con la causa):
 *
 *  - Bisel superior: la zona biselada no ocupa más de la mitad de la altura de
 *    pared (`MAX_BEVEL_WALL_FRACTION`: el resto es pared vertical) y no se
 *    inclina más de 45° respecto de la vertical (desplazamiento <= altura de la
 *    banda), porque la cavidad lo acompaña como voladizo interior.
 *  - Ambos: el desplazamiento deja al trazo MÁS FINO del diseño al menos
 *    `MIN_STROKE_TOP_WIDTH_MM` de ancho en su cara más angosta (ver
 *    geometry/strokeLimits.ts): ni parte letras chicas en pedazos ni las deja
 *    en filo. Si no queda margen útil el modificador se desactiva.
 */
export function resolveInwardModifiers(contourGroups: ContourGroup[], params: LetterSignParams): InwardResolution {
  const warnings: LetterGeometryWarning[] = [];
  const wallHeight = params.depthMm - params.baseMm;
  const applies = params.bodyType === "standard" && params.frontType !== "light-channel" && wallHeight > 0;
  if (!applies || (!params.bevelEnabled && !params.grooveEnabled)) return { params, warnings };

  const next: LetterSignParams = { ...params };
  const bevelReasons: string[] = [];
  const grooveReasons: string[] = [];

  if (params.bevelEnabled) {
    const depthLimit = MAX_BEVEL_WALL_FRACTION * wallHeight;
    if (params.bevelDepthMm > depthLimit + 1e-9) {
      next.bevelDepthMm = floorToGrid(depthLimit);
      bevelReasons.push("la zona biselada no puede ocupar más de la mitad de la pared (el resto queda vertical)");
    }
    if (params.bevelInsetMm > next.bevelDepthMm + 1e-9) {
      next.bevelInsetMm = next.bevelDepthMm;
      bevelReasons.push("el bisel no puede inclinarse más de 45° respecto de la vertical");
    }
  }

  // Protección por trazo fino: un solo cálculo para ambos modificadores.
  const requestedInset = Math.max(params.bevelEnabled ? next.bevelInsetMm : 0, params.grooveEnabled ? params.grooveInsetMm : 0);
  const strokeHalfWidth = minStrokeHalfWidthMm(contourGroups, requestedInset + MIN_STROKE_TOP_WIDTH_MM / 2);
  const strokeAllowedInset = Number.isFinite(strokeHalfWidth) ? Math.max(0, strokeHalfWidth - MIN_STROKE_TOP_WIDTH_MM / 2) : Infinity;
  const strokeReason = `los trazos más finos del diseño deben conservar al menos ${fmt(MIN_STROKE_TOP_WIDTH_MM)} mm de ancho`;

  if (params.bevelEnabled) {
    if (next.bevelInsetMm > strokeAllowedInset + 1e-9) {
      next.bevelInsetMm = strokeAllowedInset;
      bevelReasons.push(strokeReason);
    }
    next.bevelInsetMm = floorToGrid(next.bevelInsetMm);
    next.bevelDepthMm = floorToGrid(next.bevelDepthMm);
    if (next.bevelInsetMm < MIN_USEFUL_INSET_MM) {
      next.bevelEnabled = false;
      bevelReasons.push("no queda margen para un bisel útil");
    }
  }
  if (params.grooveEnabled) {
    if (next.grooveInsetMm > strokeAllowedInset + 1e-9) {
      next.grooveInsetMm = strokeAllowedInset;
      grooveReasons.push(strokeReason);
    }
    next.grooveInsetMm = floorToGrid(next.grooveInsetMm);
    if (next.grooveInsetMm < MIN_USEFUL_INSET_MM) {
      next.grooveEnabled = false;
      grooveReasons.push("no queda margen para una cintura útil");
    }
  }

  if (bevelReasons.length > 0) {
    const result = next.bevelEnabled
      ? `se ajustó a ${fmt(next.bevelDepthMm)} mm de altura y ${fmt(next.bevelInsetMm)} mm de desplazamiento (pedido: ${fmt(params.bevelDepthMm)} y ${fmt(params.bevelInsetMm)} mm)`
      : "se desactivó";
    warnings.push({ code: "BEVEL_CLAMPED", message: `El bisel superior ${result}: ${bevelReasons.join("; ")}.` });
  }
  if (grooveReasons.length > 0) {
    const result = next.grooveEnabled
      ? `se ajustó a ${fmt(next.grooveInsetMm)} mm de desplazamiento (pedido: ${fmt(params.grooveInsetMm)} mm)`
      : "se desactivó";
    warnings.push({ code: "GROOVE_CLAMPED", message: `El bisel lateral ${result}: ${grooveReasons.join("; ")}.` });
  }

  return { params: next, warnings };
}
