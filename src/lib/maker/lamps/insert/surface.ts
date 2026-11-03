import { LAMP_GEOMETRY, type LampInsertStyle, type LampInsertTop } from "@/lib/maker/lamps/types";

/**
 * SUPERFICIE del inserto de color: el perfil (rows) que consumen el mallador (`createInsertMesh`), la validación y las
 * miniaturas de los estilos. Es la ÚNICA fuente: lo que se valida, se ve y se exporta sale de las mismas filas.
 *
 * Tres familias sobre el mismo mecanismo (revolución de un perfil con relieve por columna):
 *   - "flat"  tubo + tapa plana a 90° (extremo superior CERRADO; se imprime invertido, la tapa sobre la cama);
 *   - "drop"  tubo + cierre ojival con punta redondeada (CERRADO; se imprime parado, la abertura sobre la cama);
 *   - "wavy"  tubo con ondas que SOLO suman hacia afuera (el interior nunca se acerca más a la bombilla que el tubo liso),
 *             extremo superior abierto (con lengüetas opcionales) o con tapa plana.
 * La zona de montaje inferior es idéntica en las tres Y ESTÁNDAR: un tubo liso de Ø exterior `fitOuterR` (Ø65,135 de diffuser.stl) que apoya
 * en la ranura de la torre, durante `seatDepthMm + insertMountExtraMm`. Si el cuerpo es más ancho (`outerR` > `fitOuterR`, p. ej. un difusor
 * calado de Ø80) el tubo se ensancha con una transición cónica (45° respecto de la vertical: sin soportes) hasta el radio del cuerpo.
 */
export interface InsertSurfaceInput {
  style: LampInsertStyle;
  /** Radio exterior del CUERPO (nunca menor que `fitOuterR`) y espesor de la pared. */
  outerR: number;
  /** Radio exterior del encastre inferior estándar (zona de montaje que entra en la ranura). */
  fitOuterR: number;
  thicknessMm: number;
  /** Z de ensamblado del borde inferior, altura total y profundidad enterrada en la ranura. */
  z0: number;
  heightMm: number;
  seatDepthMm: number;
  capThicknessMm: number;
  drop: { closureMm: number; curvaturePct: number; tipRadiusMm: number };
  wavy: { waves: number; amplitudeMm: number; twistDeg: number; verticalFrequency: number; top: LampInsertTop };
  /** Lengüetas de extracción (solo con extremo superior abierto). */
  tabs: boolean;
}

/** Una fila del perfil: altura y radio (número = igual en todas las columnas; arreglo = un radio por columna). r = 0 -> polo sobre el eje. */
export interface InsertRow {
  z: number;
  r: number | Float64Array;
}

export interface InsertSurfaceIssue {
  code: string;
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface RZ {
  r: number;
  z: number;
}

export interface InsertSurface {
  style: LampInsertStyle;
  /** "closed": lazo de anillos (extremo superior abierto). "poles": perfil que arranca y termina en el eje (extremo cerrado). */
  mode: "closed" | "poles";
  segments: number;
  rows: InsertRow[];
  closedTop: boolean;
  topZ: number;
  /** Z del plano inferior de la tapa / del ápice interior (null con extremo abierto). */
  innerTopZ: number | null;
  /** Radio exterior máximo del cuerpo (sin lengüetas) y con lengüetas. */
  bodyMaxR: number;
  tabMaxR: number;
  tabLengthMm: number;
  /** Radio interior mínimo y, por fila, el radio interior mínimo (para medir la distancia a la bombilla). */
  minInnerR: number;
  innerPoints: RZ[];
  /** Pendiente máxima de la pared respecto de la vertical (grados) y, en la gota, donde empieza el arco de la punta. */
  maxLeanDeg: number;
  tipArcStartLeanDeg: number | null;
  /** Gota: altura de la sección cilíndrica y del cierre. */
  cylinderHeightMm: number;
  closureHeightMm: number;
  /** Contornos (r, z) de abajo hacia arriba: exterior (máximo sobre las columnas), valle (mínimo) e interior. */
  outline: { crest: RZ[]; valley: RZ[]; inner: RZ[] };
  issues: InsertSurfaceIssue[];
  /** false si hay errores de construcción: no hay filas utilizables. */
  valid: boolean;
}

const DEG = 180 / Math.PI;
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

const CACHE_LIMIT = 6;
const cache = new Map<string, InsertSurface>();

export function buildInsertSurface(input: InsertSurfaceInput): InsertSurface {
  const key = JSON.stringify(input);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const built = input.style === "drop" ? buildDrop(input) : buildWavyOrFlat(input);
  cache.set(key, built);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return built;
}

function emptySurface(input: InsertSurfaceInput, issues: InsertSurfaceIssue[]): InsertSurface {
  const Ro = input.outerR;
  return {
    style: input.style,
    mode: "poles",
    segments: 0,
    rows: [],
    closedTop: true,
    topZ: input.z0 + input.heightMm,
    innerTopZ: input.z0 + input.heightMm - input.capThicknessMm,
    bodyMaxR: Ro,
    tabMaxR: Ro,
    tabLengthMm: 0,
    minInnerR: Ro - input.thicknessMm,
    innerPoints: [],
    maxLeanDeg: 0,
    tipArcStartLeanDeg: null,
    cylinderHeightMm: input.heightMm,
    closureHeightMm: 0,
    outline: { crest: [], valley: [], inner: [] },
    issues,
    valid: false,
  };
}

// ------------------------------------------------------------------------------------------------ plano / ondulado

function buildWavyOrFlat(input: InsertSurfaceInput): InsertSurface {
  const g = LAMP_GEOMETRY;
  const issues: InsertSurfaceIssue[] = [];
  const flat = input.style === "flat";
  const Ro = input.outerR;
  const Rf = Math.min(input.fitOuterR, Ro);
  const flareTan = Math.tan((g.diffuserFlareDeg * Math.PI) / 180);
  const flareH = (Ro - Rf) / flareTan;
  const t = input.thicknessMm;
  const { z0 } = input;
  const ztop = z0 + input.heightMm;
  const n = Math.round(input.wavy.waves);
  const A = flat ? 0 : Math.max(0, input.wavy.amplitudeMm);
  const twist = flat ? 0 : (input.wavy.twistDeg * Math.PI) / 180;
  const vfreq = flat ? 0 : input.wavy.verticalFrequency;
  const closedTop = flat || input.wavy.top === "flat";
  const tabsOn = !closedTop && input.tabs;
  const tc = input.capThicknessMm;

  const zm = Math.min(z0 + input.seatDepthMm + g.insertMountExtraMm, ztop);
  /** Fin de la transición cónica: desde acá el cuerpo tiene su radio y empiezan las ondas. */
  const zb = Math.min(zm + flareH, ztop);
  const zone = Math.max(ztop - zb, 1);
  const ramp = Math.min(g.insertWaveRampMm, zone * 0.5);

  /** Radio del perfil de revolución (sin ondas): encastre estándar recto, transición de 45° y cuerpo. */
  const baseAt = (z: number): number => (z <= zm ? Rf : flareH <= 0 || z >= zm + flareH ? Ro : Rf + (z - zm) * flareTan);
  /** Radio exterior en (theta, z): perfil de revolución y ondas que solo suman hacia afuera. */
  const outerAt = (theta: number, z: number): number => {
    if (A <= 0 || z <= zb) return baseAt(z);
    const e = smooth((z - zb) / ramp);
    const u = Math.min(1, Math.max(0, (z - zb) / zone));
    const m = vfreq > 0 ? 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(2 * Math.PI * vfreq * u)) : 1;
    const w = 0.5 + 0.5 * Math.cos(n * (theta - twist * u));
    return baseAt(z) + A * e * m * w;
  };
  /** Espesor medido sobre la NORMAL: el desfase radial crece con la pendiente de la pared (la mayor de las dos laderas en un quiebre). */
  const slopeAt = (theta: number, z: number): number => {
    if (A <= 0 && flareH <= 0) return 0;
    const h = 0.04;
    const fwd = (outerAt(theta, z + h) - outerAt(theta, z)) / h;
    const bwd = (outerAt(theta, z) - outerAt(theta, Math.max(z - h, 0))) / h;
    const dz = Math.abs(fwd) >= Math.abs(bwd) ? fwd : bwd;
    const dth = A > 0 ? (outerAt(theta + 0.002, z) - outerAt(theta - 0.002, z)) / 0.004 / outerAt(theta, z) : 0;
    return Math.hypot(dz, dth);
  };
  /** Desfase vertical entre las esquinas de la cara exterior y de la interior en la transición (espesor constante sobre la normal). */
  const flareK = Math.sqrt(1 + flareTan * flareTan);
  const flareOff = flareH > 0 ? (t * (flareK - 1)) / flareTan : 0;
  const innerAt = (theta: number, z: number): number => {
    if (flareH > 0 && z <= zb + flareOff + 1e-9) {
      // encastre recto (pared vertical de espesor t) y cono paralelo al exterior; las esquinas interiores están desfasadas en flareOff
      if (z <= zm + flareOff) return Rf - t;
      return Math.min(Ro - t, Rf + (z - zm) * flareTan - t * flareK) + (outerAt(theta, z) - baseAt(z));
    }
    return outerAt(theta, z) - t * Math.sqrt(1 + slopeAt(theta, z) ** 2);
  };

  // Columnas
  const segments = A > 0 ? Math.min(512, Math.max(144, Math.ceil((16 * n) / 4) * 4)) : 144;
  const theta = (j: number) => (2 * Math.PI * j) / segments;

  // Filas en z
  const zs: number[] = [z0];
  // Quiebres del perfil de revolución: fin del encastre recto y fin de la transición cónica (filas exactas, no interpoladas).
  const breaks: number[] = [];
  if (flareH > 0) {
    if (zm > z0 + 1e-6 && zm < ztop - 1e-6) breaks.push(zm);
    if (zb > z0 + 1e-6 && zb < ztop - 1e-6) breaks.push(zb);
  }
  if (A > 0) {
    const twistRateRadPerMm = (n * Math.abs(twist)) / zone;
    const vfreqRateRadPerMm = (2 * Math.PI * vfreq) / zone;
    let dz = 2;
    if (twistRateRadPerMm > 0) dz = Math.min(dz, Math.PI / 6 / twistRateRadPerMm);
    if (vfreqRateRadPerMm > 0) dz = Math.min(dz, Math.PI / 8 / vfreqRateRadPerMm);
    dz = Math.max(dz, 0.4);
    const zEnd0 = tabsOn ? ztop - g.tabThicknessMm - g.tabGussetMm : ztop;
    if (zm > z0 + 1e-6) zs.push(zm);
    if (flareH > 0 && zb > zm + 1e-6) zs.push(zb);
    const zWave0 = Math.max(zb, zm);
    let rows = Math.ceil((zEnd0 - zWave0) / dz);
    if (rows > 480) {
      rows = 480;
      issues.push({ code: "INSERT_WAVE_COARSE", field: "insert.twistDeg", severity: "warning", message: "La torsión o la frecuencia vertical son muy fuertes para la resolución de la malla del inserto: las ondas pueden verse facetadas. Reducilas." });
    }
    for (let k = 1; k <= rows; k++) zs.push(zWave0 + ((zEnd0 - zWave0) * k) / rows);
  } else {
    const zEnd0 = tabsOn ? ztop - g.tabThicknessMm - g.tabGussetMm : ztop;
    for (const b of breaks) if (b < zEnd0 - 1e-6) zs.push(b);
    if (zEnd0 - z0 > 1e-6) zs.push(zEnd0);
  }
  const zsClean = [...zs].sort((a, b) => a - b).filter((z, i, arr) => i === 0 || z - arr[i - 1] > 1e-6);
  // La cara interior tiene sus propias esquinas (desfasadas flareOff de las exteriores): filas extra solo para la cadena interior.
  const zEndIn = (tabsOn ? ztop - g.tabThicknessMm - g.tabGussetMm : ztop) - 1e-6;
  const zsInner = flareH > 0
    ? [...zsClean, ...[zm + flareOff, zb + flareOff].filter((z) => z > z0 + 1e-6 && z < zEndIn)].sort((a, b) => a - b).filter((z, i, arr) => i === 0 || z - arr[i - 1] > 1e-6)
    : zsClean;

  const rowOf = (fn: (th: number, z: number) => number, z: number, extra?: (j: number) => number): Float64Array => {
    const a = new Float64Array(segments);
    for (let j = 0; j < segments; j++) a[j] = fn(theta(j), z) + (extra ? extra(j) : 0);
    return a;
  };
  const constant = (a: Float64Array) => a.every((v) => Math.abs(v - a[0]) < 1e-12);
  const asRow = (z: number, a: Float64Array): InsertRow => ({ z, r: constant(a) ? a[0] : a });

  // Lengüetas: radio extra en las columnas de 90° y 270°
  const tabLen = tabsOn ? g.tabLengthMm : 0;
  const halfArc = g.tabArcMm / 2 / Ro;
  const tabMask = (j: number): number => {
    if (!tabsOn) return 0;
    const th = theta(j);
    for (const c of [Math.PI / 2, (3 * Math.PI) / 2]) {
      const d = Math.abs(((th - c + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
      if (d <= halfArc) return tabLen;
    }
    return 0;
  };

  // Cadena exterior (de abajo hacia arriba) e interior (de arriba hacia abajo)
  const outerChain: InsertRow[] = zsClean.map((z) => asRow(z, rowOf(outerAt, z)));
  if (tabsOn) {
    const zB = ztop - g.tabThicknessMm;
    outerChain.push(asRow(zB, rowOf(outerAt, zB, tabMask)));
    outerChain.push(asRow(ztop, rowOf(outerAt, ztop, tabMask)));
  } else if (zsClean[zsClean.length - 1] < ztop - 1e-6) {
    outerChain.push(asRow(ztop, rowOf(outerAt, ztop)));
  }

  let rows: InsertRow[];
  let innerTopZ: number | null = null;
  const innerPoints: RZ[] = [];
  const minRow = (a: number | Float64Array) => (typeof a === "number" ? a : a.reduce((m, v) => Math.min(m, v), Infinity));
  if (closedTop) {
    const topInner = ztop - tc;
    innerTopZ = topInner;
    const innerZs = [topInner, ...zsInner.filter((z) => z < topInner - 1e-6).reverse()];
    const innerChain = innerZs.map((z) => asRow(z, rowOf(innerAt, z)));
    for (const r of innerChain) innerPoints.push({ r: minRow(r.r), z: r.z });
    innerPoints.push({ r: 0, z: topInner });
    rows = [{ z: topInner, r: 0 }, ...innerChain, ...outerChain, { z: ztop, r: 0 }];
  } else {
    const innerZs = [...(tabsOn ? [ztop] : []), ...[...zsInner].reverse()];
    const innerChain = innerZs.map((z) => asRow(z, rowOf(innerAt, z)));
    for (const r of innerChain) innerPoints.push({ r: minRow(r.r), z: r.z });
    rows = [...outerChain, ...innerChain];
  }

  // Métricas sobre la grilla real
  let bodyMaxR = Rf;
  let tabMaxR = Rf;
  let minInnerR = Rf - t;
  let maxSlopeZ = 0;
  let minCrestRho = Infinity;
  const crest: RZ[] = [];
  const valley: RZ[] = [];
  const innerOutline: RZ[] = [];
  for (const row of outerChain) {
    const a = row.r;
    const hi = typeof a === "number" ? a : a.reduce((m, v) => Math.max(m, v), -Infinity);
    const lo = typeof a === "number" ? a : a.reduce((m, v) => Math.min(m, v), Infinity);
    tabMaxR = Math.max(tabMaxR, hi);
    crest.push({ r: hi, z: row.z });
    valley.push({ r: lo, z: row.z });
  }
  for (const z of zsClean) {
    let rowMax = -Infinity;
    for (let j = 0; j < segments; j += 1) {
      const th = theta(j);
      const o = outerAt(th, z);
      rowMax = Math.max(rowMax, o);
      const h = 0.04;
      if ((A > 0 || flareH > 0) && z > zm) maxSlopeZ = Math.max(maxSlopeZ, Math.abs((outerAt(th, z + h) - outerAt(th, z - h)) / (2 * h)));
    }
    bodyMaxR = Math.max(bodyMaxR, rowMax);
    minInnerR = Math.min(minInnerR, minRow(rowOf(innerAt, z)));
    innerOutline.push({ r: minRow(rowOf(innerAt, z)), z });
    if (A > 0 && z > zb) {
      const arr = rowOf(outerAt, z);
      const dth = (2 * Math.PI) / segments;
      for (let j = 0; j < segments; j++) {
        const rm = arr[(j + segments - 1) % segments], r0 = arr[j], rp = arr[(j + 1) % segments];
        const d1 = (rp - rm) / (2 * dth), d2 = (rp - 2 * r0 + rm) / (dth * dth);
        const kappa = (r0 * r0 + 2 * d1 * d1 - r0 * d2) / Math.pow(r0 * r0 + d1 * d1, 1.5);
        if (kappa > 1e-9) minCrestRho = Math.min(minCrestRho, 1 / kappa);
      }
    }
  }
  const maxLeanDeg = Math.atan(maxSlopeZ) * DEG;

  if (A > 0 || flareH > 0) {
    if (minCrestRho < g.insertCrestRadiusFactor * t) {
      issues.push({ code: "INSERT_WAVE_CREST_SHARP", field: "insert.amplitudeMm", severity: "error", message: `Las crestas del inserto ondulado son demasiado agudas (radio de curvatura ${fmt(minCrestRho)} mm; hace falta al menos ${fmt(g.insertCrestRadiusFactor * t)} mm con un espesor de ${fmt(t)} mm): la pared se plegaría sobre sí misma. Reducí la amplitud o las ondas, o aumentá el espesor.` });
    }
    if (maxLeanDeg > g.hardMaxTiltDeg + 1e-6) {
      issues.push({ code: "INSERT_WAVE_TOO_STEEP", field: "insert.twistDeg", severity: "error", message: `La pared del inserto ondulado se inclina ${fmt(maxLeanDeg)}° respecto de la vertical: no es imprimible (máximo ${g.hardMaxTiltDeg}°). Reducí la torsión, la frecuencia vertical o la amplitud.` });
    } else if (maxLeanDeg > g.dropLeanWarnDeg + 1e-6) {
      issues.push({ code: "INSERT_WAVE_STEEP", field: "insert.twistDeg", severity: "warning", message: `La pared del inserto ondulado se inclina hasta ${fmt(maxLeanDeg)}° respecto de la vertical: puede necesitar soportes o salir con la superficie áspera. Reducí la torsión o la amplitud para imprimirlo sin soportes.` });
    }
  }

  return {
    style: input.style,
    mode: closedTop ? "poles" : "closed",
    segments,
    rows,
    closedTop,
    topZ: ztop,
    innerTopZ,
    bodyMaxR,
    tabMaxR,
    tabLengthMm: tabLen,
    minInnerR,
    innerPoints,
    maxLeanDeg,
    tipArcStartLeanDeg: null,
    cylinderHeightMm: input.heightMm,
    closureHeightMm: 0,
    outline: { crest, valley, inner: innerOutline },
    issues,
    valid: !issues.some((i) => i.severity === "error"),
  };
}

// ------------------------------------------------------------------------------------------------ gota

function buildDrop(input: InsertSurfaceInput): InsertSurface {
  const g = LAMP_GEOMETRY;
  const issues: InsertSurfaceIssue[] = [];
  const Ro = input.outerR;
  const Rf = Math.min(input.fitOuterR, Ro);
  const flareTan = Math.tan((g.diffuserFlareDeg * Math.PI) / 180);
  const flareH = (Ro - Rf) / flareTan;
  const t = input.thicknessMm;
  const { z0 } = input;
  const H = input.heightMm;
  const ztop = z0 + H;
  const Hcl = input.drop.closureMm;
  const rho = input.drop.tipRadiusMm;
  const k = Math.min(1, Math.max(0, input.drop.curvaturePct / 100));
  const Hc = H - Hcl;
  const zb = z0 + Hc;
  const err = (code: string, field: string, message: string) => issues.push({ code, field, severity: "error", message });

  if (Hcl < g.dropMinClosureMm) err("INSERT_DROP_CLOSURE_SHORT", "insert.dropClosureMm", `El cierre de la gota mide ${fmt(Hcl)} mm: hace falta al menos ${fmt(g.dropMinClosureMm)} mm para que cierre de forma progresiva.`);
  const mountH = input.seatDepthMm + g.insertMountExtraMm;
  if (Hc < mountH + flareH) err("INSERT_DROP_CYLINDER_SHORT", "insert.dropClosureMm", `La sección cilíndrica de la gota mide ${fmt(Hc)} mm (altura total ${fmt(H)} mm − cierre ${fmt(Hcl)} mm) y debe cubrir la ranura de la torre (${fmt(input.seatDepthMm)} mm) más ${fmt(g.insertMountExtraMm)} mm de tubo liso${flareH > 0 ? ` y la transición de ${fmt(flareH)} mm hasta el cuerpo de Ø ${fmt(2 * Ro)} mm` : ""}. Subí la altura total o acortá el cierre.`);
  if (rho < t + 0.5) err("INSERT_DROP_TIP_THIN", "insert.dropTipRadiusMm", `El redondeo de la punta (${fmt(rho)} mm) es demasiado chico para un espesor de ${fmt(t)} mm: el interior de la punta se cerraría sobre sí mismo. Usá al menos ${fmt(t + 0.5)} mm.`);
  if (rho > Ro * 0.9) err("INSERT_DROP_TIP_TOO_WIDE", "insert.dropTipRadiusMm", `El redondeo de la punta (${fmt(rho)} mm) es casi tan grande como el radio del inserto (${fmt(Ro)} mm): no queda cierre cónico. Reducilo.`);
  if (Hcl < rho * 1.3) err("INSERT_DROP_CLOSURE_SHORT", "insert.dropClosureMm", `El cierre (${fmt(Hcl)} mm) no alcanza para una punta de ${fmt(rho)} mm de radio: alargá el cierre o reducí el redondeo.`);
  if (issues.length > 0) return emptySurface(input, issues);

  // Ángulo de tangencia de la punta: el arco de radio rho (centro sobre el eje) empalma con el cierre
  const zc = ztop - rho;
  let alpha = Math.atan2(Ro, Hcl);
  for (let i = 0; i < 60; i++) {
    const cx = Ro - rho * Math.cos(alpha);
    const cz = zc + rho * Math.sin(alpha) - zb;
    alpha = Math.atan2(cx, cz);
  }
  const p3: RZ = { r: rho * Math.cos(alpha), z: zc + rho * Math.sin(alpha) };
  const p0: RZ = { r: Ro, z: zb };
  const chord = { r: p3.r - p0.r, z: p3.z - p0.z };
  const d = Math.hypot(chord.r, chord.z);
  if (d < 1e-6 || p3.z <= zb || p3.r >= Ro) {
    err("INSERT_DROP_TIP_TOO_WIDE", "insert.dropTipRadiusMm", "Con estas medidas la punta no se puede empalmar con el cierre: reducí el redondeo o alargá el cierre.");
    return emptySurface(input, issues);
  }
  const uc = { r: chord.r / d, z: chord.z / d };
  let u0 = { r: (1 - k) * uc.r, z: (1 - k) * uc.z + k };
  const u0n = Math.hypot(u0.r, u0.z);
  u0 = { r: u0.r / u0n, z: u0.z / u0n };
  const t3 = { r: -Math.sin(alpha), z: Math.cos(alpha) };
  const h0 = d * (0.2 + 0.25 * k);
  const h3 = d * (0.3 - 0.1 * k);
  const P1: RZ = { r: p0.r + h0 * u0.r, z: p0.z + h0 * u0.z };
  const P2: RZ = { r: p3.r - h3 * t3.r, z: p3.z - h3 * t3.z };
  const bez = (s: number): RZ => {
    const a = (1 - s) ** 3, b = 3 * s * (1 - s) ** 2, c = 3 * s * s * (1 - s), e = s ** 3;
    return { r: a * p0.r + b * P1.r + c * P2.r + e * p3.r, z: a * p0.z + b * P1.z + c * P2.z + e * p3.z };
  };
  const dbez = (s: number): RZ => {
    const a = 3 * (1 - s) ** 2, b = 6 * s * (1 - s), c = 3 * s * s;
    return { r: a * (P1.r - p0.r) + b * (P2.r - P1.r) + c * (p3.r - P2.r), z: a * (P1.z - p0.z) + b * (P2.z - P1.z) + c * (p3.z - P2.z) };
  };

  const N = 56;
  const outerCurve: RZ[] = [];
  const innerCurve: RZ[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const pt = bez(s);
    const dv = dbez(s);
    const dn = Math.hypot(dv.r, dv.z) || 1;
    const tan = { r: dv.r / dn, z: dv.z / dn };
    const nOut = { r: tan.z, z: -tan.r };
    outerCurve.push(pt);
    innerCurve.push({ r: pt.r - t * nOut.r, z: pt.z - t * nOut.z });
  }
  // Monotonía del contorno exterior (sin retrocesos: imprimible y sin autointersecciones)
  let maxLean = 0;
  for (let i = 1; i < outerCurve.length; i++) {
    const dr = outerCurve[i].r - outerCurve[i - 1].r, dz = outerCurve[i].z - outerCurve[i - 1].z;
    if (dz < -1e-9 || dr > 1e-9) {
      err("INSERT_DROP_PROFILE_INVALID", "insert.dropCurvaturePct", "Con estos valores el contorno del cierre se pliega sobre sí mismo. Reducí la curvatura o alargá el cierre.");
      return emptySurface(input, issues);
    }
    maxLean = Math.max(maxLean, Math.atan2(Math.abs(dr), Math.max(dz, 1e-9)) * DEG);
  }

  // Unión interior entre el cilindro interior (r = Rn) y el desfase del cierre
  const Rn = Ro - t;
  let join = 0;
  while (join < innerCurve.length && innerCurve[join].r > Rn + 1e-9) join++;
  // Encastre estándar recto + transición cónica: el interior es el exterior desplazado `t` sobre la normal (en la transición, `t·√(1+tan²)` en radio).
  const zm = z0 + mountH;
  const offK = Math.sqrt(1 + flareTan * flareTan) - 1;
  const innerAsc: RZ[] = flareH > 0 ? [{ r: Rf - t, z: z0 }, { r: Rf - t, z: zm + (t * offK) / flareTan }, { r: Rn, z: zm + flareH + (t * offK) / flareTan }] : [{ r: Rn, z: z0 }];
  const closureStart = innerAsc.length - 1;
  if (join >= innerCurve.length) {
    err("INSERT_DROP_THIN_CURVE", "insert.dropCurvaturePct", "Con estos valores el interior del cierre no se puede trazar con el espesor pedido. Reducí el espesor o la curvatura.");
    return emptySurface(input, issues);
  }
  if (join === 0) innerAsc.push({ r: Rn, z: innerCurve[0].z });
  else {
    const a = innerCurve[join - 1], b = innerCurve[join];
    const f = (a.r - Rn) / (a.r - b.r || 1);
    innerAsc.push({ r: Rn, z: a.z + f * (b.z - a.z) });
  }
  for (let i = join; i < innerCurve.length; i++) innerAsc.push(innerCurve[i]);
  const M = 16;
  for (let m = 1; m <= M; m++) {
    const phi = alpha + ((Math.PI / 2 - alpha) * m) / M;
    const rr = (rho - t) * Math.cos(phi);
    innerAsc.push({ r: m === M ? 0 : rr, z: zc + (rho - t) * Math.sin(phi) });
  }
  for (let i = closureStart + 1; i < innerAsc.length; i++) {
    if (innerAsc[i].z < innerAsc[i - 1].z - 1e-7 || innerAsc[i].r > innerAsc[i - 1].r + 1e-7) {
      err("INSERT_DROP_THIN_CURVE", "insert.dropCurvaturePct", `El cierre es demasiado cerrado para un espesor de ${fmt(t)} mm (el interior se pliega). Reducí el espesor, la curvatura o el redondeo de la punta, o alargá el cierre.`);
      return emptySurface(input, issues);
    }
  }

  const outerAsc: RZ[] = flareH > 0 ? [{ r: Rf, z: z0 }, { r: Rf, z: zm }, { r: Ro, z: zm + flareH }, ...outerCurve] : [{ r: Ro, z: z0 }, ...outerCurve];
  for (let m = 1; m <= M; m++) {
    const phi = alpha + ((Math.PI / 2 - alpha) * m) / M;
    outerAsc.push({ r: m === M ? 0 : rho * Math.cos(phi), z: zc + rho * Math.sin(phi) });
  }
  const dedupe = (pts: RZ[]) => pts.filter((p, i) => i === 0 || Math.hypot(p.r - pts[i - 1].r, p.z - pts[i - 1].z) > 1e-6);
  const innerPts = dedupe(innerAsc);
  const outerPts = dedupe(outerAsc);
  const rows: InsertRow[] = [...innerPts].reverse().concat(outerPts).map((p) => ({ z: p.z, r: p.r }));

  const alphaDeg = alpha * DEG;
  if (alphaDeg > g.hardMaxTiltDeg) {
    issues.push({ code: "INSERT_DROP_TOO_STEEP", field: "insert.dropClosureMm", severity: "error", message: `El cierre de la gota se inclina ${fmt(alphaDeg)}° respecto de la vertical donde empieza la punta: no es imprimible (máximo ${g.hardMaxTiltDeg}°). Alargá el cierre o reducí el redondeo de la punta.` });
  } else if (alphaDeg > g.dropLeanWarnDeg) {
    issues.push({ code: "INSERT_DROP_STEEP", field: "insert.dropClosureMm", severity: "warning", message: `El cierre de la gota se inclina ${fmt(alphaDeg)}° respecto de la vertical hacia la punta (límite práctico ${g.dropLeanWarnDeg}° sin soportes): la punta puede salir áspera o necesitar soportes. Alargá el cierre para imprimirla sin soportes.` });
  }

  return {
    style: "drop",
    mode: "poles",
    segments: 144,
    rows,
    closedTop: true,
    topZ: ztop,
    innerTopZ: ztop - t,
    bodyMaxR: Ro,
    tabMaxR: Ro,
    tabLengthMm: 0,
    minInnerR: Math.min(Rn, Rf - t),
    innerPoints: innerPts.map((p) => ({ r: p.r, z: p.z })),
    maxLeanDeg: Math.max(maxLean, alphaDeg, flareH > 0 ? g.diffuserFlareDeg : 0),
    tipArcStartLeanDeg: alphaDeg,
    cylinderHeightMm: Hc,
    closureHeightMm: Hcl,
    outline: { crest: outerPts, valley: outerPts, inner: innerPts },
    issues,
    valid: !issues.some((i) => i.severity === "error"),
  };
}

/**
 * Distancia GEOMÉTRICA mínima entre la cara interior del inserto (cierre incluido) y la envolvente de la bombilla y del
 * portalámparas, modeladas como cilindros: la bombilla desde la mesa hasta su extremo (conservador: no usa su forma
 * redondeada) y el cuerpo del portalámparas hasta su borde superior. NO es una distancia térmicamente segura.
 */
export function insertEnvelopeGap(surface: InsertSurface, env: { bodyR: number; holderTopZ: number; bulbR: number; bulbTopZ: number }): number {
  let gap = Infinity;
  for (const p of surface.innerPoints) {
    const dBulb = Math.hypot(Math.max(0, p.r - env.bulbR), Math.max(0, p.z - env.bulbTopZ));
    const dBody = Math.hypot(Math.max(0, p.r - env.bodyR), Math.max(0, p.z - env.holderTopZ));
    gap = Math.min(gap, dBulb, dBody);
  }
  return gap;
}
