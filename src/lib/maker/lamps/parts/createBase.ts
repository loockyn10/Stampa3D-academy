import { buildFeatureLayers, circlePoly, layersToIndexed, type SolidFeature } from "@/lib/maker/lamps/geometry/solid";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import { tripodCavityFeatures } from "@/lib/maker/lamps/holder/mounts";
import { floorFeatures, ringSectors, segmentsFor, threadVoidFeatures, towerFeatures } from "@/lib/maker/lamps/parts/baseFeatures";
import type { LampDefinition } from "@/lib/maker/lamps/types";
import type { IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * BASE para un portalámparas E27 comercial de DOBLE ANILLO y para la pantalla (pieza independiente, impresión
 * convencional, apoyada en Z = 0). Sólido macizo (el laminador lo rellena), arquitectura del STL de referencia `bottom.stl`:
 *   - TORRE central con un agujero pasante (Ø42 nominal) desde la mesa hasta su cara superior, un REBAJE superior para los
 *     anillos de sujeción (Ø58 + holgura, 5,15 mm) cuyo piso es el apoyo del portalámparas, y una RANURA anular donde
 *     apoya el borde inferior del cilindro de color (10 mm de profundidad): el cilindro se coloca y se retira por arriba
 *     sin tocar el portalámparas;
 *   - PISO con el canal de cable inferior (sale por +X) y las ranuras de un precinto (alivio de tensión);
 *   - CAVIDAD anular entre la torre y la pared roscada, cerrada hacia afuera, y, hasta el TOPE, un escalón plano donde apoya
 *     la cara inferior del cuello roscado (tope de enroscado). La pared exterior de la base es LISA: sin ventanas ni ranuras
 *     decorativas; las únicas aberturas son el canal de cable y las ranuras del precinto del piso;
 *   - ROSCA HEMBRA: vacío helicoidal complementario del cuello de la pantalla (holgura configurable) con avellanado de
 *     entrada, hasta la cara superior de la base. La torre atraviesa la zona roscada.
 *
 * El portalámparas se sujeta con sus propios anillos en el rebaje: independiente de la unión decorativa. NO contiene
 * contactos, roscas eléctricas ni conexiones: el portalámparas es un componente comercial certificado.
 */
export function createBaseMesh(def: LampDefinition, layout: LampLayout): IndexedMesh {
  void def;
  const R = layout.baseDiameterMm / 2;
  const spec = layout.spec;
  const t = layout.tower;
  const features: SolidFeature[] = [];

  features.push(...towerFeatures(layout));
  if (t.tripod) {
    // SIN PISO (patas V6.stl): la cavidad llega hasta la mesa; solo quedan el plato con la rosca y las tres patas que lo unen a la pared
    features.push(...tripodCavityFeatures(t.tripod, spec.boreR, segmentsFor(spec.boreR)));
  } else {
    features.push(...floorFeatures(layout, R));
    features.push({ z0: layout.floorTopZ, z1: layout.ledgeZ, cut: ringSectors(t.towerR, spec.boreR) });
  }
  features.push(...threadVoidFeatures(layout));
  // A presión: el agujero es profundo (50 mm) y la torre sobresale de la cara superior de la base, dentro del cuello y de la pantalla
  if (t.topZ > layout.baseTopZ + 1e-6) features.push({ z0: layout.baseTopZ, z1: t.topZ, add: [circlePoly(t.towerR, segmentsFor(t.towerR))] });

  const layers = buildFeatureLayers({ z0: 0, z1: layout.baseTopZ, polygons: [circlePoly(R, segmentsFor(R))] }, features);
  return layersToIndexed(layers);
}
