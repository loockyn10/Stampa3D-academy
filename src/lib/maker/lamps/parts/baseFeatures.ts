import type { Point2D } from "@/lib/maker/types";
import { circlePoly, rectPoly, sectorPoly, type SolidFeature } from "@/lib/maker/lamps/geometry/solid";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import { femaleVoidPolygon } from "@/lib/maker/lamps/geometry/ringLoop";
import { pressFeatures, threadBoreFeatures, tripodSolidPolys } from "@/lib/maker/lamps/holder/mounts";
import { LAMP_GEOMETRY } from "@/lib/maker/lamps/types";

export const segmentsFor = (radius: number) => Math.min(144, Math.max(24, Math.round((radius * 3) / 4) * 4));

/** Sectores de 45° que, unidos, forman un anillo (Clipper los funde: los vértices compartidos son exactamente los mismos). */
export function ringSectors(rIn: number, rOut: number): Point2D[][] {
  return Array.from({ length: 8 }, (_, k) => sectorPoly(rIn, rOut, k * 45, (k + 1) * 45));
}

/**
 * Canal de cable inferior (sale por +X desde el agujero central hasta el borde) y las dos ranuras del precinto (alivio de
 * tensión), en el PISO de la base. Lo usa la base; el cable baja por el agujero de la torre y sale por este canal.
 */
export function floorFeatures(layout: LampLayout, outerR: number): SolidFeature[] {
  const features: SolidFeature[] = [];
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

/**
 * Alojamiento del portalámparas de doble anillo y del cilindro de color en la TORRE central (geometría de referencia
 * `bottom.stl`): agujero central pasante, rebaje superior de los anillos (piso = apoyo) y ranura anular donde apoya el
 * borde inferior del cilindro. `zFloor` recorta todo por debajo de esa altura (la pieza de prueba usa solo el tramo alto).
 */
export function towerFeatures(layout: LampLayout, zFloor = 0): SolidFeature[] {
  const t = layout.tower;
  const features: SolidFeature[] = [];
  if (t.press) {
    // A PRESIÓN (BASE v2.stl): agujero ciego liso sobre el piso, con el orificio del cable debajo
    features.push(...pressFeatures(t.press, zFloor));
  } else if (t.thread) {
    // ROSCA HEMBRA (BASE2.stl / patas V6.stl): agujero a la raíz con el nervio helicoidal medido; debajo, el agujero central (o la raíz en el plato)
    features.push(...threadBoreFeatures(t.thread, zFloor, Math.max(t.boreR, t.thread.rootR)));
  } else {
    features.push({ z0: zFloor, z1: t.topZ, cut: [circlePoly(t.boreR, segmentsFor(t.boreR))] });
    features.push({ z0: t.seatZ, z1: t.topZ, cut: [circlePoly(t.recessR, segmentsFor(t.recessR))] });
  }
  if (t.slot) features.push({ z0: Math.max(t.slot.bottomZ, zFloor), z1: t.topZ, cut: ringSectors(t.slot.innerR, t.slot.outerR) });
  return features;
}

/** Capas de la rosca hembra: un vacío por capa, con el radio MÁS GRANDE del tramo (nunca más angosto que la superficie real). */
export function threadVoidFeatures(layout: LampLayout, protectTower = true): SolidFeature[] {
  const g = LAMP_GEOMETRY;
  const spec = layout.spec;
  const layers = Math.max(2, Math.ceil((spec.femaleDepth / spec.pitch) * g.threadFemaleLayersPerPitch));
  const segs = g.femaleSegments;
  // La torre central atraviesa la zona roscada: el vacío de la rosca no la toca por debajo de su cara superior (hay una capa que parte justo ahí).
  const towerTop = layout.tower.topZ;
  const tower = protectTower ? [circlePoly(layout.tower.towerR, segmentsFor(layout.tower.towerR))] : undefined;
  const bounds: number[] = [];
  for (let k = 0; k <= layers; k++) bounds.push(layout.ledgeZ + (spec.femaleDepth * k) / layers);
  if (protectTower && towerTop > layout.ledgeZ + 1e-3 && towerTop < layout.baseTopZ - 1e-3) bounds.push(towerTop);
  bounds.sort((a, b) => a - b);
  const features: SolidFeature[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const z0 = bounds[k], z1 = bounds[k + 1];
    if (z1 - z0 < 1e-4) continue;
    const samples = [z0, (2 * z0 + z1) / 3, (z0 + z1) / 2, (z0 + 2 * z1) / 3, z1].map((z) => femaleVoidPolygon(spec, z, layout.ledgeZ, segs));
    const polygon: Point2D[] = samples[0].map((_, j) => {
      let best = samples[0][j];
      let bestR = -1;
      for (const sm of samples) {
        const r = Math.hypot(sm[j][0], sm[j][1]);
        if (r > bestR) { bestR = r; best = sm[j]; }
      }
      return best;
    });
    // trípode: el plato y las patas (no un cilindro) son lo que atraviesa la zona roscada de la base
    const tripod = protectTower ? layout.tower.tripod : null;
    const protect = tripod && z1 <= towerTop + 1e-6 ? tripodSolidPolys(tripod, (z0 + z1) / 2) : tower && z1 <= towerTop + 1e-6 ? tower : undefined;
    features.push({ z0, z1, cut: [polygon], protect });
  }
  return features;
}
