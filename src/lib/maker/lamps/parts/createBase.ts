import type { Point2D } from "@/lib/maker/types";
import { buildFeatureLayers, circlePoly, layersToIndexed, rectPoly, sectorPoly, type SolidFeature } from "@/lib/maker/lamps/geometry/solid";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import { LAMP_GEOMETRY, type LampDefinition } from "@/lib/maker/lamps/types";
import type { IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

const segmentsFor = (radius: number) => Math.min(144, Math.max(24, Math.round((radius * 3) / 4) * 4));

/** Sectores de 45° que, unidos, forman un anillo (Clipper los funde: los vértices compartidos son exactamente los mismos). */
function ringSectors(rIn: number, rOut: number): Point2D[][] {
  return Array.from({ length: 8 }, (_, k) => sectorPoly(rIn, rOut, k * 45, (k + 1) * 45));
}

/**
 * BASE para un portalámparas E27 comercial (pieza independiente, impresión convencional, apoyada en Z = 0).
 * Sólido macizo (el laminador lo rellena) con:
 *   - asiento superior del cuerpo del portalámparas + agujero pasante para la espiga/cable;
 *   - alojamiento inferior para la tuerca/bornes y canal de cable abierto hacia el borde (+X), por debajo;
 *   - ranura anular donde encastran los dientes del inserto (colocación y centrado);
 *   - 6 apoyos que elevan la pantalla (luz de ventilación) con un aro exterior de centrado: la pantalla apoya por su
 *     diámetro EXTERIOR, así que el encaje no depende del espesor real que imprima el modo vaso.
 *
 * NO contiene contactos, roscas ni conexiones eléctricas: el portalámparas es un componente comercial certificado.
 */
export function createBaseMesh(def: LampDefinition, layout: LampLayout): IndexedMesh {
  const g = LAMP_GEOMETRY;
  const { holder, cable, insert, base, shade } = def;
  const R = layout.baseDiameterMm / 2;
  const top = layout.baseTopZ;
  const features: SolidFeature[] = [];

  const throughR = holder.threadDiameterMm / 2 + 0.6;
  features.push({ z0: 0, z1: top, cut: [circlePoly(throughR, segmentsFor(throughR))] });

  const nutR = holder.nutRecessDiameterMm / 2;
  features.push({ z0: 0, z1: holder.nutRecessDepthMm, cut: [circlePoly(nutR, segmentsFor(nutR))] });

  const channelDepth = cable.diameterMm + 1;
  const channelHalf = (cable.diameterMm + 1.5) / 2;
  features.push({ z0: 0, z1: channelDepth, cut: [rectPoly(0, -channelHalf, R + 2, channelHalf)] });

  const recessR = layout.holderR + g.holderFitClearanceMm;
  features.push({ z0: top - g.holderRecessDepthMm, z1: top, cut: [circlePoly(recessR, segmentsFor(recessR))] });

  if (layout.insert) {
    const c = insert.clearanceMm;
    features.push({ z0: layout.grooveZ0, z1: top, cut: ringSectors(layout.insert.innerR - c, layout.insert.outerR + c) });
  }

  // Apoyos de la pantalla + aro de centrado (6 arcos): entre arco y arco queda la luz de ventilación.
  const padIn = layout.insert ? layout.insert.outerR + insert.clearanceMm + 0.3 : layout.collarOuterR - Math.max(shade.wallMm, 1) - 1.5;
  const lipIn = layout.collarOuterR + g.shadeFitClearanceMm;
  const padTop = top + base.ventGapMm;
  const pads: Point2D[][] = [];
  const lips: Point2D[][] = [];
  for (let k = 0; k < g.padArcs; k++) {
    const center = (360 / g.padArcs) * k + 360 / g.padArcs / 2;
    pads.push(sectorPoly(padIn, layout.lipOuterR, center - g.padArcDeg / 2, center + g.padArcDeg / 2));
    lips.push(sectorPoly(lipIn, layout.lipOuterR, center - g.padArcDeg / 2, center + g.padArcDeg / 2));
  }
  features.push({ z0: top, z1: padTop, add: pads });
  features.push({ z0: padTop, z1: padTop + g.lipHeightMm, add: lips });

  const layers = buildFeatureLayers({ z0: 0, z1: top, polygons: [circlePoly(R, segmentsFor(R))] }, features);
  return layersToIndexed(layers);
}
