import { bodyBulgeExtra, bodyRadius, type BodyShape } from "@/lib/maker/mugs/body/profiles";
import { bandCenters, bandRelief } from "@/lib/maker/mugs/modifiers/bands";
import { facetExtra, grooveCount, grooveExtra, grooveFade, surfaceSides } from "@/lib/maker/mugs/modifiers/ribs";
import type { ProfilePoint } from "@/lib/maker/mugs/geometry/revolveProfile";
import type { MugDefinition, MugQuality } from "@/lib/maker/mugs/types";

export interface QualitySettings {
  /** Separación vertical entre filas de la pared (mm). */
  rowStepMm: number;
  /** Segmentos angulares mínimos. */
  segments: number;
  /** Paso de muestreo del recorrido del asa (mm). */
  pathStepMm: number;
}

/** Preview: liviano para sliders. Export: alta resolución para el STL (nunca se genera en cada frame). */
export const MUG_QUALITY: Record<MugQuality, QualitySettings> = {
  preview: { rowStepMm: 2, segments: 72, pathStepMm: 2.2 },
  export: { rowStepMm: 0.75, segments: 192, pathStepMm: 0.8 },
};

function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Segmentos angulares: múltiplo de 2×lados y 2×ranuras, así las esquinas y valles caen justo en vértices. */
export function segmentCount(base: number, def: MugDefinition): number {
  let m = 2;
  for (const k of [surfaceSides(def), grooveCount(def)]) {
    if (k) {
      const step = 2 * k;
      m = (m * step) / gcd(m, step);
    }
  }
  if (m > 1024) m = 2 * Math.max(surfaceSides(def) ?? 1, grooveCount(def) ?? 1);
  return Math.max(m, Math.ceil(base / m) * m);
}

/**
 * Cuerpo resuelto del jarro: funciones radiales continuas (exterior e interior) + perfil 2D listo para revolucionar.
 *
 * Pared interior (V1, documentado en STAMPA_MAKER.md): `r_in(z) = r_out(z) − wall·√(1 + r_out'(z)²)`, es decir un
 * offset con espesor NORMAL a la pared para pendientes suaves (el espesor horizontal crece con la pendiente, así el
 * espesor real medido perpendicular a la pared es `wall`). Es exacto en paredes rectas/cónicas y una aproximación
 * en tramos muy curvos (la curvatura no se compensa).
 */
export interface MugBodyPlan {
  heightMm: number;
  /** Radio exterior base (sin facetas/ranuras/bandas) a la altura z. */
  outerR: (z: number) => number;
  /** Radio interior (con el engrosamiento del borde si corresponde). */
  innerR: (z: number) => number;
  floorZ: number;
  profile: ProfilePoint[];
  /** Filas de la pared exterior: la fila k está en z = k·dz y en profile[k + 1]. */
  outerRows: number;
  dz: number;
  /** Cuerpo hasta el borde superior de la pared (H, o H − t/2 con borde redondeado). */
  wallTopZ: number;
  segments: number;
  /** Puntos del contorno interior, de la boca al piso (para capacidad). */
  innerPoints: { r: number; z: number }[];
  /** Radio final del vértice: aplica facetas, ranuras y bandas (todas aditivas, >= 0). */
  radiusAt: (p: ProfilePoint, theta: number) => number;
  interior: { bottomRadius: number; topRadius: number };
}

export function planMugBody(def: MugDefinition, quality: MugQuality): MugBodyPlan {
  const q = MUG_QUALITY[quality];
  const insert = def.mode === "insert-shell";
  const wall = def.wallThicknessMm;
  const reinforced = def.base === "reinforced" && !insert;
  const floorZ = def.bottomThicknessMm * (reinforced ? 1.5 : 1);

  let H: number;
  let outerBase: (z: number) => number;
  let innerBase: (z: number) => number;
  if (insert) {
    const rb = def.insert.bottomDiameterMm / 2 + def.insert.clearanceMm;
    const rt = def.insert.topDiameterMm / 2 + def.insert.clearanceMm;
    const insH = def.insert.heightMm;
    H = def.bottomThicknessMm + insH;
    const shape: BodyShape = { style: def.bodyStyle, bottomRadius: rb, topRadius: rt, bulge: def.bodyBulgePct / 100 };
    const k = Math.sqrt(1 + ((rt - rb) / insH) ** 2);
    const tOf = (z: number) => Math.min(Math.max((z - def.bottomThicknessMm) / insH, 0), 1);
    innerBase = (z) => rb + (rt - rb) * tOf(z);
    outerBase = (z) => innerBase(z) + wall * k + bodyBulgeExtra(shape, tOf(z));
  } else {
    H = def.heightMm;
    const shape: BodyShape = { style: def.bodyStyle, bottomRadius: def.bottomDiameterMm / 2, topRadius: def.topDiameterMm / 2, bulge: def.bodyBulgePct / 100 };
    outerBase = (z) => bodyRadius(shape, Math.min(Math.max(z / H, 0), 1));
    innerBase = (z) => {
      const h = 0.5;
      const slope = (outerBase(Math.min(z + h, H)) - outerBase(Math.max(z - h, 0))) / (Math.min(z + h, H) - Math.max(z - h, 0));
      return outerBase(z) - wall * Math.sqrt(1 + slope * slope);
    };
  }

  // Borde grueso: el interior se cierra suavemente en los últimos 5 mm (dimensiones exteriores intactas).
  const rimZone = 5;
  const thickExtra = def.rim === "thick" ? 0.6 * wall : 0;
  // En modo inserto la cavidad NO se toca (el inserto tiene que entrar): el engrosamiento va hacia afuera.
  const rimRamp = (z: number) => thickExtra * smoothstep((z - (H - rimZone)) / rimZone);
  const innerR = (z: number) => innerBase(z) - (insert ? 0 : rimRamp(z));
  const outerR = (z: number) => outerBase(z) + (insert ? rimRamp(z) : 0);

  const topThickness = outerR(H) - innerR(H);
  const rounded = def.rim === "rounded";
  const wallTopZ = rounded ? H - topThickness / 2 : H;
  const outerRows = Math.max(4, Math.ceil(wallTopZ / q.rowStepMm));
  const dz = wallTopZ / outerRows;

  const profile: ProfilePoint[] = [{ r: 0, z: 0, mw: 0 }];
  for (let k = 0; k <= outerRows; k++) profile.push({ r: outerR(k * dz), z: k * dz, mw: 1 });

  const innerPoints: { r: number; z: number }[] = [];
  const pushInner = (r: number, z: number) => {
    profile.push({ r, z, mw: 0 });
    innerPoints.push({ r, z });
  };
  if (rounded) {
    const cx = (outerR(wallTopZ) + innerR(wallTopZ)) / 2, rad = (outerR(wallTopZ) - innerR(wallTopZ)) / 2;
    const steps = 8;
    for (let i = 1; i < steps; i++) {
      const phi = (Math.PI * i) / steps;
      profile.push({ r: cx + rad * Math.cos(phi), z: wallTopZ + rad * Math.sin(phi), mw: 1 - i / steps });
    }
  }
  const rf = reinforced ? Math.min(6, Math.max(innerR(floorZ) * 0.3, 0)) : 0;
  const zFin = floorZ + rf;
  const nIn = Math.max(2, Math.ceil((wallTopZ - zFin) / dz));
  for (let j = 0; j <= nIn; j++) {
    const z = wallTopZ - ((wallTopZ - zFin) * j) / nIn;
    pushInner(innerR(z), z);
  }
  if (rf > 0) {
    const rc = innerR(zFin);
    for (let m = 1; m <= 4; m++) {
      const phi = (Math.PI / 2) * (m / 4);
      pushInner(rc - rf + rf * Math.cos(phi), floorZ + rf - rf * Math.sin(phi));
    }
  }
  profile.push({ r: 0, z: floorZ, mw: 0 });

  const sides = surfaceSides(def);
  const grooves = grooveCount(def);
  const centers = bandCenters(def.bands, H);
  const radiusAt = (p: ProfilePoint, theta: number): number => {
    if (!p.mw) return p.r;
    let extra = 0;
    if (sides) extra += facetExtra(p.r, theta, sides);
    if (grooves) extra += grooveExtra(theta, grooves, def.grooves.depthMm) * grooveFade(p.z, H);
    if (centers.length) extra += bandRelief(def.bands, centers, p.z);
    return p.r + p.mw * extra;
  };

  return {
    heightMm: H,
    outerR,
    innerR,
    floorZ,
    profile,
    outerRows,
    dz,
    wallTopZ,
    segments: segmentCount(q.segments, def),
    innerPoints,
    radiusAt,
    interior: { bottomRadius: innerR(floorZ + rf), topRadius: innerR(H) },
  };
}
