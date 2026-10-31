import { buildFeatureLayers, circlePoly, layersToIndexed, type SolidFeature } from "@/lib/maker/lamps/geometry/solid";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import { floorFeatures, ringSectors, segmentsFor, threadVoidFeatures, ventSlotFeatures } from "@/lib/maker/lamps/parts/baseFeatures";
import { LAMP_GEOMETRY, type LampDefinition } from "@/lib/maker/lamps/types";
import type { IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * BASE para un portalámparas E27 comercial y para la pantalla (pieza independiente, impresión convencional, apoyada en Z = 0).
 * Sólido macizo (el laminador lo rellena) de abajo hacia arriba:
 *   - PISO: asiento de la cara de apoyo del portalámparas, agujero pasante de la espiga (o dos tornillos), alojamiento
 *     hexagonal de la tuerca por debajo, canal de cable que sale por +X y ranuras para un precinto (alivio de tensión);
 *   - ranura anular donde apoya el borde inferior del inserto (centrado) y ventanas de ventilación al nivel del piso;
 *   - CAVIDAD que aloja el portalámparas y el inserto, hasta el TOPE: un escalón plano donde apoya la cara inferior
 *     del cuello roscado (tope de enroscado);
 *   - ROSCA HEMBRA: vacío helicoidal complementario del cuello de la pantalla (holgura configurable) con avellanado
 *     de entrada, hasta la cara superior de la base.
 *
 * NO contiene contactos, roscas eléctricas ni conexiones: el portalámparas es un componente comercial certificado.
 */
export function createBaseMesh(def: LampDefinition, layout: LampLayout): IndexedMesh {
  const g = LAMP_GEOMETRY;
  const { insert } = def;
  const R = layout.baseDiameterMm / 2;
  const spec = layout.spec;
  const features: SolidFeature[] = [];

  features.push(...floorFeatures(layout, R));
  features.push({ z0: layout.floorTopZ, z1: layout.ledgeZ, cut: [circlePoly(spec.boreR, segmentsFor(spec.boreR))] });
  features.push(...ventSlotFeatures(def, layout, R));
  if (layout.insert) {
    const c = insert.clearanceMm;
    features.push({ z0: layout.floorTopZ - g.grooveDepthMm, z1: layout.floorTopZ, cut: ringSectors(layout.insert.innerR - c, layout.insert.outerR + c) });
  }
  features.push(...threadVoidFeatures(layout));

  const layers = buildFeatureLayers({ z0: 0, z1: layout.baseTopZ, polygons: [circlePoly(R, segmentsFor(R))] }, features);
  return layersToIndexed(layers);
}
