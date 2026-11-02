import { createSilhouette, silhouetteInput } from "@/lib/maker/lamps/openwork/silhouette";
import type { ShadeField } from "@/lib/maker/lamps/shade/surface";
import { LAMP_GEOMETRY, type LampOpenworkDef, type LampShadeDef, type OpenworkReport } from "@/lib/maker/lamps/types";

/**
 * CAMPO de una pantalla calada. La superficie es una revolución (sección circular en cada altura) con el radio de la
 * silueta; el calado es un campo escalar f(θ, z) en milímetros sobre esa superficie:
 *
 *   f > 0  -> material (tira, anillo)        f <= 0 -> abertura real
 *
 * f es una DISTANCIA aproximada (mm) al borde de la tira: ancho/2 − distancia al eje de la tira más cercana. Las familias
 * de tiras (las dos diagonales del diamante, las bandas de la espiral, los anillos) se unen con un máximo suave: en los
 * cruces el campo es continuo, así que las tiras forman UN solo sólido conectado con rincones redondeados (no hay mallas
 * superpuestas que unir). Después el mallador corta la grilla exactamente por f = 0.
 *
 * Las tiras siguen líneas de fase constante φ(θ, z) = 2π·k:
 *   diamante  φ± = N·(θ − τ(s)) ± K(s)     K'(s) = N / (R(s)·tan α(s))    (α constante => los rombos conservan su forma)
 *   espiral   φ  = B·(θ − Θ(s))           Θ(s) = 2π·vueltas·g(s) + τ(s)
 * y la distancia en mm al eje se obtiene dividiendo la fase envuelta por el módulo del gradiente físico de φ.
 */
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const TAU = Math.PI * 2;

export interface OpenworkField extends ShadeField {
  /** Campo f (mm) por nodo, índice i·nTheta + j. Positivo = material. */
  f: Float64Array;
  /** Altura local (mm) y arco de la meridiana por fila, radio exterior/interior por fila. */
  rowR: Float64Array;
  rowRin: Float64Array;
  rowS: Float64Array;
  /** Filas donde terminan el anillo inferior y empieza el superior (índices). */
  latticeRowFrom: number;
  latticeRowTo: number;
  cellMm: number;
  coarse: boolean;
  report: OpenworkReport;
  /**
   * Radios interiores LIBRES de los anillos (cara interior de la estructura, no el exterior): el mínimo sobre las filas del anillo
   * inferior y del superior (con terminación abierta, la última fila) y el mínimo de TODA la pantalla. Es lo que dimensiona el difusor.
   */
  ringFree: { bottomR: number; topR: number; structureMinR: number };
  /** Clave y números de la grilla para el mallador. */
  columnsPerPeriod: number;
}

function smax(a: number, b: number, k: number): number {
  if (k <= 0) return Math.max(a, b);
  return 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k));
}

/** Diferencia de fase envuelta a [-π, π]. */
function wrap(phi: number): number {
  return phi - TAU * Math.round(phi / TAU);
}

export function openworkKey(shade: LampShadeDef, ow: LampOpenworkDef): string {
  return JSON.stringify([shade.heightMm, shade.bottomDiameterMm, shade.topDiameterMm, ow]);
}

export interface OpenworkSampleOptions {
  /** Celda mínima forzada (mm): miniaturas. */
  minCellMm?: number;
}

export function sampleOpenworkField(shade: LampShadeDef, ow: LampOpenworkDef, opts: OpenworkSampleOptions = {}): OpenworkField {
  const g = LAMP_GEOMETRY;
  const H = shade.heightMm;
  const R = createSilhouette(silhouetteInput(shade, ow));
  const period = ow.pattern === "diamond" ? Math.max(1, Math.round(ow.divisions)) : Math.max(1, Math.round(ow.bands));

  // ---- Radio máximo (para el tamaño de celda) y malla de filas/columnas
  let rMax = 0;
  for (let i = 0; i <= 64; i++) rMax = Math.max(rMax, R(i / 64));
  let cell = clamp(ow.stripWidthMm / g.openworkCellsPerStrip, g.openworkCellMinMm, g.openworkCellMaxMm);
  if (opts.minCellMm) cell = Math.max(cell, opts.minCellMm);
  const wanted = (c: number) => {
    const cols = Math.max(g.openworkMinColumns, (TAU * rMax) / c);
    const nTheta = period * Math.ceil(cols / period);
    const nRows = Math.ceil(H / c) + 1;
    return { nTheta, nRows };
  };
  let dims = wanted(cell);
  let coarse = false;
  // Presupuesto de celdas: si no entra, la celda crece (la geometría sigue siendo válida, el contorno de las tiras es más facetado).
  while (dims.nTheta * (dims.nRows - 1) > g.openworkMaxCells && cell < 6) {
    cell *= 1.06;
    dims = wanted(cell);
    coarse = true;
  }
  if (cell > ow.stripWidthMm / 2) coarse = true;
  const { nTheta, nRows } = dims;
  const dTheta = TAU / nTheta;
  const dz = H / (nRows - 1);

  // ---- Filas: radio, pendiente, arco, espesor normal
  const z = new Float64Array(nRows);
  const rowR = new Float64Array(nRows);
  const rowRin = new Float64Array(nRows);
  const rowS = new Float64Array(nRows);
  const arc = new Float64Array(nRows);
  for (let i = 0; i < nRows; i++) {
    z[i] = dz * i;
    rowR[i] = R(i / (nRows - 1));
  }
  let degenerate = false;
  let maxTilt = 0, worstZ = 0;
  let minOuter = Infinity, maxOuter = -Infinity, minInner = Infinity;
  const slope = new Float64Array(nRows);
  for (let i = 0; i < nRows; i++) {
    const a = Math.max(0, i - 1), b = Math.min(nRows - 1, i + 1);
    slope[i] = (rowR[b] - rowR[a]) / ((b - a) * dz);
    rowS[i] = Math.sqrt(1 + slope[i] * slope[i]);
    rowRin[i] = rowR[i] - ow.depthMm * rowS[i];
    const tilt = (Math.atan(Math.abs(slope[i])) * 180) / Math.PI;
    if (tilt > maxTilt) { maxTilt = tilt; worstZ = z[i]; }
    if (!Number.isFinite(rowR[i]) || rowR[i] <= 0 || rowRin[i] < 2 || rowRin[i] < 0.3 * rowR[i]) degenerate = true;
    minOuter = Math.min(minOuter, rowR[i]);
    maxOuter = Math.max(maxOuter, rowR[i]);
    minInner = Math.min(minInner, rowRin[i]);
    if (i > 0) arc[i] = arc[i - 1] + dz * 0.5 * (rowS[i] + rowS[i - 1]);
  }

  // ---- Fase: torsión general y patrón
  const twist = (ow.twistDeg * Math.PI) / 180;
  const phase0 = (ow.phaseDeg * Math.PI) / 180;
  const tanA0 = Math.tan((ow.inclinationDeg * Math.PI) / 180);
  const vAmp = clamp(ow.variationPct / 100, 0, 0.9);
  const cycles = ow.variationCycles;
  const hw = ow.stripWidthMm / 2;
  const fillet = Math.min(g.openworkFilletMm, 0.35 * ow.stripWidthMm);

  // derivadas de fase respecto del arco físico, por fila
  const Kz = new Float64Array(nRows); // diamante: K(z)
  const dKds = new Float64Array(nRows);
  const Theta = new Float64Array(nRows); // espiral: Θ(z)
  const dThetads = new Float64Array(nRows);
  const dTauds = new Float64Array(nRows);
  const spiralNorm = (() => {
    // g(u) = u + v·(1 − cos(2π c u))/(2π c) normalizado para conservar las vueltas totales
    if (cycles <= 0 || vAmp === 0) return 1;
    return 1 + vAmp * (1 - Math.cos(TAU * cycles)) / (TAU * cycles);
  })();
  for (let i = 0; i < nRows; i++) {
    const u = i / (nRows - 1);
    const mod = 1 + vAmp * Math.sin(TAU * cycles * u);
    // diamante: dK/ds = N / (R · tanα(s))
    dKds[i] = period / (rowR[i] * tanA0 * Math.max(0.1, mod));
    if (i > 0) Kz[i] = Kz[i - 1] + 0.5 * (dKds[i] * rowS[i] * dz + dKds[i - 1] * rowS[i - 1] * dz);
    // torsión lineal en u: τ(u) = twist·u  =>  dτ/ds = twist / (H·S)
    dTauds[i] = twist / (H * rowS[i]);
    // espiral: Θ(u) = 2π·T·g(u)/g(1) + τ(u)
    const gu = cycles > 0 && vAmp > 0 ? u + vAmp * (1 - Math.cos(TAU * cycles * u)) / (TAU * cycles) : u;
    const dg = (1 + vAmp * Math.sin(TAU * cycles * u)) / spiralNorm;
    Theta[i] = TAU * ow.turns * (gu / spiralNorm) + twist * u;
    dThetads[i] = (TAU * ow.turns * dg + twist) / (H * rowS[i]);
  }

  // ---- Campo f y estadísticas de las aberturas
  const f = new Float64Array(nRows * nTheta);
  const outer = new Float64Array(nRows * nTheta);
  const inner = new Float64Array(nRows * nTheta);
  const colAngle = new Float64Array(nTheta);
  for (let j = 0; j < nTheta; j++) colAngle[j] = dTheta * j;

  const bottomEnd = ow.bottomRingMm; // arco desde el borde inferior donde terminan el anillo inferior
  const hasTop = ow.topFinish === "ring";
  const topStart = arc[nRows - 1] - ow.topRingMm;
  const connectorCenters: number[] = [];
  if (ow.pattern === "spiral" && ow.connectors > 0) {
    const from = bottomEnd, to = hasTop ? topStart : arc[nRows - 1];
    for (let k = 1; k <= ow.connectors; k++) connectorCenters.push(from + ((to - from) * k) / (ow.connectors + 1));
  }

  let latticeRowFrom = nRows, latticeRowTo = -1;
  let minOpening = Infinity, maxOpening = 0;
  let maxLean = 0;
  let holeW = 0, totalW = 0;
  const rowOpenMin = new Float64Array(nRows);
  for (let i = 0; i < nRows; i++) {
    const s = arc[i];
    const R_i = rowR[i];
    const fb = bottomEnd - s; // anillo inferior: positivo por debajo de bottomEnd
    const ft = hasTop ? s - topStart : -1e3;
    let fConn = -1e3;
    for (const c of connectorCenters) fConn = Math.max(fConn, ow.connectorWidthMm / 2 - Math.abs(s - c));
    const inLattice = s > bottomEnd + fillet && (!hasTop || s < topStart - fillet);
    if (inLattice) { latticeRowFrom = Math.min(latticeRowFrom, i); latticeRowTo = Math.max(latticeRowTo, i); }

    const circ = period / R_i; // N/R: componente circunferencial del gradiente de fase
    let gradA = 0, gradB = 0; // módulos del gradiente de fase de cada familia (rad/mm)
    let phaseShift = 0;
    if (ow.pattern === "diamond") {
      const a = -period * dTauds[i] + dKds[i];
      const b = -period * dTauds[i] - dKds[i];
      gradA = Math.hypot(circ, a);
      gradB = Math.hypot(circ, b);
      phaseShift = -period * (twist * (i / (nRows - 1)));
    } else {
      const a = -period * dThetads[i];
      gradA = Math.hypot(circ, a);
      phaseShift = -period * Theta[i];
    }
    // inclinación de una tira respecto de la vertical (grados): la línea de fase constante avanza `|dφ/ds|/(N/R)` de arco
    // tangencial por cada unidad de arco meridiano; la meridiana aporta 1/S vertical y pendiente/S radial.
    const lean = (dphids: number) => {
      const tangential = Math.abs(dphids) / circ;
      const horiz = Math.hypot(slope[i] / rowS[i], tangential);
      return (Math.atan2(horiz, 1 / rowS[i]) * 180) / Math.PI;
    };
    if (inLattice) {
      if (ow.pattern === "diamond") {
        const a = -period * dTauds[i] + dKds[i];
        const b = -period * dTauds[i] - dKds[i];
        maxLean = Math.max(maxLean, lean(a), lean(b));
        const gap = Math.min((TAU / gradA) - ow.stripWidthMm, (TAU / gradB) - ow.stripWidthMm);
        rowOpenMin[i] = gap;
      } else {
        const a = -period * dThetads[i];
        maxLean = Math.max(maxLean, lean(a));
        rowOpenMin[i] = TAU / gradA - ow.stripWidthMm;
      }
      minOpening = Math.min(minOpening, rowOpenMin[i]);
      maxOpening = Math.max(maxOpening, rowOpenMin[i]);
    }

    for (let j = 0; j < nTheta; j++) {
      const th = colAngle[j];
      let v: number;
      if (ow.pattern === "diamond") {
        const base = period * th + phaseShift + phase0;
        const dA = hw - Math.abs(wrap(base + Kz[i])) / gradA;
        const dB = hw - Math.abs(wrap(base - Kz[i])) / gradB;
        v = smax(dA, dB, fillet);
      } else {
        v = hw - Math.abs(wrap(period * th + phaseShift + phase0)) / gradA;
      }
      if (connectorCenters.length) v = smax(v, fConn, fillet);
      v = smax(v, fb, fillet);
      if (hasTop) v = smax(v, ft, fillet);
      f[i * nTheta + j] = v;
      outer[i * nTheta + j] = R_i;
      inner[i * nTheta + j] = rowRin[i];
      if (inLattice) {
        const w = R_i;
        totalW += w;
        if (v <= 0) holeW += w;
      }
    }
  }
  if (latticeRowTo < latticeRowFrom) { latticeRowFrom = 0; latticeRowTo = 0; }
  if (!Number.isFinite(minOpening)) minOpening = 0;

  const minInnerByRow = new Float64Array(rowRin);

  // Rombos/bandas: lecturas para el panel
  const midRow = Math.round((latticeRowFrom + latticeRowTo) / 2);
  const diamondRows = ow.pattern === "diamond" ? Math.max(0, Math.round(((Kz[Math.min(nRows - 1, latticeRowTo)] - Kz[latticeRowFrom]) * 1) / Math.PI)) : null;
  const bandGapMm = ow.pattern === "spiral" ? Math.max(0, TAU / Math.hypot(period / rowR[midRow], period * dThetads[midRow]) - ow.stripWidthMm) : null;

  // ---- Presupuesto de triángulos: conteo exacto con las mismas reglas que el mallador (polígono recortado por piel + paredes)
  let latticeTriangles = 0;
  for (let i = 0; i < nRows - 1; i++) {
    for (let j = 0; j < nTheta; j++) {
      const a = f[i * nTheta + j] > 0, b = f[i * nTheta + (j + 1) % nTheta] > 0, c = f[(i + 1) * nTheta + (j + 1) % nTheta] > 0, d = f[(i + 1) * nTheta + j] > 0;
      const n = (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0) + (d ? 1 : 0);
      if (n === 4) latticeTriangles += 4;
      else if (n > 0) {
        const crossings = (a !== b ? 1 : 0) + (b !== c ? 1 : 0) + (c !== d ? 1 : 0) + (d !== a ? 1 : 0);
        const segments = crossings / 2;
        latticeTriangles += 2 * (n + crossings - 2) + 2 * segments;
      }
    }
  }

  const report: OpenworkReport = {
    pattern: ow.pattern,
    columns: nTheta,
    rows: nRows,
    cellMm: Math.round(cell * 100) / 100,
    coarse,
    aperturePct: totalW > 0 ? Math.round((1000 * holeW) / totalW) / 10 : 0,
    minOpeningMm: Math.round(minOpening * 10) / 10,
    maxOpeningMm: Math.round(maxOpening * 10) / 10,
    maxStripLeanDeg: Math.round(maxLean * 10) / 10,
    maxSurfaceTiltDeg: Math.round(maxTilt * 10) / 10,
    minDiameterMm: Math.round(2 * minOuter * 10) / 10,
    maxDiameterMm: Math.round(2 * maxOuter * 10) / 10,
    diamondsAround: ow.pattern === "diamond" ? period : null,
    diamondRows,
    bandGapMm: bandGapMm === null ? null : Math.round(bandGapMm * 10) / 10,
    latticeTriangles,
  };

  let bottomFree = Infinity, topFree = Infinity;
  for (let i = 0; i < nRows; i++) {
    if (arc[i] <= bottomEnd + 1e-9) bottomFree = Math.min(bottomFree, rowRin[i]);
    if (hasTop ? arc[i] >= topStart - 1e-9 : i === nRows - 1) topFree = Math.min(topFree, rowRin[i]);
  }
  if (!Number.isFinite(bottomFree)) bottomFree = rowRin[0];
  if (!Number.isFinite(topFree)) topFree = rowRin[nRows - 1];

  return {
    nTheta,
    nRows,
    heightMm: H,
    z,
    outer,
    inner,
    minInnerByRow,
    minOuterRadius: minOuter,
    maxOuterRadius: maxOuter,
    minInnerRadius: minInner,
    maxTiltDeg: maxTilt,
    worstTiltZ: worstZ,
    minRidgeRadiusMm: null,
    twistCellsPerRow: 0,
    degenerate,
    f,
    rowR,
    rowRin,
    rowS,
    latticeRowFrom,
    latticeRowTo,
    cellMm: cell,
    coarse,
    report,
    ringFree: { bottomR: bottomFree, topR: topFree, structureMinR: minInner },
    columnsPerPeriod: nTheta / period,
  };
}
