import type { Point2D } from "@/lib/maker/types";
import { circlePoly, rectPoly, sectorPoly, type SolidFeature } from "@/lib/maker/lamps/geometry/solid";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import { femaleVoidPolygon } from "@/lib/maker/lamps/geometry/ringLoop";
import { LAMP_GEOMETRY, type LampDefinition } from "@/lib/maker/lamps/types";

export const segmentsFor = (radius: number) => Math.min(144, Math.max(24, Math.round((radius * 3) / 4) * 4));

/** Sectores de 45° que, unidos, forman un anillo (Clipper los funde: los vértices compartidos son exactamente los mismos). */
export function ringSectors(rIn: number, rOut: number): Point2D[][] {
  return Array.from({ length: 8 }, (_, k) => sectorPoly(rIn, rOut, k * 45, (k + 1) * 45));
}

/** Hexágono regular con un vértice sobre +X (alojamiento anti-giro de la tuerca). */
export function hexPoly(circumR: number, cx = 0, cy = 0): Point2D[] {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k;
    return [cx + circumR * Math.cos(a), cy + circumR * Math.sin(a)] as Point2D;
  });
}

/**
 * Alojamiento del portalámparas en el PISO de la base: asiento de la cara de apoyo, agujeros pasantes de la espiga (o
 * de los dos tornillos), alojamiento hexagonal de la tuerca desde abajo, agujero de paso del cable (montaje con
 * tornillos), canal de cable que sale por +X y las dos ranuras del precinto (alivio de tensión). Lo usan la base y la
 * pieza de prueba de ajuste: lo que se prueba es exactamente lo que se imprime.
 */
export function floorFeatures(layout: LampLayout, outerR: number): SolidFeature[] {
  const fx = layout.fixing;
  const features: SolidFeature[] = [];
  features.push({ z0: layout.holderSeatZ, z1: layout.floorTopZ, cut: [circlePoly(layout.seatR, segmentsFor(layout.seatR))] });
  for (const c of fx.centers) {
    features.push({ z0: fx.pocketCeilingZ, z1: layout.holderSeatZ, cut: [circlePoly(fx.holeR, segmentsFor(fx.holeR), c.x, c.y)] });
    features.push({ z0: 0, z1: fx.pocketCeilingZ, cut: [hexPoly(fx.nutPocketCircumR, c.x, c.y)] });
  }
  if (fx.cableHoleR !== null) features.push({ z0: 0, z1: layout.holderSeatZ, cut: [circlePoly(fx.cableHoleR, segmentsFor(fx.cableHoleR))] });
  features.push({ z0: 0, z1: layout.channelHeight, cut: [rectPoly(0, -layout.channelHalf, outerR + 2, layout.channelHalf)] });
  if (layout.tie) {
    const t = layout.tie;
    features.push({
      z0: 0,
      z1: layout.floorTopZ,
      cut: [rectPoly(t.x - t.halfX, t.y0, t.x + t.halfX, t.y1), rectPoly(t.x - t.halfX, -t.y1, t.x + t.halfX, -t.y0)],
    });
  }
  return features;
}

/** Capas de la rosca hembra: un vacío por capa, con el radio MÁS GRANDE del tramo (nunca más angosto que la superficie real). */
export function threadVoidFeatures(layout: LampLayout): SolidFeature[] {
  const g = LAMP_GEOMETRY;
  const spec = layout.spec;
  const layers = Math.max(2, Math.ceil((spec.femaleDepth / spec.pitch) * g.threadFemaleLayersPerPitch));
  const features: SolidFeature[] = [];
  const segs = g.femaleSegments;
  for (let k = 0; k < layers; k++) {
    const z0 = layout.ledgeZ + (spec.femaleDepth * k) / layers;
    const z1 = layout.ledgeZ + (spec.femaleDepth * (k + 1)) / layers;
    const samples = [z0, (2 * z0 + z1) / 3, (z0 + z1) / 2, (z0 + 2 * z1) / 3, z1].map((z) => femaleVoidPolygon(spec, z, layout.ledgeZ, segs));
    const polygon: Point2D[] = samples[0].map((_, j) => {
      let best = samples[0][j];
      let bestR = -1;
      for (const s of samples) {
        const r = Math.hypot(s[j][0], s[j][1]);
        if (r > bestR) { bestR = r; best = s[j]; }
      }
      return best;
    });
    features.push({ z0, z1, cut: [polygon] });
  }
  return features;
}

/** Ventanas de ventilación al nivel del piso: sectores que atraviesan la pared de la base, de la cavidad hacia afuera. */
export function ventSlotFeatures(def: LampDefinition, layout: LampLayout, outerR: number): SolidFeature[] {
  const g = LAMP_GEOMETRY;
  if (layout.ventSlots <= 0) return [];
  const rIn = layout.spec.boreR - 1;
  const half = (g.ventSlotWidthMm / 2 / layout.spec.boreR) * (180 / Math.PI);
  const pitch = 360 / layout.ventSlots;
  const cut: Point2D[][] = [];
  for (let k = 0; k < layout.ventSlots; k++) {
    const center = pitch * (k + 0.5);
    cut.push(sectorPoly(rIn, outerR + 1, center - half, center + half));
  }
  void def;
  return [{ z0: layout.floorTopZ, z1: layout.floorTopZ + g.ventSlotHeightMm, cut }];
}
