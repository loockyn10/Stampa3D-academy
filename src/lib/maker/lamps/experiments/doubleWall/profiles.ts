import { createSilhouette } from "@/lib/maker/lamps/openwork/silhouette";

/**
 * EXPERIMENTO V4/V4.1 — pantalla de DOBLE PARED (aislado: no forma parte de `LampDefinition`, de la UI ni del catálogo).
 *
 * Dos superficies independientes, concéntricas y de siluetas distintas:
 *  - pared EXTERIOR: abombada (silueta del motor compartido `createSilhouette`) con estrías verticales;
 *  - pared INTERIOR: de revolución, en reloj de arena (misma función de silueta con cintura).
 * Entre ambas queda una cámara de aire cuya separación mínima se MIDE sobre las superficies reales (estrías incluidas).
 *
 * V4.1 cierra los extremos (sin tapar la abertura central):
 *  - PISO: una unión anular maciza de `floorMm` conecta las dos paredes por abajo (apoya en la cama: sin voladizos).
 *  - TECHO: en los últimos `roofHeightMm` las dos paredes se inclinan una hacia la otra (la cara exterior hacia adentro, la interior
 *    hacia afuera) hasta que la cámara queda en `topGapMm`; no hay puente horizontal de 20 mm, solo caras inclinadas. En la
 *    estrategia convencional un cielorraso de `roofCapMm` cierra la cámara; en la de modo jarrón la ranura queda abierta (un cielorraso
 *    sería una superficie horizontal que rompe la espiral).
 * La abertura central (el vacío de la pared interior) nunca se reduce: el techo solo la ensancha.
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
  /** Espesor del MODELO de cada pared. En modo jarrón el laminador imprime una sola línea sobre el contorno. */
  wallMm: number;
  /** Separación mínima exigida entre la cara de la pared exterior que mira a la cámara y la de la interior, en la zona de paredes rectas (mm). */
  minGapMm: number;
  outer: OuterWallParams;
  inner: InnerWallParams;
  /** Prototipo A: ancho de la abertura vertical posterior (mm). */
  slitMm: number;
  /** Unión inferior: espesor del piso anular que conecta ambas paredes (mm). */
  floorMm: number;
  /** Unión superior: altura de la zona donde las paredes se inclinan una hacia la otra, grosor del cielorraso (solo convencional) y ancho final de la cámara (mm). */
  roofHeightMm: number;
  roofCapMm: number;
  topGapMm: number;
  /** Resolución: muestras por estría, segmentos de la pared interior y altura de cada fila (mm). */
  samplesPerFlute: number;
  innerSegments: number;
  rowMm: number;
}

/**
 * Valores de referencia. Tres no estaban en el pedido original y se eligieron para que la separación de 20 mm sea alcanzable
 * (documentado en el informe): diámetro de los bordes de la pared exterior (110 mm) y de la interior (60 mm), y la zona de techo.
 */
export const DEFAULT_DOUBLE_WALL: DoubleWallParams = {
  heightMm: 120,
  wallMm: 1.2,
  minGapMm: 20,
  outer: { maxDiameterMm: 140, endDiameterMm: 110, bulgePositionPct: 50, curvaturePct: 40, flutes: 24, fluteAmplitudeMm: 3, twistDeg: 0 },
  inner: { endDiameterMm: 60, waistPct: 60, waistPositionPct: 50, curvaturePct: 30 },
  slitMm: 2,
  floorMm: 2.4,
  roofHeightMm: 24,
  roofCapMm: 2.4,
  topGapMm: 1.2,
  samplesPerFlute: 12,
  innerSegments: 120,
  rowMm: 2,
};

const TAU = Math.PI * 2;

/** Alturas (mm) donde cambia la sección: tope del piso, arranque de las inclinaciones y cielorraso (= base de la tapa superior). */
export function doubleWallZones(p: DoubleWallParams): { floorTop: number; roofStart: number; ceiling: number } {
  const ceiling = p.heightMm - p.roofCapMm;
  return { floorTop: p.floorMm, roofStart: ceiling - p.roofHeightMm, ceiling };
}

/** Superficies de ambas paredes a una altura z (0..H). Todos los radios en mm. */
export interface WallSurfaces {
  z: number;
  /** Cara exterior de la pared exterior (visible) y su cara interior (mira a la cámara), en función del ángulo. */
  ro: (theta: number) => number;
  roi: (theta: number) => number;
  /** Cara de la pared interior que mira a la cámara (radio) y la que mira al vacío central. */
  rio: number;
  rii: number;
  /** Radio de las crestas a esta altura (silueta, sin el techo). */
  crest: number;
  /** 0 en las paredes rectas, 1 donde el techo terminó de inclinarse. */
  roof: number;
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
  const zones = doubleWallZones(p);

  const rawAt = (z: number) => {
    const u = Math.min(1, Math.max(0, z / H));
    const crest = outerSil(u);
    const lo = Math.max(0, u - h / H), hi = Math.min(1, u + h / H);
    const crestZ = (outerSil(hi) - outerSil(lo)) / ((hi - lo) * H);
    const rio = innerSil(u);
    const rioZ = (innerSil(hi) - innerSil(lo)) / ((hi - lo) * H);
    return { u, crest, crestZ, rio, rioZ };
  };
  const ro0 = (crest: number, theta: number, u: number) => crest - A / 2 + (A / 2) * Math.cos(n * (theta - twist * u));
  const roi0 = (crest: number, crestZ: number, theta: number, u: number) => {
    const phi = n * (theta - twist * u);
    const r = crest - A / 2 + (A / 2) * Math.cos(phi);
    const rTheta = -(A / 2) * n * Math.sin(phi);
    const rZ = crestZ + (A / 2) * n * (twist / H) * Math.sin(phi);
    return r - t * Math.sqrt(1 + (rTheta / r) ** 2 + rZ * rZ);
  };

  // Radio de encuentro del techo: punto medio entre la cara de la cámara de la pared exterior (a media estría) y la de la interior, donde arrancan las inclinaciones.
  const r0 = rawAt(zones.roofStart);
  const rm = (r0.crest - A / 2 - t + r0.rio) / 2;
  const hg = p.topGapMm / 2;
  const smooth = (x: number) => {
    const s = Math.min(1, Math.max(0, x));
    return s * s * (3 - 2 * s);
  };

  return (z: number): WallSurfaces => {
    const { u, crest, crestZ, rio, rioZ } = rawAt(z);
    const e = p.roofHeightMm > 0 ? smooth((z - zones.roofStart) / p.roofHeightMm) : 0;
    const rii0 = rio - t * Math.sqrt(1 + rioZ * rioZ);
    const lerp = (a: number, b: number) => a + (b - a) * e;
    return {
      z,
      crest,
      roof: e,
      ro: (theta) => lerp(ro0(crest, theta, u), rm + hg + t),
      roi: (theta) => lerp(roi0(crest, crestZ, theta, u), rm + hg),
      rio: lerp(rio, rm - hg),
      rii: lerp(rii0, rm - hg - t),
    };
  };
}

/** Ángulo φ > 0 tal que un punto de la curva r(θ) a `φ` del eje `alpha` (hacia `sign`) está a distancia lateral `d` del plano que pasa por el eje. */
export function planeAngle(r: (theta: number) => number, alpha: number, d: number, sign: 1 | -1): number {
  let phi = Math.asin(Math.min(0.999, d / r(alpha)));
  for (let k = 0; k < 8; k++) phi = Math.asin(Math.min(0.999, d / r(alpha + sign * phi)));
  return phi;
}

export interface GapReport {
  /** Separación MÍNIMA medida entre la cara interior de la pared exterior (estrías incluidas) y la cara exterior de la interior (distancia euclídea 3D), en la zona de paredes rectas (entre el piso y el arranque del techo). */
  minGapMm: number;
  atZ: number;
  /** Separación radial mínima (horizontal), para comparar con la euclídea. */
  minRadialGapMm: number;
  /** Radio interior mínimo del vacío central en TODA la altura (la abertura que debe conservarse), y el radio en el borde superior. */
  minInnerVoidRadiusMm: number;
  topInnerVoidRadiusMm: number;
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
 * (entre el piso y el arranque del techo, todo el ángulo, estrías incluidas) se mide la distancia euclídea 3D a la cara de la
 * interior. El mínimo sobre todos los puntos de una superficie es la distancia mínima entre las dos superficies. En el techo la
 * cámara se cierra a propósito: esa zona no se mide como separación.
 */
export function measureChamberGap(p: DoubleWallParams, rows = 241): GapReport {
  const surf = createDoubleWallSurfaces(p);
  const zones = doubleWallZones(p);
  const z0 = zones.floorTop, z1 = zones.roofStart;
  const poly = new Float64Array(rows * 2);
  for (let k = 0; k < rows; k++) {
    const z = z0 + ((z1 - z0) * k) / (rows - 1);
    poly[k * 2] = surf(z).rio;
    poly[k * 2 + 1] = z;
  }
  let min = Infinity, atZ = 0, minRadial = Infinity;
  const per = Math.max(24, p.outer.flutes * 8);
  for (let k = 0; k < rows; k++) {
    const z = z0 + ((z1 - z0) * k) / (rows - 1);
    const s = surf(z);
    for (let j = 0; j < per; j++) {
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
  let minVoid = Infinity;
  for (let k = 0; k <= 480; k++) minVoid = Math.min(minVoid, surf((p.heightMm * k) / 480).rii);
  return { minGapMm: min, atZ, minRadialGapMm: minRadial, minInnerVoidRadiusMm: minVoid, topInnerVoidRadiusMm: surf(p.heightMm).rii };
}

/** Radio de curvatura mínimo de las crestas de la pared exterior (mm). Debe superar el espesor para que el desfase interior no se pliegue. */
export function minFluteCurvatureRadius(p: DoubleWallParams): number {
  const n = p.outer.flutes, A = p.outer.fluteAmplitudeMm;
  let min = Infinity;
  const surf = createDoubleWallSurfaces(p);
  const top = doubleWallZones(p).roofStart;
  for (const z of [0, p.heightMm / 2, top]) {
    const crest = surf(Math.min(z, top)).crest;
    for (const phi of [0, Math.PI]) {
      const r = crest - A / 2 + (A / 2) * Math.cos(phi);
      const rThetaTheta = -(A / 2) * n * n * Math.cos(phi);
      const k = (r * r - r * rThetaTheta) / Math.pow(r * r, 1.5); // r_θ = 0 en crestas y valles
      if (k > 1e-9) min = Math.min(min, 1 / k);
    }
  }
  return min;
}

export interface LeanReport {
  /** Mayor inclinación (grados respecto de la vertical) de la cara exterior de la pared exterior, de la cara interior de la pared interior y de las caras de la cámara. */
  outerFaceDeg: number;
  innerFaceDeg: number;
  chamberFacesDeg: number;
  /** Mayor de todas. */
  maxDeg: number;
  /** Altura a la que ocurre. */
  atZ: number;
}

/**
 * Inclinaciones respecto de la vertical de todas las caras, muestreadas cada 0,25 mm de altura y 96 ángulos. Es el dato de los
 * voladizos: 0° = vertical; 45° es el límite orientativo de impresión sin soportes. NO es una garantía de impresión.
 */
export function measureLean(p: DoubleWallParams): LeanReport {
  const surf = createDoubleWallSurfaces(p);
  const dz = 0.25;
  const n = Math.round(p.heightMm / dz);
  const per = Math.max(96, p.outer.flutes * 4);
  let outer = 0, inner = 0, chamber = 0, at = 0;
  let prev = surf(0);
  for (let k = 1; k <= n; k++) {
    const z = k * dz;
    const s = surf(z);
    inner = Math.max(inner, Math.atan(Math.abs(s.rii - prev.rii) / dz));
    for (let j = 0; j < per; j++) {
      const th = (TAU * j) / per;
      const a = Math.atan(Math.abs(s.ro(th) - prev.ro(th)) / dz);
      if (a > outer) {
        outer = a;
        at = z;
      }
      chamber = Math.max(chamber, Math.atan(Math.abs(s.roi(th) - prev.roi(th)) / dz), Math.atan(Math.abs(s.rio - prev.rio) / dz));
    }
    prev = s;
  }
  const deg = (r: number) => (r * 180) / Math.PI;
  const maxRad = Math.max(outer, inner, chamber);
  return { outerFaceDeg: deg(outer), innerFaceDeg: deg(inner), chamberFacesDeg: deg(chamber), maxDeg: deg(maxRad), atZ: at };
}
