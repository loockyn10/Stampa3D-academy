import { createSilhouette } from "@/lib/maker/lamps/openwork/silhouette";

/**
 * EXPERIMENTO V4 — pantalla de DOBLE PARED (aislado: no forma parte de `LampDefinition`, de la UI ni del catálogo).
 *
 * Dos superficies independientes, concéntricas y de siluetas distintas:
 *  - pared EXTERIOR: abombada (silueta del motor compartido `createSilhouette`) con estrías verticales;
 *  - pared INTERIOR: de revolución, en reloj de arena (misma función de silueta con cintura).
 * Entre ambas queda una cámara de aire cuya separación mínima se MIDE sobre las superficies reales (estrías incluidas).
 */
export type DoubleWallStrategy = "vase-c" | "conventional";

export interface OuterWallParams {
  /** Diámetro máximo de las crestas de las estrías (mm). */
  maxDiameterMm: number;
  /** Diámetro de las crestas en el borde inferior y superior (mm). */
  endDiameterMm: number;
  bulgePositionPct: number;
  curvaturePct: number;
  /** Cantidad de estrías, profundidad cresta–valle (mm) y torsión total (grados). */
  flutes: number;
  fluteAmplitudeMm: number;
  twistDeg: number;
}

export interface InnerWallParams {
  /** Diámetro (cara que mira a la cámara) en los bordes inferior y superior (mm). */
  endDiameterMm: number;
  /** 0-100: intensidad de la cintura y posición relativa de la cintura. */
  waistPct: number;
  waistPositionPct: number;
  curvaturePct: number;
}

export interface DoubleWallParams {
  heightMm: number;
  /** Espesor del MODELO de cada pared (y de los flancos de unión). En modo jarrón el laminador imprime una sola línea sobre el contorno. */
  wallMm: number;
  /** Separación mínima exigida entre la cara de la pared exterior que mira a la cámara y la de la interior (mm). */
  minGapMm: number;
  outer: OuterWallParams;
  inner: InnerWallParams;
  /** Prototipo A: ancho de la abertura vertical posterior (mm). */
  slitMm: number;
  /** Prototipo B: cantidad y espesor de los nervios radiales de unión. */
  ribs: number;
  ribMm: number;
  /** Resolución: muestras por estría, segmentos de la pared interior y altura de cada fila (mm). */
  samplesPerFlute: number;
  innerSegments: number;
  rowMm: number;
}

/**
 * Valores de referencia del sprint. Dos de ellos NO estaban en el pedido y se eligieron para que la separación de 20 mm sea
 * alcanzable (documentado en el informe): diámetro de los bordes de la pared exterior (110 mm) y de la interior (56 mm).
 */
export const DEFAULT_DOUBLE_WALL: DoubleWallParams = {
  heightMm: 120,
  wallMm: 1.2,
  minGapMm: 20,
  outer: { maxDiameterMm: 140, endDiameterMm: 110, bulgePositionPct: 50, curvaturePct: 40, flutes: 24, fluteAmplitudeMm: 3, twistDeg: 0 },
  inner: { endDiameterMm: 60, waistPct: 60, waistPositionPct: 50, curvaturePct: 30 },
  slitMm: 2,
  ribs: 4,
  ribMm: 1.2,
  samplesPerFlute: 12,
  innerSegments: 120,
  rowMm: 2,
};

const TAU = Math.PI * 2;

/** Superficies de ambas paredes a una altura z (0..H). Todos los radios en mm. */
export interface WallSurfaces {
  z: number;
  /** Cara exterior de la pared exterior (visible) y su cara interior (mira a la cámara), en función del ángulo. */
  ro: (theta: number) => number;
  roi: (theta: number) => number;
  /** Cara de la pared interior que mira a la cámara (radio) y la que mira al vacío central. */
  rio: number;
  rii: number;
  /** Radio de las crestas a esta altura (silueta). */
  crest: number;
}

export function createDoubleWallSurfaces(p: DoubleWallParams): (z: number) => WallSurfaces {
  const H = p.heightMm;
  const t = p.wallMm;
  const o = p.outer;
  const outerSil = createSilhouette({ bottomDiameterMm: o.endDiameterMm, topDiameterMm: o.endDiameterMm, maxDiameterMm: o.maxDiameterMm, bulgePositionPct: o.bulgePositionPct, curvaturePct: o.curvaturePct, waistPct: 0, organicPct: 0, seed: 0 });
  const i = p.inner;
  const innerSil = createSilhouette({ bottomDiameterMm: i.endDiameterMm, topDiameterMm: i.endDiameterMm, maxDiameterMm: i.endDiameterMm, bulgePositionPct: i.waistPositionPct, curvaturePct: i.curvaturePct, waistPct: i.waistPct, organicPct: 0, seed: 0 });
  const h = H * 0.004;
  const twist = (o.twistDeg * Math.PI) / 180;
  const A = o.fluteAmplitudeMm;
  const n = o.flutes;
  return (z: number): WallSurfaces => {
    const u = Math.min(1, Math.max(0, z / H));
    const crest = outerSil(u);
    const crestZ = (outerSil(Math.min(1, u + h / H)) - outerSil(Math.max(0, u - h / H))) / (Math.min(1, u + h / H) * H - Math.max(0, u - h / H) * H);
    const tau = twist * u;
    const tauZ = twist / H;
    // r = crest − A/2 + (A/2)·cos(n(θ − τ))
    const ro = (theta: number) => crest - A / 2 + (A / 2) * Math.cos(n * (theta - tau));
    const roi = (theta: number) => {
      const phi = n * (theta - tau);
      const r = crest - A / 2 + (A / 2) * Math.cos(phi);
      const rTheta = -(A / 2) * n * Math.sin(phi);
      const rZ = crestZ + (A / 2) * n * tauZ * Math.sin(phi);
      const S = Math.sqrt(1 + (rTheta / r) ** 2 + rZ * rZ);
      return r - t * S;
    };
    const rio = innerSil(u);
    const rioZ = (innerSil(Math.min(1, u + h / H)) - innerSil(Math.max(0, u - h / H))) / (Math.min(1, u + h / H) * H - Math.max(0, u - h / H) * H);
    const rii = rio - t * Math.sqrt(1 + rioZ * rioZ);
    return { z, ro, roi, rio, rii, crest };
  };
}

/** Ángulo φ > 0 tal que un punto de la curva r(θ) a `φ` del eje `alpha` (hacia `sign`) está a distancia lateral `d` del plano que pasa por el eje. */
export function planeAngle(r: (theta: number) => number, alpha: number, d: number, sign: 1 | -1): number {
  let phi = Math.asin(Math.min(0.999, d / r(alpha)));
  for (let k = 0; k < 8; k++) phi = Math.asin(Math.min(0.999, d / r(alpha + sign * phi)));
  return phi;
}

export interface GapReport {
  /** Separación MÍNIMA medida entre la cara interior de la pared exterior (estrías incluidas) y la cara exterior de la interior (distancia euclídea 3D). */
  minGapMm: number;
  atZ: number;
  /** Separación radial mínima (horizontal), para comparar con la euclídea. */
  minRadialGapMm: number;
  /** Radio interior mínimo del vacío central (cara que mira al eje) y radio de la cintura. */
  minInnerVoidRadiusMm: number;
}

/** Distancia de un punto (r, z) a una polilínea (r, z): exacta para una superficie de revolución. */
function distanceToPolyline(r: number, z: number, poly: Float64Array): number {
  let best = Infinity;
  for (let k = 0; k + 3 < poly.length; k += 2) {
    const ax = poly[k], az = poly[k + 1], bx = poly[k + 2], bz = poly[k + 3];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let s = len2 > 0 ? ((r - ax) * dx + (z - az) * dz) / len2 : 0;
    s = Math.min(1, Math.max(0, s));
    best = Math.min(best, Math.hypot(r - (ax + s * dx), z - (az + s * dz)));
  }
  return best;
}

/**
 * Separación entre paredes sobre las superficies reales: para cada punto de la cara que mira a la cámara de la pared exterior
 * (todas las alturas y todo el ángulo, estrías incluidas) se mide la distancia euclídea a la cara de la interior. El mínimo
 * sobre todos los puntos de una superficie es la distancia mínima entre las dos superficies.
 */
export function measureChamberGap(p: DoubleWallParams, rows = 241): GapReport {
  const surf = createDoubleWallSurfaces(p);
  const poly = new Float64Array(rows * 2);
  for (let k = 0; k < rows; k++) {
    const z = (p.heightMm * k) / (rows - 1);
    poly[k * 2] = surf(z).rio;
    poly[k * 2 + 1] = z;
  }
  let min = Infinity, atZ = 0, minRadial = Infinity, minVoid = Infinity;
  const per = Math.max(24, p.outer.flutes * 8);
  for (let k = 0; k < rows; k++) {
    const z = (p.heightMm * k) / (rows - 1);
    const s = surf(z);
    minVoid = Math.min(minVoid, s.rii);
    for (let j = 0; j < per; j++) {
      // un período de la estría alcanza si no hay torsión; con torsión la fase cambia con z, así que se recorre toda la vuelta
      const theta = (TAU * j) / per;
      const r = s.roi(theta);
      minRadial = Math.min(minRadial, r - s.rio);
      const d = distanceToPolyline(r, z, poly);
      if (d < min) {
        min = d;
        atZ = z;
      }
    }
  }
  return { minGapMm: min, atZ, minRadialGapMm: minRadial, minInnerVoidRadiusMm: minVoid };
}

/** Radio de curvatura mínimo de las crestas/valles de la pared exterior (mm). Debe superar el espesor para que el desfase interior no se pliegue. */
export function minFluteCurvatureRadius(p: DoubleWallParams): number {
  const n = p.outer.flutes, A = p.outer.fluteAmplitudeMm;
  let min = Infinity;
  for (const z of [0, p.heightMm / 2, p.heightMm]) {
    const crest = createDoubleWallSurfaces(p)(z).crest;
    for (const phi of [0, Math.PI]) {
      const r = crest - A / 2 + (A / 2) * Math.cos(phi);
      const rThetaTheta = -(A / 2) * n * n * Math.cos(phi);
      const k = (r * r - r * rThetaTheta) / Math.pow(r * r, 1.5); // r_θ = 0 en crestas y valles
      if (k > 1e-9) min = Math.min(min, 1 / k);
    }
  }
  return min;
}
