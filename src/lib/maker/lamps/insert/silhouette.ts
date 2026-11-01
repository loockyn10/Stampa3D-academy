import { INSERT_STYLE_INITIAL } from "@/lib/maker/lamps/defaults";
import { buildInsertSurface, type InsertSurface, type RZ } from "@/lib/maker/lamps/insert/surface";
import type { LampInsertDef, LampInsertStyle } from "@/lib/maker/lamps/types";

export interface InsertSilhouette {
  /** Contorno exterior (relleno), valle de las ondas, cavidad interior; en un viewBox de `width` × `height`. */
  outer: string;
  valley: string;
  cavity: string;
  width: number;
  height: number;
  /** Altura y diámetro máximo (mm) del modelo representado, para rotular la miniatura. */
  heightMm: number;
  maxDiameterMm: number;
}

/** Referencia fija de las miniaturas: mismas medidas para los tres estilos, para que se comparen a ojo. */
const REF = { outerR: 32.5, thicknessMm: 0.8, seatDepthMm: 10, z0: 0, heightMm: 120 };

/** Superficie de un estilo a medidas de referencia: con `params` = los parámetros actuales del estilo; sin ellos, los iniciales. */
export function referenceInsertSurface(style: LampInsertStyle, base: LampInsertDef, useCurrent: boolean): InsertSurface {
  const p: LampInsertDef = useCurrent ? base : { ...base, ...INSERT_STYLE_INITIAL[style] };
  return buildInsertSurface({
    style,
    outerR: REF.outerR,
    thicknessMm: Math.min(p.thicknessMm, 2),
    z0: REF.z0,
    heightMm: REF.heightMm,
    seatDepthMm: REF.seatDepthMm,
    capThicknessMm: p.capThicknessMm,
    drop: { closureMm: p.dropClosureMm, curvaturePct: p.dropCurvaturePct, tipRadiusMm: p.dropTipRadiusMm },
    wavy: { waves: p.waves, amplitudeMm: p.amplitudeMm, twistDeg: p.twistDeg, verticalFrequency: p.verticalFrequency, top: p.wavyTop },
    tabs: false,
  });
}

/**
 * Silueta 2D de un inserto a partir de su superficie (la misma que se malla y se exporta): perfil exterior en las crestas, valle
 * y cavidad interior. Escala fija mm -> px: los tres estilos se comparan a ojo. Sin malla: es barata.
 */
export function insertSilhouette(surface: InsertSurface, heightPx = 84): InsertSilhouette {
  const z0 = surface.outline.crest[0]?.z ?? 0;
  const scale = heightPx / Math.max(surface.topZ - z0, 1);
  const maxR = Math.max(surface.bodyMaxR, 1) * scale;
  const width = Math.ceil(maxR * 2 + 4);
  const cx = width / 2;
  const y = (z: number) => heightPx - (z - z0) * scale;
  const closeTop = (pts: RZ[], topZ: number): RZ[] => (surface.closedTop && pts[pts.length - 1]?.r !== 0 ? [...pts, { r: 0, z: topZ }] : pts);
  const path = (pts: RZ[]) => {
    if (pts.length === 0) return "";
    const right = pts.map((p) => `${(cx + p.r * scale).toFixed(1)},${y(p.z).toFixed(1)}`);
    const left = [...pts].reverse().map((p) => `${(cx - p.r * scale).toFixed(1)},${y(p.z).toFixed(1)}`);
    return `M${right.join("L")}L${left.join("L")}Z`;
  };
  return {
    outer: path(closeTop(surface.outline.crest, surface.topZ)),
    valley: path(closeTop(surface.outline.valley, surface.topZ)),
    cavity: path(closeTop(surface.outline.inner, surface.innerTopZ ?? surface.topZ)),
    width,
    height: heightPx,
    heightMm: surface.topZ - z0,
    maxDiameterMm: 2 * surface.bodyMaxR,
  };
}
