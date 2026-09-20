import type { Artwork } from "@/lib/maker/mugs/decorations/artwork";
import { getDecorationField, sampleSd, type DecorationField } from "@/lib/maker/mugs/decorations/field";
import type { MugDecoration, MugMedallionShape } from "@/lib/maker/mugs/types";

/**
 * Coordenadas de superficie de una decoración y su evaluación como DESPLAZAMIENTO RADIAL del cuerpo.
 *
 *  - Ángulo semántico: 0° = frente, +90° = derecha (lado del asa), 180° = atrás, -90° = izquierda. Interno: el asa
 *    vive en +X (theta = 0) y el frente mira a -Y => theta = angleDeg - 90°. Crece en el mismo sentido en que se lee
 *    un texto visto de frente (de izquierda a derecha).
 *  - Mapeo 2D -> cuerpo: u (tangencial) = Δtheta · r_local(z), con Δtheta envuelto a (-π, π] (sin costura en ±180°);
 *    v (vertical) = longitud de ARCO del perfil exterior desde el centro (no Δz): en paredes inclinadas el arte no se
 *    deforma verticalmente. r_local es el radio de la superficie YA modificada (bandas/ranuras/facetas) de esa altura.
 *  - Rotación: en el plano local (u, v) ANTES del envolvimiento.
 *  - Desplazamiento: relieve/medallón suman, grabado resta. La profundidad es NORMAL a la pared; el desplazamiento
 *    radial equivalente es depth · √(1 + r'(z)²) (misma regla que la pared interior).
 */
export const SEMANTIC_ANGLE_OFFSET_DEG = -90;

export function semanticToTheta(angleDeg: number): number {
  return ((angleDeg + SEMANTIC_ANGLE_OFFSET_DEG) * Math.PI) / 180;
}
export function thetaToSemantic(theta: number): number {
  let a = (theta * 180) / Math.PI - SEMANTIC_ANGLE_OFFSET_DEG;
  a = ((((a + 180) % 360) + 360) % 360) - 180;
  return a;
}
/** Preajustes de posición: solo cambian `angleDeg`. */
export const ANGLE_PRESETS: { label: string; angleDeg: number }[] = [
  { label: "Frente", angleDeg: 0 },
  { label: "Atrás", angleDeg: 180 },
  { label: "Izquierda", angleDeg: -90 },
  { label: "Derecha", angleDeg: 90 },
];

function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

/** Cobertura 0..1 dentro de la silueta: 0 en el borde, 1 a `bevel` mm hacia adentro (bevel 0 = borde recto). */
export function coverage(sd: number, bevelMm: number): number {
  if (sd <= 0) return 0;
  if (bevelMm <= 1e-6) return 1;
  return smoothstep(sd / bevelMm);
}

/** Distancia con signo (+ dentro) a la forma del medallón, centrada en el origen. */
export function medallionSd(shape: MugMedallionShape, x: number, y: number, W: number, H: number, cornerRadius: number): number {
  if (shape === "circle") return Math.min(W, H) / 2 - Math.hypot(x, y);
  if (shape === "oval") {
    const a = W / 2, b = H / 2;
    return (1 - Math.hypot(x / a, y / b)) * Math.min(a, b);
  }
  const r = Math.min(Math.max(cornerRadius, 0), Math.min(W, H) / 2);
  const qx = Math.abs(x) - (W / 2 - r), qy = Math.abs(y) - (H / 2 - r);
  return -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
}

export interface ResolvedDecoration {
  dec: MugDecoration;
  theta: number;
  cos: number;
  sin: number;
  /** Tamaño efectivo (mm) de la decoración / medallón. */
  widthMm: number;
  heightMm: number;
  /** Semi-diagonal + margen: fuera de este radio local no hay nada que evaluar. */
  reach: number;
  /** Campo del arte (emboss/engrave, o arte del medallón); null en un medallón liso. */
  field: DecorationField | null;
}

export interface ResolveResult {
  resolved: ResolvedDecoration[];
  /** Habilitadas cuyo arte no está disponible (archivo faltante, texto inválido, fuente sin cargar): se omiten. */
  missing: MugDecoration[];
}

/** Tamaño efectivo del arte (mm): con proporción bloqueada el alto sale del aspect del contenido. */
export function effectiveSize(dec: MugDecoration, art: Artwork | null): { widthMm: number; heightMm: number } {
  const w = dec.size.widthMm;
  if (dec.mode !== "medallion" && dec.size.lockAspectRatio && art) return { widthMm: w, heightMm: w / art.aspect };
  return { widthMm: w, heightMm: dec.size.heightMm };
}

/** Arte de un medallón: se ajusta dentro del medallón (menos el margen) manteniendo la proporción si está bloqueada. */
export function medallionArtSize(dec: MugDecoration, art: Artwork): { widthMm: number; heightMm: number } {
  const boxW = Math.max(dec.size.widthMm - 2 * dec.medallion.paddingMm, 0.1), boxH = Math.max(dec.size.heightMm - 2 * dec.medallion.paddingMm, 0.1);
  if (!dec.size.lockAspectRatio) return { widthMm: boxW, heightMm: boxH };
  const w = Math.min(boxW, boxH * art.aspect);
  return { widthMm: w, heightMm: w / art.aspect };
}

/**
 * Prepara las decoraciones habilitadas para evaluar: construye (o recupera del cache) el campo de cada arte a la
 * resolución pedida. `artworkOf` devuelve el arte ya preparado (null si no está disponible).
 */
export function resolveDecorations(decos: MugDecoration[], artworkOf: (d: MugDecoration) => Artwork | null, resolutionMm: number, artKey: (d: MugDecoration) => string): ResolveResult {
  const resolved: ResolvedDecoration[] = [];
  const missing: MugDecoration[] = [];
  for (const dec of decos) {
    if (!dec.enabled) continue;
    const theta = semanticToTheta(dec.position.angleDeg);
    const phi = (dec.rotationDeg * Math.PI) / 180;
    const base = { dec, theta, cos: Math.cos(phi), sin: Math.sin(phi) };
    if (dec.mode === "medallion") {
      const art = dec.source.kind === "none" ? null : artworkOf(dec);
      if (dec.source.kind !== "none" && !art) { missing.push(dec); continue; }
      const field = art ? (() => { const s = medallionArtSize(dec, art); return getDecorationField(artKey(dec), art, s.widthMm, s.heightMm, resolutionMm); })() : null;
      resolved.push({ ...base, widthMm: dec.size.widthMm, heightMm: dec.size.heightMm, reach: Math.hypot(dec.size.widthMm, dec.size.heightMm) / 2 + 1, field });
      continue;
    }
    const art = artworkOf(dec);
    if (!art) { missing.push(dec); continue; }
    const s = effectiveSize(dec, art);
    resolved.push({ ...base, widthMm: s.widthMm, heightMm: s.heightMm, reach: Math.hypot(s.widthMm, s.heightMm) / 2 + 1, field: getDecorationField(artKey(dec), art, s.widthMm, s.heightMm, resolutionMm) });
  }
  return { resolved, missing };
}

export interface SurfaceProfile {
  heightMm: number;
  /** Radio exterior base (sin modificadores) a la altura z. */
  outerR: (z: number) => number;
}

export type DecorationEvaluator = (z: number, theta: number, rLocal: number) => number;

/**
 * Evaluador de desplazamiento radial (mm, con signo) en un punto (z, theta) de la superficie. Combinación
 * DETERMINÍSTICA por orden de stack (primera = fondo, última = arriba):
 *  - mismo signo: relieve = máximo, grabado = el más profundo;
 *  - signo opuesto: la decoración POSTERIOR se impone donde su cobertura es 1 y se mezcla linealmente en su bevel.
 */
export function createDecorationEvaluator(list: ResolvedDecoration[], surface: SurfaceProfile): DecorationEvaluator | null {
  if (list.length === 0) return null;
  const STEP = 0.5;
  const n = Math.max(2, Math.ceil(surface.heightMm / STEP));
  const arcs = new Float64Array(n + 1);
  const slopeF = new Float64Array(n + 1);
  const dz = surface.heightMm / n;
  for (let i = 1; i <= n; i++) {
    const dr = surface.outerR(i * dz) - surface.outerR((i - 1) * dz);
    arcs[i] = arcs[i - 1] + Math.hypot(dz, dr);
    slopeF[i] = Math.hypot(1, dr / dz);
  }
  slopeF[0] = slopeF[1];
  const at = (tab: Float64Array, z: number) => {
    const t = Math.min(Math.max(z / dz, 0), n);
    const i = Math.min(Math.floor(t), n - 1);
    return tab[i] + (tab[i + 1] - tab[i]) * (t - i);
  };
  const centers = list.map((d) => at(arcs, d.dec.position.centerZMm));

  return (z, theta, rLocal) => {
    const s = at(arcs, z);
    let value = 0;
    for (let k = 0; k < list.length; k++) {
      const d = list[k];
      const v = s - centers[k];
      if (v > d.reach || v < -d.reach) continue;
      let dth = (theta - d.theta) % (2 * Math.PI);
      if (dth > Math.PI) dth -= 2 * Math.PI;
      else if (dth <= -Math.PI) dth += 2 * Math.PI;
      const u = dth * rLocal;
      if (u > d.reach || u < -d.reach) continue;
      const x = u * d.cos + v * d.sin, y = -u * d.sin + v * d.cos;
      const dec = d.dec;
      let target: number, c: number;
      if (dec.mode === "medallion") {
        const hb = coverage(medallionSd(dec.medallion.shape, x, y, d.widthMm, d.heightMm, dec.medallion.cornerRadiusMm), dec.edgeBevelMm);
        if (hb <= 0) continue;
        const ha = d.field ? coverage(sampleSd(d.field, x, y), dec.edgeBevelMm) : 0;
        target = dec.medallion.baseDepthMm * hb + dec.depthMm * ha;
        c = 1;
      } else {
        c = coverage(sampleSd(d.field as DecorationField, x, y), dec.edgeBevelMm);
        if (c <= 0) continue;
        target = dec.mode === "emboss" ? dec.depthMm : -dec.depthMm;
      }
      const t = target * c;
      if (t > 0 ? value >= 0 : value <= 0) value = t > 0 ? Math.max(value, t) : Math.min(value, t);
      else value = value * (1 - c) + target * c;
    }
    return value === 0 ? 0 : value * at(slopeF, z);
  };
}
