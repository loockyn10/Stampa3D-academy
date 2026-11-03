import type { Point2D } from "@/lib/maker/types";
import type { SolidFeature } from "@/lib/maker/lamps/geometry/solid";
import {
  REFERENCE_PRESS,
  REFERENCE_THREAD_BASE2,
  REFERENCE_THREAD_V6,
  REFERENCE_V6_PLATE,
  threadDepthMm,
  threadHalfBaseMm,
  type ReferenceThread,
} from "@/lib/maker/lamps/holder/references";
import type { LampHolderMount } from "@/lib/maker/lamps/types";

/**
 * Sistemas de fijación del portalámparas E27 (todos probados por el usuario con sus portalámparas). Acá vive TODA la geometría propia de
 * cada sistema, como funciones puras que leen las cotas MEDIDAS de los STL de referencia (`references.ts`); `layout.ts` decide dónde va
 * cada uno y `baseFeatures.ts` / `createBase.ts` lo aplican a la base. Orientación: la de la lámpara armada (z hacia arriba, base sobre la
 * mesa); los STL de referencia están en su propia orientación de impresión y por eso la cara de entrada del portalámparas es una cota
 * MEDIDA desde esa cara (`nearApexDepthMm`, `deepApexDepthMm`), no una coordenada del STL.
 */

export const MOUNT_LABELS: Record<LampHolderMount, string> = {
  rings: "Doble anillo",
  press: "A presión",
  threadBase2: "Rosca hembra A",
  threadV6: "Rosca hembra B con patas",
};

export const THREAD_SEGMENTS = 288;
/** Altura de capa del vacío roscado: el flanco de 0,75 mm de profundidad se reproduce en ≥ 7 capas. */
export const THREAD_LAYER_MM = 0.1;

const TAU = 2 * Math.PI;

/**
 * Círculo inscripto (vértices sobre el radio). Local a propósito: este módulo lo importa `layout.ts`, que también usan la validación y la
 * interfaz, y esa cadena no debe arrastrar `geometry/solid` (clipper-lib).
 */
function circlePoly(radius: number, segments: number): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (TAU * i) / segments;
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}
const mod = (a: number, n: number) => ((a % n) + n) % n;

// ------------------------------------------------------------------------------------------------ rosca hembra (nervio en V)

export interface MountThreadLayout {
  reference: ReferenceThread;
  rootR: number;
  crestR: number;
  depth: number;
  pitch: number;
  turns: number;
  flankSlope: number;
  /** Semiancho axial de la base del nervio. */
  halfBase: number;
  /** Cara de entrada del portalámparas (cara superior de la torre o del plato). */
  faceZ: number;
  /** Alturas del ápice más profundo y del más cercano a la cara, y del tramo con nervio (flancos incluidos). */
  deepApexZ: number;
  nearApexZ: number;
  ribLoZ: number;
  ribHiZ: number;
  /** Azimut (grados) donde arranca el filete en su extremo profundo; el corte es un plano radial. */
  startDeg: number;
}

export function mountThreadLayout(reference: ReferenceThread, faceZ: number, startDeg = 0): MountThreadLayout {
  const depth = threadDepthMm(reference);
  const halfBase = threadHalfBaseMm(reference);
  const deepApexZ = faceZ - reference.deepApexDepthMm;
  const nearApexZ = faceZ - reference.nearApexDepthMm;
  return {
    reference,
    rootR: reference.rootDiameterMm / 2,
    crestR: reference.crestDiameterMm / 2,
    depth,
    pitch: reference.pitchMm,
    turns: reference.turns,
    flankSlope: reference.flankSlope,
    halfBase,
    faceZ,
    deepApexZ,
    nearApexZ,
    ribLoZ: deepApexZ - halfBase,
    ribHiZ: Math.min(nearApexZ + halfBase, faceZ),
    startDeg,
  };
}

/**
 * Altura radial (hacia el eje) del nervio en (theta, z): un perfil en V (profundidad del filete, flancos con la pendiente medida) centrado
 * en la hélice a derechas cuyo ápice sube `pitch` por vuelta desde `deepApexZ`, durante exactamente `turns` vueltas con corte plano en ambos extremos.
 */
export function ribHeightAt(t: MountThreadLayout, theta: number, z: number): number {
  if (z < t.ribLoZ - 1e-9 || z > t.ribHiZ + 1e-9) return 0;
  const phi0 = mod(theta - (t.startDeg * Math.PI) / 180, TAU);
  const maxPhi = t.turns * TAU;
  let best = 0;
  for (let k = 0; k <= t.turns; k++) {
    const phi = phi0 + k * TAU;
    if (phi > maxPhi + 1e-9) continue;
    const apexZ = t.deepApexZ + (t.pitch * phi) / TAU;
    best = Math.max(best, t.depth - t.flankSlope * Math.abs(z - apexZ));
  }
  return Math.max(0, best);
}

/**
 * Contorno del vacío (agujero liso con su nervio). `z` puede ser una altura o varias (las de una capa): se toma el nervio más alto, así la cresta
 * del STL se alcanza aunque el ápice caiga entre dos muestras (con la altura media sola quedaba hasta 0,04 mm más baja).
 */
export function threadBorePolygon(t: MountThreadLayout, z: number | number[], segments = THREAD_SEGMENTS): Point2D[] {
  const zs = Array.isArray(z) ? z : [z];
  const pts: Point2D[] = [];
  for (let j = 0; j < segments; j++) {
    const theta = (TAU * j) / segments;
    const r = t.rootR - Math.max(...zs.map((zz) => ribHeightAt(t, theta, zz)));
    pts.push([r * Math.cos(theta), r * Math.sin(theta)]);
  }
  return pts;
}

/**
 * Vacío del agujero roscado desde `zBottom` hasta la cara: liso a la raíz fuera de la zona del nervio y, dentro de ella, una capa por
 * `THREAD_LAYER_MM` con el nervio más alto de 5 alturas de la capa (la cresta medida se alcanza).
 */
export function threadBoreFeatures(t: MountThreadLayout, zBottom: number, belowR: number): SolidFeature[] {
  const features: SolidFeature[] = [];
  const plainBottom = Math.max(zBottom, t.ribLoZ - 0.5);
  if (plainBottom > zBottom + 1e-6) features.push({ z0: zBottom, z1: plainBottom, cut: [circlePoly(belowR, THREAD_SEGMENTS)] });
  if (t.ribLoZ > plainBottom + 1e-6) features.push({ z0: plainBottom, z1: t.ribLoZ, cut: [circlePoly(t.rootR, THREAD_SEGMENTS)] });
  const lo = Math.max(zBottom, t.ribLoZ);
  const layers = Math.max(1, Math.ceil((t.ribHiZ - lo) / THREAD_LAYER_MM));
  for (let k = 0; k < layers; k++) {
    const z0 = lo + ((t.ribHiZ - lo) * k) / layers;
    const z1 = lo + ((t.ribHiZ - lo) * (k + 1)) / layers;
    features.push({ z0, z1, cut: [threadBorePolygon(t, [z0, z0 + (z1 - z0) / 4, (z0 + z1) / 2, z1 - (z1 - z0) / 4, z1])] });
  }
  if (t.faceZ > t.ribHiZ + 1e-6) features.push({ z0: t.ribHiZ, z1: t.faceZ, cut: [circlePoly(t.rootR, THREAD_SEGMENTS)] });
  return features;
}

// ------------------------------------------------------------------------------------------------ a presión (BASE v2)

export interface MountPressLayout {
  /** Radio del agujero liso, cara superior del piso donde apoya el portalámparas, profundidad recta y entrada redondeada (alto y sobreancho radial). */
  boreR: number;
  seatZ: number;
  depth: number;
  leadInH: number;
  leadInR: number;
  topZ: number;
  cableHoleR: number;
}

/** `minSeatZ`: cota mínima del piso (deja 3 mm de material sobre el canal del cable). */
export function mountPressLayout(depthMm: number, minSeatZ: number): MountPressLayout {
  const seatZ = Math.max(REFERENCE_PRESS.floorTopMm, minSeatZ);
  return {
    boreR: REFERENCE_PRESS.boreDiameterMm / 2,
    seatZ,
    depth: depthMm,
    leadInH: REFERENCE_PRESS.leadInHeightMm,
    leadInR: REFERENCE_PRESS.leadInRadialMm,
    topZ: seatZ + depthMm + REFERENCE_PRESS.leadInHeightMm,
    cableHoleR: REFERENCE_PRESS.cableHoleDiameterMm / 2,
  };
}

export function pressFeatures(p: MountPressLayout, zFloor = 0): SolidFeature[] {
  const segs = 144;
  const features: SolidFeature[] = [];
  if (p.seatZ > zFloor + 1e-6) features.push({ z0: zFloor, z1: p.seatZ, cut: [circlePoly(p.cableHoleR, 48)] });
  const straightTop = p.topZ - p.leadInH;
  features.push({ z0: p.seatZ, z1: straightTop, cut: [circlePoly(p.boreR, segs)] });
  const steps = 10;
  for (let k = 0; k < steps; k++) {
    const z0 = straightTop + (p.leadInH * k) / steps;
    const z1 = straightTop + (p.leadInH * (k + 1)) / steps;
    const f = (k + 0.5) / steps;
    features.push({ z0, z1, cut: [circlePoly(p.boreR + p.leadInR * f * f, segs)] });
  }
  return features;
}

// ------------------------------------------------------------------------------------------------ plato con tres patas (patas V6), sin piso

export interface MountTripodLayout {
  /** Radio y alto del borde vertical del plato (medidos), y radio de la raíz de la rosca (agujero del plato). */
  plateR: number;
  edgeH: number;
  rootR: number;
  /** Cara superior (entrada del portalámparas) y cota más baja del plato: el cono inferior a 45° (imprimible sin soportes) llega hasta rodear el agujero con `wallMm`. */
  topZ: number;
  plateBottomZ: number;
  wallMm: number;
  /** Patas: cantidad, ancho tangencial (medido), grosor perpendicular, azimut de la primera, punto de arranque del eje (r, z) y pendiente (grados bajo la horizontal). */
  legs: number;
  legWidth: number;
  legThickness: number;
  legStartDeg: number;
  legR0: number;
  legZ0: number;
  legDropDeg: number;
  /** Radio del orificio del cuello roscado (las patas no pueden invadirlo sobre el tope) y cota del tope. */
  cavityR: number;
  ledgeZ: number;
}

export const TRIPOD_PLATE_WALL_MM = 1.31;
export const TRIPOD_LEG_THICKNESS_MM = 8;
export const TRIPOD_LEG_START_DEG = 90;

export function mountTripodLayout(topZ: number, rootR: number, cavityR: number, ledgeZ: number): MountTripodLayout {
  const plateR = REFERENCE_V6_PLATE.outerDiameterMm / 2;
  const edgeH = REFERENCE_V6_PLATE.edgeHeightMm;
  const wall = TRIPOD_PLATE_WALL_MM;
  const plateBottomZ = topZ - edgeH - (plateR - (rootR + wall));
  const dropDeg = (REFERENCE_V6_PLATE.legUpperEdgeDeg + REFERENCE_V6_PLATE.legLowerEdgeDeg) / 2;
  return {
    plateR,
    edgeH,
    rootR,
    topZ,
    plateBottomZ,
    wallMm: wall,
    legs: REFERENCE_V6_PLATE.legs,
    legWidth: REFERENCE_V6_PLATE.legWidthMm,
    legThickness: TRIPOD_LEG_THICKNESS_MM,
    legStartDeg: TRIPOD_LEG_START_DEG,
    // El eje de cada pata baja hacia afuera con la pendiente medida; arranca en el plato y su cara exterior llega al orificio del cuello justo en el tope
    // (sobre el tope la pata queda dentro del orificio sin rozar el cuello; bajo el tope se funde con la pared). Así no hay recortes discontinuos.
    legR0: cavityR - 0.5 - TRIPOD_LEG_THICKNESS_MM / 2 / Math.sin((dropDeg * Math.PI) / 180) - (topZ - edgeH - 1 - ledgeZ) / Math.tan((dropDeg * Math.PI) / 180),
    legZ0: topZ - edgeH - 1,
    legDropDeg: dropDeg,
    cavityR,
    ledgeZ,
  };
}

/** Radio del plato a la altura z (borde vertical y cono inferior a 45°). 0 si z queda fuera del plato. */
export function tripodPlateRadiusAt(t: MountTripodLayout, z: number): number {
  if (z > t.topZ || z < t.plateBottomZ) return 0;
  if (z >= t.topZ - t.edgeH) return t.plateR;
  return Math.max(t.rootR + t.wallMm, t.plateR - (t.topZ - t.edgeH - z));
}

/** Contorno de estadio (rectángulo con extremos redondeados) de una pata a la altura z, en coordenadas de la base. */
export function tripodLegPolygon(t: MountTripodLayout, k: number, z: number): Point2D[] | null {
  const tan = Math.tan((t.legDropDeg * Math.PI) / 180);
  // el eje baja `tan` mm por mm hacia afuera: r(z) = r0 + (z0 - z) / tan
  const rc = t.legR0 + (t.legZ0 - z) / tan;
  const half = t.legThickness / 2 / Math.sin((t.legDropDeg * Math.PI) / 180);
  const w = t.legWidth / 2;
  const rA = Math.max(rc - half, 0);
  const rB = rc + half;
  if (rB - rA < 2 * w * 0.2) return null;
  const az = ((t.legStartDeg + (360 / t.legs) * k) * Math.PI) / 180;
  const pts: Point2D[] = [];
  const arc = 8;
  // semicírculo exterior (de -90° a +90°) y semicírculo interior, en el sistema radial (u = radio, v = tangencial)
  for (let i = 0; i <= arc; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / arc;
    pts.push([rB - w + w * Math.cos(a), w * Math.sin(a)]);
  }
  for (let i = 0; i <= arc; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / arc;
    pts.push([rA + w + w * Math.cos(a), w * Math.sin(a)]);
  }
  const c = Math.cos(az), s = Math.sin(az);
  return pts.map(([u, v]) => [u * c - v * s, u * s + v * c] as Point2D);
}

/** Material que se conserva dentro de la cavidad a la altura z: el plato (cono + borde) y las patas. */
export function tripodSolidPolys(t: MountTripodLayout, z: number): Point2D[][] {
  const polys: Point2D[][] = [];
  const pr = tripodPlateRadiusAt(t, z);
  if (pr > 0) polys.push(circlePoly(pr, 144));
  for (let k = 0; k < t.legs; k++) {
    const p = tripodLegPolygon(t, k, z);
    if (p) polys.push(p);
  }
  return polys;
}

/** Capas del vacío de la cavidad bajo el tope (sin piso), con el plato y las patas protegidos; z de 0 hasta `ledgeZ`. */
export function tripodCavityFeatures(t: MountTripodLayout, cavityR: number, segs: number): SolidFeature[] {
  const features: SolidFeature[] = [];
  const dz = 0.5;
  const layers = Math.max(1, Math.ceil(t.ledgeZ / dz));
  for (let k = 0; k < layers; k++) {
    const z0 = (t.ledgeZ * k) / layers;
    const z1 = (t.ledgeZ * (k + 1)) / layers;
    features.push({ z0, z1, cut: [circlePoly(cavityR, segs)], protect: tripodSolidPolys(t, (z0 + z1) / 2) });
  }
  return features;
}

export const MOUNT_THREADS: Partial<Record<LampHolderMount, ReferenceThread>> = {
  threadBase2: REFERENCE_THREAD_BASE2,
  threadV6: REFERENCE_THREAD_V6,
};
