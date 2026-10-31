import { LAMP_GEOMETRY, type LampShadeDef } from "@/lib/maker/lamps/types";
import { smoothNoise } from "@/lib/maker/lamps/random";

/**
 * Superficie de la pantalla: radio exterior r(θ, z) de UNA sola función continua para las tres familias
 * (ondulada / espiral / orgánica). La familia solo decide qué términos están activos:
 *
 *   r(θ, z) = R(z) + A · E(z) · M(z) · cos(n·θ + φ(z))
 *
 *   R(z)  perfil base (recta / barril / cintura / campana / tulipán) + deriva orgánica
 *   E(z)  envolvente: 0 en el collar recto inferior, sube suave -> el collar es un círculo exacto
 *   M(z)  variación vertical de la amplitud (frecuencia vertical × intensidad del patrón)
 *   φ(z)  fase: torsión lineal (+ ondulación orgánica)
 *
 * Como r es una función de (θ, z) con r > 0, la pantalla es una estrella estrictamente radial por cada altura:
 * cada corte horizontal es UNA curva cerrada simple. Eso garantiza (a) cero autointersecciones y (b) un contorno
 * continuo por capa, que es el prerrequisito de la impresión en modo vaso.
 */

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface ShadeRow {
  radius: number;
  amp: number;
  phase: number;
}

/** Evaluador por fila: todo lo que depende solo de la altura se calcula una vez por z. */
export function createShadeRowEvaluator(shade: LampShadeDef): (z: number) => ShadeRow {
  const H = shade.heightMm;
  const c = shade.collarHeightMm;
  const R0 = shade.bottomDiameterMm / 2;
  const R1 = shade.topDiameterMm / 2;
  const Rm = (R0 + R1) / 2;
  const amount = shade.profileAmountPct / 100;
  const organic = shade.family === "organic" ? shade.organicPct / 100 : 0;
  const noiseR = smoothNoise(shade.seed, 0);
  const noiseA = smoothNoise(shade.seed, 1);
  const noiseP = smoothNoise(shade.seed, 2);
  const blend = Math.max(10, 0.15 * (H - c));
  const twist = (shade.twistDeg * Math.PI) / 180;
  const intensity = shade.patternIntensityPct / 100;
  const vf = shade.verticalFrequency;
  const psi = organic > 0 ? noiseP.at(0.37) * Math.PI : 0;

  return (z: number): ShadeRow => {
    if (z <= c) return { radius: R0, amp: 0, phase: 0 };
    const u = clamp((z - c) / (H - c), 0, 1);
    let base: number;
    switch (shade.profile) {
      case "barrel":
        base = R0 + (R1 - R0) * u + Math.sin(Math.PI * u) * Rm * 0.3 * amount;
        break;
      case "waist":
        base = R0 + (R1 - R0) * u - Math.sin(Math.PI * u) * Rm * 0.3 * amount;
        break;
      case "bell":
        base = R0 + (R1 - R0) * Math.pow(u, 1 + 2.5 * amount);
        break;
      case "tulip": {
        const s = u * u * (3 - 2 * u);
        base = R0 + (R1 - R0) * (u * (1 - amount) + s * amount);
        break;
      }
      default:
        base = R0 + (R1 - R0) * u;
    }
    let radius = base;
    let amp = shade.amplitudeMm * smoothstep(c, c + blend, z);
    let phase = twist * u;
    if (organic > 0) {
      radius += organic * Rm * 0.16 * noiseR.at(u) * smoothstep(0, 0.12, u);
      amp *= clamp(1 + 0.55 * organic * noiseA.at(u), 0.15, 2);
      phase += organic * 0.9 * noiseP.at(u);
    }
    amp *= 1 + intensity * (0.5 * (1 + Math.cos(2 * Math.PI * vf * u + psi)) - 1);
    return { radius, amp, phase };
  };
}

/** Radio exterior en un punto (θ en radianes, z local desde el borde inferior de la pantalla). */
export function shadeOuterRadius(shade: LampShadeDef, theta: number, z: number): number {
  const row = createShadeRowEvaluator(shade)(z);
  return row.radius + row.amp * Math.cos(shade.waves * theta + row.phase);
}

export interface ShadeResolution {
  nTheta: number;
  nRows: number;
}

/**
 * Resolución adaptativa: >= 12 muestras por onda (valles y crestas caen en vértices porque nTheta es múltiplo de
 * las ondas), filas suficientes para que la torsión no desplace más de ~2 celdas por fila y presupuesto máximo de
 * triángulos (no se genera una malla densa sin justificación).
 */
export function planShadeResolution(shade: LampShadeDef): ShadeResolution {
  const n = Math.max(2, Math.round(shade.waves));
  let perWave = clamp(Math.ceil(144 / n), 12, 72);
  if (n * perWave > 360) perWave = Math.max(8, Math.floor(360 / n));
  const nTheta = n * perWave;
  const rowsHeight = Math.ceil(shade.heightMm / 2) + 1;
  const rowsTwist = Math.ceil((Math.abs(shade.twistDeg) * nTheta) / 720) + 1;
  const rowsVertical = Math.ceil(shade.verticalFrequency * 16) + 1;
  const cap = Math.floor(LAMP_GEOMETRY.maxShadeTriangles / (4 * nTheta));
  const nRows = Math.min(cap, Math.max(40, rowsHeight, rowsTwist, rowsVertical));
  return { nTheta, nRows };
}

export interface ShadeField extends ShadeResolution {
  heightMm: number;
  /** z local de cada fila. */
  z: Float64Array;
  /** Radio exterior por (fila, columna): índice i·nTheta + j. */
  outer: Float64Array;
  /** Radio interior (la pared mide `wallMm` en la dirección NORMAL a la superficie). */
  inner: Float64Array;
  /** Mínimo sobre θ del radio interior por fila: espacio libre disponible para el inserto. */
  minInnerByRow: Float64Array;
  minOuterRadius: number;
  maxOuterRadius: number;
  minInnerRadius: number;
  /** Ángulo máximo de la pared respecto de la vertical (0° = vertical, 90° = plana) y la altura donde ocurre. */
  maxTiltDeg: number;
  worstTiltZ: number;
  /** Menor radio de curvatura de los tramos convexos de un corte horizontal (crestas). null si no hay. */
  minRidgeRadiusMm: number | null;
  /** Desplazamiento máximo de una cresta entre dos filas, en celdas angulares (calidad del muestreo de la torsión). */
  twistCellsPerRow: number;
  /** true si algún punto es no finito o el interior se acerca al eje / cruza al exterior. */
  degenerate: boolean;
}

/**
 * Muestrea el campo de radios y deriva, SOBRE LA MISMA GRILLA que se mallará, todo lo que la validación necesita:
 * pendiente, curvatura de crestas, espesor normal de pared y espacio libre por altura. Una sola pasada, cacheable.
 */
export function sampleShadeField(shade: LampShadeDef): ShadeField {
  const { nTheta, nRows } = planShadeResolution(shade);
  const H = shade.heightMm;
  const evalRow = createShadeRowEvaluator(shade);
  const n = shade.waves;
  const z = new Float64Array(nRows);
  const outer = new Float64Array(nRows * nTheta);
  const inner = new Float64Array(nRows * nTheta);
  const minInnerByRow = new Float64Array(nRows);
  const cosTable = new Float64Array(nTheta);
  const sinTable = new Float64Array(nTheta);
  for (let j = 0; j < nTheta; j++) {
    const t = (2 * Math.PI * j) / nTheta;
    cosTable[j] = Math.cos(n * t);
    sinTable[j] = Math.sin(n * t);
  }
  const phases = new Float64Array(nRows);
  for (let i = 0; i < nRows; i++) {
    z[i] = (H * i) / (nRows - 1);
    const row = evalRow(z[i]);
    phases[i] = row.phase;
    const cp = Math.cos(row.phase), sp = Math.sin(row.phase);
    for (let j = 0; j < nTheta; j++) {
      // cos(nθ + φ) = cos(nθ)cosφ − sin(nθ)sinφ
      outer[i * nTheta + j] = row.radius + row.amp * (cosTable[j] * cp - sinTable[j] * sp);
    }
  }

  const dTheta = (2 * Math.PI) / nTheta;
  const dz = H / (nRows - 1);
  let degenerate = false;
  let maxTilt = 0, worstZ = 0;
  let minRidge = Infinity;
  let minOuter = Infinity, maxOuter = -Infinity, minInner = Infinity;
  for (let i = 0; i < nRows; i++) {
    let rowMinInner = Infinity;
    const i0 = Math.max(0, i - 1), i1 = Math.min(nRows - 1, i + 1);
    for (let j = 0; j < nTheta; j++) {
      const r = outer[i * nTheta + j];
      const rp = outer[i * nTheta + ((j + 1) % nTheta)];
      const rm = outer[i * nTheta + ((j - 1 + nTheta) % nTheta)];
      const rTheta = (rp - rm) / (2 * dTheta);
      const rThetaTheta = (rp - 2 * r + rm) / (dTheta * dTheta);
      const rz = (outer[i1 * nTheta + j] - outer[i0 * nTheta + j]) / ((i1 - i0) * dz);
      const slope = rTheta / r;
      const S = Math.sqrt(1 + slope * slope + rz * rz);
      const tilt = (Math.asin(Math.min(1, Math.abs(rz) / S)) * 180) / Math.PI;
      if (tilt > maxTilt) { maxTilt = tilt; worstZ = z[i]; }
      const kappa = (r * r + 2 * rTheta * rTheta - r * rThetaTheta) / Math.pow(r * r + rTheta * rTheta, 1.5);
      if (kappa > 1e-9) minRidge = Math.min(minRidge, 1 / kappa);
      const radial = shade.wallMm * S;
      const rin = r - radial;
      inner[i * nTheta + j] = rin;
      if (!Number.isFinite(r) || !Number.isFinite(rin) || r <= 0 || rin <= 0.3 * r || rin < 2) degenerate = true;
      if (r < minOuter) minOuter = r;
      if (r > maxOuter) maxOuter = r;
      if (rin < rowMinInner) rowMinInner = rin;
    }
    minInnerByRow[i] = rowMinInner;
    if (rowMinInner < minInner) minInner = rowMinInner;
  }

  // Desplazamiento de una cresta entre filas = variación de fase / n, medido en celdas de θ.
  let twistCells = 0;
  for (let i = 1; i < nRows; i++) twistCells = Math.max(twistCells, (Math.abs(phases[i] - phases[i - 1]) / n / dTheta));

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
    minRidgeRadiusMm: Number.isFinite(minRidge) ? minRidge : null,
    twistCellsPerRow: twistCells,
    degenerate,
  };
}

/** Radio interior mínimo (sobre θ) entre dos alturas LOCALES de la pantalla. Fuera de la pantalla (z < 0) rige el collar. */
export function minInnerRadiusBetween(field: ShadeField, z0: number, z1: number): number {
  const a = Math.max(0, Math.min(z0, field.heightMm));
  const b = Math.max(0, Math.min(z1, field.heightMm));
  const step = field.heightMm / (field.nRows - 1);
  const i0 = Math.max(0, Math.floor(a / step - 1e-9));
  const i1 = Math.min(field.nRows - 1, Math.ceil(b / step + 1e-9));
  let m = Infinity;
  for (let i = i0; i <= i1; i++) m = Math.min(m, field.minInnerByRow[i]);
  return m;
}

/** Clave de cache: solo los campos que cambian la superficie (no el color ni nada del inserto/base). */
export function shadeKey(shade: LampShadeDef): string {
  return JSON.stringify(shade);
}
