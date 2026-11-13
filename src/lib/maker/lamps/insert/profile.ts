import { LAMP_GEOMETRY, type LampInsertProfileStyle, type LampInsertProfileTop } from "@/lib/maker/lamps/types";
import type { InsertRow, InsertSurface, InsertSurfaceInput, InsertSurfaceIssue, RZ } from "@/lib/maker/lamps/insert/surface";

/**
 * DIFUSORES DECORATIVOS DE PERFIL (Mossglow, Tulipán, Reloj de arena, Campana): superficies de revolución cuyo radio es una FUNCIÓN
 * del alto `r(z)` por encima de un encastre inferior que NO se toca.
 *
 * Contrato mecánico (idéntico al de los otros difusores, ver `surface.ts`): desde el borde inferior (`z0`) hasta `zm = z0 + seatDepth +
 * insertMountExtraMm` el difusor es el tubo liso ESTÁNDAR de radio `fitOuterR` (Ø65,135 de diffuser.stl) y pared `thicknessMm`. Ningún
 * parámetro decorativo lo modifica: el perfil decorativo nace en `zm`, con tangente vertical y radio `fitOuterR` (continuidad C1), y se
 * mezcla con la forma pedida en un tramo de transición cuya pendiente se mantiene en torno a 40° respecto de la vertical.
 *
 * La silueta de Mossglow se parametriza (altura, ancho, estrechamiento, curvatura); la malla de referencia NO se copia ni se escala.
 *
 * Todo sale de una sola polilínea exterior (r, z) y de su desfase interior sobre la normal: lo que se valida, se ve, se miniaturiza y
 * se exporta son las mismas filas. Nada de acá toca estado global.
 */

const DEG = 180 / Math.PI;
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Terminaciones superiores con sentido geométrico para cada estilo (la primera es la predeterminada). Solo se ofrecen estas. */
export const PROFILE_TOPS: Readonly<Record<LampInsertProfileStyle, readonly LampInsertProfileTop[]>> = {
  mossglow: ["open", "flat", "round", "drop"],
  tulip: ["open", "flat"],
  hourglass: ["open", "flat", "round"],
  bell: ["round", "drop", "flat"],
};

export const PROFILE_TOP_LABELS: Readonly<Record<LampInsertProfileTop, string>> = { open: "Abierta", flat: "Tapa plana", round: "Redondeada", drop: "Gota" };

export const PROFILE_STYLES: readonly LampInsertProfileStyle[] = ["mossglow", "tulip", "hourglass", "bell"];

export function isProfileStyle(style: string): style is LampInsertProfileStyle {
  return (PROFILE_STYLES as readonly string[]).includes(style);
}

export function allowedProfileTops(style: LampInsertProfileStyle): readonly LampInsertProfileTop[] {
  return PROFILE_TOPS[style];
}

/** Terminación efectiva: si la guardada no tiene sentido para el estilo (diseño guardado, cambio de estilo) se usa la primera permitida. */
export function effectiveProfileTop(style: LampInsertProfileStyle, top: LampInsertProfileTop): LampInsertProfileTop {
  return PROFILE_TOPS[style].includes(top) ? top : PROFILE_TOPS[style][0];
}

/**
 * Orientación de impresión del difusor de perfil: parado (abertura inferior sobre la cama, `lampInsertDrop`) o invertido (extremo superior sobre la cama, `lampInsert`).
 * Con tapa plana se imprime invertido (la tapa es la primera capa); el Tulipán, que se abre hacia arriba, también (el borde ancho sobre la cama);
 * el resto se imprime parado, porque se estrecha o se cierra hacia arriba.
 */
export function profilePrintKind(style: LampInsertProfileStyle, top: LampInsertProfileTop): "lampInsert" | "lampInsertDrop" {
  return style === "tulip" || effectiveProfileTop(style, top) === "flat" ? "lampInsert" : "lampInsertDrop";
}

/** Referencia de la que sale la silueta Mossglow (medidas del brief del sprint; la malla de referencia no se copia ni se redistribuye). */
export const MOSSGLOW_REFERENCE = { heightMm: 154.27, maxDiameterMm: 67.7, topDiameterMm: 24.3 } as const;

interface ProfileGeom {
  /** Radio de la forma decorativa a la fracción `u` (0 = arranque sobre el encastre, 1 = final de la zona del cuerpo). */
  r: (u: number) => number;
}

/** Funciones de radio de cada estilo: acotadas por sus parámetros (sin sobreimpulsos que rompan los mínimos/máximos). */
function geometryFor(input: InsertSurfaceInput, Rf: number, top: LampInsertProfileTop): ProfileGeom {
  const p = input.profile;
  const k = clamp01(p.curvaturePct / 100);
  const Rw = p.widthMm / 2;
  const Rt = p.topDiameterMm / 2;
  switch (input.style as LampInsertProfileStyle) {
    case "tulip": {
      // Cuerpo que se abre hacia arriba: de 0 = cono recto a 100 = copa (arranque y borde casi verticales, apertura en el medio).
      const blend = (u: number) => (1 - k) * u + k * smooth(u);
      return { r: (u) => Rf + (Rt - Rf) * blend(clamp01(u)) };
    }
    case "hourglass": {
      // Extremos al ancho pedido y cintura en la posición pedida: coseno elevado a cada lado (pendiente nula en la cintura y en los extremos).
      const w = clamp01(p.waistPct / 100);
      const pos = Math.min(0.85, Math.max(0.15, p.waistPositionPct / 100));
      const Rwaist = Rw * (1 - 0.7 * w);
      const bump = (u: number) => {
        const x = clamp01(u);
        const d = x <= pos ? (pos - x) / pos : (x - pos) / (1 - pos);
        return 0.5 * (1 + Math.cos(Math.PI * Math.min(1, d)));
      };
      return { r: (u) => Rw - (Rw - Rwaist) * bump(u) };
    }
    case "bell": {
      // Falda ancha abajo y cierre superior en una superelipse: el exponente fija la forma de la terminación; la curvatura mezcla con un cono recto.
      const n = top === "drop" ? 1.45 : top === "flat" ? 3.4 : 2;
      const mix = 0.25 + 0.75 * k;
      const span = top === "flat" ? 0.82 : 1; // con tapa plana el perfil se corta antes de llegar al eje
      const body = (u: number) => Rw * Math.pow(Math.max(0, 1 - Math.pow(clamp01(u) * span, n)), 1 / n);
      const cone = (u: number) => Rw * (1 - clamp01(u) * span);
      return { r: (u) => mix * body(u) + (1 - mix) * cone(u) };
    }
    default: {
      // mossglow: ancho en el arranque y estrechamiento progresivo hasta el diámetro superior. La curvatura mueve el exponente: 0 = cono recto, 100 = abombado (ancho más tiempo, cierra rápido arriba).
      const e = 1.15 + 2.1 * k;
      return { r: (u) => Rt + (Rw - Rt) * (1 - Math.pow(clamp01(u), e)) };
    }
  }
}

/** Cierre superior (redondeado o gota) como una curva de Bézier cúbica tangente a la pared, que llega al eje con tangente horizontal. */
function closureCurve(p0: RZ, dir0: RZ, closureH: number, kind: "round" | "drop", steps: number): RZ[] {
  const P3: RZ = { r: 0, z: p0.z + closureH };
  const isRound = kind === "round";
  const h0 = (isRound ? 0.5523 : 0.42) * closureH;
  const h3 = (isRound ? 0.5523 : 0.34) * Math.max(p0.r, 1e-6);
  const P1: RZ = { r: p0.r + h0 * dir0.r, z: p0.z + h0 * dir0.z };
  const P2: RZ = { r: h3, z: P3.z };
  const out: RZ[] = [];
  for (let i = 1; i <= steps; i++) {
    const s = i / steps;
    const a = (1 - s) ** 3, b = 3 * s * (1 - s) ** 2, c = 3 * s * s * (1 - s), d = s ** 3;
    out.push({ r: i === steps ? 0 : a * p0.r + b * P1.r + c * P2.r + d * P3.r, z: a * p0.z + b * P1.z + c * P2.z + d * P3.z });
  }
  return out;
}

/** Desfase interior sobre la normal de un contorno exterior (abajo -> arriba) y el menor radio de curvatura de las zonas convexas. */
function offsetInner(outer: RZ[], t: number): { inner: RZ[]; minConvexRho: number } {
  const inner: RZ[] = [];
  let minConvexRho = Infinity;
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const a = outer[Math.max(0, i - 1)], b = outer[Math.min(n - 1, i + 1)];
    const dr = b.r - a.r, dz = b.z - a.z;
    const len = Math.hypot(dr, dz) || 1;
    // normal exterior (hacia +r al subir): (dz, -dr)/len
    inner.push({ r: outer[i].r - (t * dz) / len, z: outer[i].z + (t * dr) / len });
    if (i > 0 && i < n - 1) {
      const a1 = outer[i - 1], b1 = outer[i + 1];
      const l1 = Math.hypot(outer[i].r - a1.r, outer[i].z - a1.z) || 1;
      const l2 = Math.hypot(b1.r - outer[i].r, b1.z - outer[i].z) || 1;
      const t1 = { r: (outer[i].r - a1.r) / l1, z: (outer[i].z - a1.z) / l1 };
      const t2 = { r: (b1.r - outer[i].r) / l2, z: (b1.z - outer[i].z) / l2 };
      // al subir, un giro hacia el eje (cruce > 0) es una zona convexa vista desde afuera; cerca del polo (r < 3·t) el muestreo no mide bien la curvatura
      const kappa = (t1.r * t2.z - t1.z * t2.r) / ((l1 + l2) / 2);
      if (kappa > 1e-9 && outer[i].r > 3 * t) minConvexRho = Math.min(minConvexRho, 1 / kappa);
    }
  }
  return { inner, minConvexRho };
}

export function buildProfileSurface(input: InsertSurfaceInput, empty: (input: InsertSurfaceInput, issues: InsertSurfaceIssue[]) => InsertSurface): InsertSurface {
  const g = LAMP_GEOMETRY;
  const issues: InsertSurfaceIssue[] = [];
  const err = (code: string, field: string, message: string) => issues.push({ code, field, severity: "error", message });
  const style = input.style as LampInsertProfileStyle;
  const Rf = input.fitOuterR;
  const t = input.thicknessMm;
  const { z0 } = input;
  const ztop = z0 + input.heightMm;
  const top = effectiveProfileTop(style, input.profile.top);
  const geom = geometryFor(input, Rf, top);
  const tc = input.capThicknessMm;

  const zm = Math.min(z0 + input.seatDepthMm + g.insertMountExtraMm, ztop); // fin del encastre estándar (tubo liso)
  const bellClosed = style === "bell" && top !== "flat";
  const attachedClosure = (top === "round" || top === "drop") && !bellClosed;
  const flatTop = top === "flat";
  // El cierre redondeado/gota de Mossglow y reloj de arena es parte de la altura total y proporcional al radio con que termina el cuerpo.
  const closureH = attachedClosure ? Math.max(6, geom.r(1) * (top === "round" ? 0.9 : 2.1)) : 0;
  const zbEnd = ztop - closureH;
  const bodyH = zbEnd - zm;
  const minBody = 14;
  if (bodyH < minBody) {
    err("INSERT_PROFILE_TOO_SHORT", "insert.heightMm", `La altura del difusor (${fmt(input.heightMm)} mm) no alcanza: sobre el encastre estándar (${fmt(zm - z0)} mm)${attachedClosure ? ` y el cierre superior (${fmt(closureH)} mm)` : ""} hacen falta al menos ${fmt(minBody)} mm de cuerpo decorativo. Subí la altura o usá otra terminación.`);
    return empty(input, issues);
  }

  // Transición del encastre al cuerpo: del radio estándar al radio con que arranca la forma decorativa, con pendiente nula en los dos extremos
  // (continuidad C1) y acotada en el medio (~40° respecto de la vertical como máximo). Si la forma ya arranca en el radio del encastre no hay transición.
  const R0 = geom.r(0);
  const Lr = Math.abs(R0 - Rf) < 0.05 ? 0 : Math.min(bodyH * 0.4, Math.max(6, (1.5 * Math.abs(R0 - Rf)) / Math.tan((40 * Math.PI) / 180)));
  const zs = zm + Lr; // aquí empieza la forma decorativa con su radio exacto (Ancho = Ø máximo medido)
  const radiusAt = (z: number): number => {
    if (z <= zm) return Rf;
    if (z < zs) return Rf + (R0 - Rf) * smooth((z - zm) / Lr);
    return geom.r(Math.min(1, (z - zs) / (zbEnd - zs)));
  };

  // Muestreo en z: más denso en los dos extremos del tramo (transición y final).
  const nBody = Math.max(60, Math.min(240, Math.round(bodyH / 1.2)));
  const outerAsc: RZ[] = [{ r: Rf, z: z0 }];
  if (zm > z0 + 1e-6) outerAsc.push({ r: Rf, z: zm });
  for (let i = 1; i <= nBody; i++) {
    const s = i / nBody;
    const z = zm + bodyH * (0.5 * s + 0.5 * (0.5 - 0.5 * Math.cos(Math.PI * s)));
    outerAsc.push({ r: i === nBody && bellClosed ? 0 : radiusAt(z), z });
  }

  // Terminación
  let poleReached = bellClosed;
  if (attachedClosure) {
    const last = outerAsc[outerAsc.length - 1];
    const prev = outerAsc[outerAsc.length - 2];
    const len = Math.hypot(last.r - prev.r, last.z - prev.z) || 1;
    const dir0 = { r: (last.r - prev.r) / len, z: (last.z - prev.z) / len };
    for (const pt of closureCurve(last, dir0, closureH, top === "drop" ? "drop" : "round", 40)) outerAsc.push(pt);
    poleReached = true;
  }

  // ---- Contorno exterior: solo la PARED cuenta para la inclinación y los diámetros (la cúpula llega al eje con tangente horizontal por construcción)
  const capCut = 0.5 * Math.max(Rf, R0);
  const isWall = (a: RZ, b: RZ) => (attachedClosure ? a.z < zbEnd - 1e-6 : bellClosed ? Math.min(a.r, b.r) >= capCut : true);
  let maxLean = 0;
  let maxLeanZ = zm;
  let bodyMaxR = Rf;
  let bodyMinR = Infinity;
  let outerOk = true;
  for (let i = 1; i < outerAsc.length; i++) {
    const a = outerAsc[i - 1], b = outerAsc[i];
    if (b.z < a.z - 1e-9) outerOk = false;
    bodyMaxR = Math.max(bodyMaxR, a.r, b.r);
    if (!isWall(a, b)) continue;
    const lean = Math.atan2(Math.abs(b.r - a.r), Math.max(b.z - a.z, 1e-9)) * DEG;
    if (lean > maxLean) {
      maxLean = lean;
      maxLeanZ = (a.z + b.z) / 2;
    }
    if (a.z >= zm - 1e-9) bodyMinR = Math.min(bodyMinR, a.r);
    if (b.z >= zm - 1e-9) bodyMinR = Math.min(bodyMinR, b.r);
  }
  if (!Number.isFinite(bodyMinR)) bodyMinR = Rf;
  if (!outerOk) {
    err("INSERT_PROFILE_INVALID", "insert.profileCurvaturePct", "Con estos valores el contorno se pliega sobre sí mismo (la pared retrocede en altura). Reducí la curvatura o el estrechamiento.");
    return empty(input, issues);
  }
  if (maxLean > g.hardMaxTiltDeg) {
    err("INSERT_PROFILE_TOO_STEEP", "insert.profileCurvaturePct", `La pared del difusor se inclina ${fmt(maxLean)}° respecto de la vertical (a ${fmt(maxLeanZ - z0)} mm sobre su borde inferior): no es imprimible (máximo ${g.hardMaxTiltDeg}°). Reducí la curvatura, el estrechamiento o la apertura, o subí la altura.`);
  } else if (maxLean > g.dropLeanWarnDeg) {
    issues.push({ code: "INSERT_PROFILE_STEEP", field: "insert.profileCurvaturePct", severity: "warning", message: `La pared del difusor se inclina hasta ${fmt(maxLean)}° respecto de la vertical: puede necesitar soportes. Subí la altura o suavizá la curvatura para imprimirlo sin soportes.` });
  }
  if (bodyMinR < t + 1) {
    err("INSERT_PROFILE_TOO_NARROW", "insert.profileTopDiameterMm", `El difusor se estrecha hasta Ø ${fmt(2 * bodyMinR)} mm: con ${fmt(t)} mm de pared no queda hueco interior. Ensanchá la parte superior o reducí el espesor.`);
  }
  if (issues.some((i) => i.severity === "error")) return empty(input, issues);

  // ---- Cara interior: desfase sobre la normal; el tubo del encastre queda vertical (pared de espesor t) hasta zm
  const off = offsetInner(outerAsc, t);
  const minRho = Math.max(g.insertCrestRadiusFactor * t, t + 0.4);
  if (off.minConvexRho < minRho) {
    err("INSERT_PROFILE_THIN_CURVE", "insert.profileCurvaturePct", `En la zona más curva del difusor el radio de curvatura es de ${fmt(off.minConvexRho)} mm: con ${fmt(t)} mm de pared el interior se plegaría. Reducí la curvatura o el espesor, o alargá el difusor.`);
    return empty(input, issues);
  }
  let innerAsc: RZ[] = off.inner.map((p, i) => (outerAsc[i].z <= zm + 1e-9 ? { r: Rf - t, z: outerAsc[i].z } : p));
  if (poleReached) {
    // el interior termina en el eje a `t` bajo el ápice: se descartan los puntos desfasados que ya cruzaron el eje o superan esa altura
    const zInnerTop = outerAsc[outerAsc.length - 1].z - t;
    innerAsc = innerAsc.filter((p) => p.r > Math.max(0.25, 0.3 * t) && p.z < zInnerTop - 1e-3);
    innerAsc.push({ r: 0, z: zInnerTop });
  }
  if (!poleReached && !flatTop) {
    // borde superior abierto: el desfase sobre la normal deja el extremo interior un poco más alto (pared que se abre) o más bajo (se estrecha) que el exterior;
    // se lleva el interior hasta el plano z = ztop siguiendo su último tramo, para que el borde sea plano y la altura total sea exactamente la pedida
    while (innerAsc.length > 2 && innerAsc[innerAsc.length - 2].z >= ztop - 1e-9) innerAsc.pop();
    const a = innerAsc[innerAsc.length - 2], b = innerAsc[innerAsc.length - 1];
    const f = (ztop - a.z) / Math.max(b.z - a.z, 1e-9);
    innerAsc[innerAsc.length - 1] = { r: a.r + f * (b.r - a.r), z: ztop };
  }
  for (let i = 1; i < innerAsc.length; i++) {
    if (innerAsc[i].z < innerAsc[i - 1].z - 1e-7) {
      err("INSERT_PROFILE_THIN_CURVE", "insert.profileCurvaturePct", `El interior del difusor se pliega con ${fmt(t)} mm de pared. Reducí el espesor o la curvatura.`);
      return empty(input, issues);
    }
  }
  const dedupe = (pts: RZ[]) => pts.filter((p, i) => i === 0 || Math.hypot(p.r - pts[i - 1].r, p.z - pts[i - 1].z) > 1e-6);
  const outerPts = dedupe(outerAsc);
  let innerPts = dedupe(innerAsc);

  // ---- Filas de la superficie
  let rows: InsertRow[];
  let closedTop = false;
  let innerTopZ: number | null = null;
  if (flatTop) {
    // tapa plana: un disco de `capThicknessMm` cierra el extremo superior; el radio interior bajo la tapa se interpola sobre el desfase
    const topInner = ztop - tc;
    const below = innerPts.filter((p) => p.z < topInner - 1e-6);
    let rin = below[below.length - 1]?.r ?? Rf - t;
    for (let i = 1; i < innerPts.length; i++) {
      if (innerPts[i].z >= topInner) {
        const f = (topInner - innerPts[i - 1].z) / Math.max(innerPts[i].z - innerPts[i - 1].z, 1e-9);
        rin = innerPts[i - 1].r + f * (innerPts[i].r - innerPts[i - 1].r);
        break;
      }
    }
    innerPts = [...below, { r: rin, z: topInner }];
    innerTopZ = topInner;
    closedTop = true;
    rows = [{ z: topInner, r: 0 }, ...[...innerPts].reverse().map((p) => ({ z: p.z, r: p.r })), ...outerPts.map((p) => ({ z: p.z, r: p.r })), { z: ztop, r: 0 }];
  } else if (poleReached) {
    innerTopZ = ztop - t;
    closedTop = true;
    rows = [...innerPts].reverse().concat(outerPts).map((p) => ({ z: p.z, r: p.r }));
  } else {
    rows = [...outerPts.map((p) => ({ z: p.z, r: p.r })), ...[...innerPts].reverse().map((p) => ({ z: p.z, r: p.r }))];
  }

  // Cúpula: zona más inclinada de 45° respecto de la vertical (casi horizontal). Impresa parada puede pedir soportes arriba.
  if (poleReached) {
    let capRadius = 0;
    for (let i = 1; i < outerPts.length; i++) {
      const a = outerPts[i - 1], b = outerPts[i];
      if (Math.atan2(Math.abs(b.r - a.r), Math.max(b.z - a.z, 1e-9)) * DEG > g.dropLeanWarnDeg) capRadius = Math.max(capRadius, a.r);
    }
    if (capRadius * 2 > 16) {
      issues.push({ code: "INSERT_PROFILE_CAP_OVERHANG", field: "insert.profileTop", severity: "warning", message: `La cúpula superior tiene una zona casi horizontal de Ø ${fmt(2 * capRadius)} mm (más inclinada de ${g.dropLeanWarnDeg}° respecto de la vertical): impresa parada puede pedir soportes arriba. Con una terminación en gota o una tapa plana se evita.` });
    }
  }

  return {
    style: input.style,
    mode: closedTop ? "poles" : "closed",
    segments: 144,
    rows,
    closedTop,
    topZ: ztop,
    innerTopZ,
    bodyMaxR,
    tabMaxR: bodyMaxR,
    tabLengthMm: 0,
    minInnerR: Math.min(Rf - t, ...innerPts.filter((p) => p.r > 0).map((p) => p.r)),
    innerPoints: innerPts.map((p) => ({ r: p.r, z: p.z })),
    maxLeanDeg: maxLean,
    tipArcStartLeanDeg: null,
    cylinderHeightMm: zm - z0,
    closureHeightMm: closureH,
    bodyMinR,
    outline: { crest: outerPts, valley: outerPts, inner: innerPts },
    issues,
    valid: !issues.some((i) => i.severity === "error"),
  };
}
