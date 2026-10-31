import { minInnerRadiusBetween, type ShadeField } from "@/lib/maker/lamps/shade/surface";
import { LAMP_GEOMETRY, type LampDefinition, type LampFitReport } from "@/lib/maker/lamps/types";

/**
 * Posiciones (ensamblado: base apoyada en Z = 0, eje de la lámpara en X = Y = 0) y radios derivados de la definición.
 * Es la ÚNICA fuente de las cotas de encastre: la geometría de base/inserto/pantalla y la validación leen de acá, así
 * que lo que se valida es exactamente lo que se genera.
 */
export interface LampLayout {
  /** Altura de la base (cubierta superior). */
  baseTopZ: number;
  grooveZ0: number;
  holderSeatZ: number;
  holderTopZ: number;
  bulbTopZ: number;
  shadeZ0: number;
  shadeTopZ: number;
  /** Radio exterior del collar de la pantalla. */
  collarOuterR: number;
  collarInnerR: number;
  /** Radio exterior del aro de centrado de la base. */
  lipOuterR: number;
  baseDiameterMm: number;
  baseDiameterAuto: boolean;
  holderR: number;
  bulbR: number;
  insert: null | {
    outerR: number;
    innerR: number;
    heightMm: number;
    z0: number;
    z1: number;
    auto: boolean;
    tabLengthMm: number;
  };
  fit: LampFitReport;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const ceilTo = (n: number, step: number) => Math.ceil(n / step - 1e-9) * step;

export function computeLampLayout(def: LampDefinition, field: ShadeField): LampLayout {
  const g = LAMP_GEOMETRY;
  const { shade, insert, base, holder, bulb } = def;
  const baseTopZ = base.heightMm;
  const shadeZ0 = baseTopZ + base.ventGapMm;
  const shadeTopZ = shadeZ0 + shade.heightMm;
  const holderSeatZ = baseTopZ - g.holderRecessDepthMm;
  const holderTopZ = holderSeatZ + holder.heightMm;
  const bulbTopZ = holderTopZ + bulb.heightAboveHolderMm;
  const collarOuterR = shade.bottomDiameterMm / 2;
  const collarInnerR = collarOuterR - shade.wallMm;
  const lipOuterR = collarOuterR + g.shadeFitClearanceMm + g.lipWidthMm;
  const holderR = holder.bodyDiameterMm / 2;
  const bulbR = bulb.diameterMm / 2;
  const requiredInnerR = Math.max(bulbR, holderR) + insert.minBulbGapMm;

  const maxShadeD = 2 * field.maxOuterRadius;
  const autoBaseD = ceilTo(Math.max(shade.bottomDiameterMm + 2 * (g.shadeFitClearanceMm + g.lipWidthMm + 6), 0.6 * maxShadeD, 0.3 * shadeTopZ), 5);
  const baseDiameterMm = base.diameterMm ?? autoBaseD;

  let insertLayout: LampLayout["insert"] = null;
  let shadeClear: number | null = null;
  if (insert.enabled) {
    const z0 = baseTopZ - g.grooveDepthMm;
    const heightMm = round1((insert.heightPct / 100) * (shadeTopZ - z0));
    const z1 = z0 + heightMm;
    const tabLen = insert.tabs ? g.tabLengthMm : 0;
    const localTop = z1 - shadeZ0;
    // Espacio libre exterior para el inserto: la pantalla es la más angosta en algún punto de la altura del inserto.
    const clearAll = minInnerRadiusBetween(field, 0, localTop) - insert.clearanceMm;
    const clearTop = minInnerRadiusBetween(field, localTop - g.tabThicknessMm, localTop) - insert.clearanceMm - tabLen;
    shadeClear = Math.min(clearAll, clearTop);
    const auto = insert.diameterMm === null;
    const outerR = auto ? Math.floor(shadeClear * 4) / 4 : insert.diameterMm! / 2;
    insertLayout = { outerR, innerR: outerR - insert.thicknessMm, heightMm, z0, z1, auto, tabLengthMm: tabLen };
  }

  const gapActual = insertLayout ? insertLayout.innerR - Math.max(bulbR, holderR) : null;
  const fit: LampFitReport = {
    shadeBottomZ: shadeZ0,
    shadeTopZ,
    insertBottomZ: insertLayout?.z0 ?? null,
    insertTopZ: insertLayout?.z1 ?? null,
    holderTopZ,
    bulbTopZ,
    insertOuterDiameterMm: insertLayout ? round1(2 * insertLayout.outerR) : null,
    insertInnerDiameterMm: insertLayout ? round1(2 * insertLayout.innerR) : null,
    insertAuto: insertLayout?.auto ?? false,
    shadeClearRadiusMm: shadeClear === null ? null : round1(shadeClear),
    requiredInsertInnerRadiusMm: round1(requiredInnerR),
    insertBulbGapMm: gapActual === null ? null : round1(gapActual),
    baseDiameterMm,
  };

  return {
    baseTopZ,
    grooveZ0: baseTopZ - g.grooveDepthMm,
    holderSeatZ,
    holderTopZ,
    bulbTopZ,
    shadeZ0,
    shadeTopZ,
    collarOuterR,
    collarInnerR,
    lipOuterR,
    baseDiameterMm,
    baseDiameterAuto: base.diameterMm === null,
    holderR,
    bulbR,
    insert: insertLayout,
    fit,
  };
}
