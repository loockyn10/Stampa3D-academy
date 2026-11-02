import { measureChamberGap, type DoubleWallParams } from "@/lib/maker/lamps/doublewall/profiles";
import type { LampDefinition } from "@/lib/maker/lamps/types";

/** Altura (mm) en la que las estrías nacen desde 0 sobre el borde inferior: así la pared exterior arranca circular y empalma con la transición de 45° de la rosca. */
export const DOUBLE_WALL_FLUTE_FADE_MM = 10;

/**
 * Parámetros del motor de doble pared a partir de la definición de la lámpara. Altura y diámetros inferior/superior de la pared
 * EXTERIOR vienen de \`shade\` (compartidos con las otras pantallas); el resto, de \`doubleWall\`. Un diámetro máximo menor que el de los
 * extremos significa "sin abombado" (cilíndrica o cónica), no un error.
 */
export function doubleWallParams(def: LampDefinition): DoubleWallParams {
  const { shade, doubleWall: d } = def;
  const samplesPerFlute = Math.max(12, Math.ceil(240 / Math.max(1, d.flutes)));
  return {
    heightMm: shade.heightMm,
    wallMm: d.wallMm,
    minGapMm: d.minGapMm,
    outer: {
      maxDiameterMm: Math.max(d.maxDiameterMm, shade.bottomDiameterMm, shade.topDiameterMm),
      endDiameterMm: shade.bottomDiameterMm,
      topDiameterMm: shade.topDiameterMm,
      fluteFadeMm: DOUBLE_WALL_FLUTE_FADE_MM,
      bulgePositionPct: d.bulgePositionPct,
      curvaturePct: d.curvaturePct,
      flutes: d.flutes,
      fluteAmplitudeMm: d.fluteAmplitudeMm,
      twistDeg: d.twistDeg,
    },
    inner: {
      endDiameterMm: d.innerBottomDiameterMm,
      topDiameterMm: d.innerTopDiameterMm,
      waistPct: d.innerWaistPct,
      waistPositionPct: d.innerWaistPositionPct,
      curvaturePct: d.innerCurvaturePct,
      organicPct: d.innerOrganicPct,
      seed: d.innerSeed,
    },
    slitMm: 2,
    floorMm: d.floorMm,
    roofHeightMm: d.roofHeightMm,
    roofCapMm: d.roofCapMm,
    topGapMm: d.topGapMm,
    samplesPerFlute,
    innerSegments: 120,
    rowMm: 2,
  };
}

/**
 * Al elegir «Doble pared» los diámetros de los extremos de la pared exterior (compartidos con las otras pantallas) se llevan, de a 5 mm,
 * al mínimo que respeta la separación pedida con la pared interior. Es una acción del usuario al cambiar de tipo, y se informa en el
 * panel; durante la edición NUNCA se corrige nada solo (si después una combinación no cumple, hay un error con el motivo).
 */
export function fitDoubleWallEnds(def: LampDefinition): LampDefinition {
  let d = Math.max(def.shade.bottomDiameterMm, def.shade.topDiameterMm);
  const ok = (dia: number) => {
    const probe = { ...def, shade: { ...def.shade, bottomDiameterMm: dia, topDiameterMm: dia } };
    const g = measureChamberGap(doubleWallParams(probe), 61);
    return g.minGapMm >= def.doubleWall.minGapMm;
  };
  if (measureChamberGap(doubleWallParams(def), 61).minGapMm >= def.doubleWall.minGapMm) return def; // ya cumple con las medidas actuales
  while (!ok(d) && d < 300) d += 5;
  return { ...def, shade: { ...def.shade, bottomDiameterMm: d, topDiameterMm: d } };
}
