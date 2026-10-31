import { maleThreadRings, ringLoopMesh } from "@/lib/maker/lamps/geometry/ringLoop";
import { buildFeatureLayers, circlePoly, layersToIndexed } from "@/lib/maker/lamps/geometry/solid";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import { floorFeatures, segmentsFor, threadVoidFeatures } from "@/lib/maker/lamps/parts/baseFeatures";
import { LAMP_GEOMETRY } from "@/lib/maker/lamps/types";
import { indexedBounds, translateMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * Piezas CHICAS de prueba para validar el encastre sin imprimir una lámpara completa. Salen de las mismas funciones
 * que la lámpara (rosca: `lampThread` + `threadVoidFeatures`; alojamiento: `floorFeatures`), así que lo que encaja en
 * la prueba es lo que encaja en la pieza real. Cada malla se apoya en Z = 0.
 */
export interface LampTestPieces {
  /** Tramo macho: el mismo cuello roscado que la pantalla (o el collar), cortado a la longitud de la rosca + 3 mm. */
  threadMale: IndexedMesh;
  /** Tramo hembra: un anillo con la rosca hembra completa y el mismo tope plano de la base. */
  threadFemale: IndexedMesh;
  /** Disco con el asiento, agujeros, alojamiento de la tuerca, canal de cable y ranuras del precinto de la base. */
  holderFit: IndexedMesh;
}

function restOnBed(mesh: IndexedMesh): IndexedMesh {
  const b = indexedBounds(mesh);
  translateMesh(mesh, 0, 0, -b.minZ);
  return mesh;
}

export function createLampTestPieces(layout: LampLayout): LampTestPieces {
  const g = LAMP_GEOMETRY;
  const spec = layout.spec;
  const zBottom = layout.ledgeZ;
  const segments = g.femaleSegments;

  const topZ = zBottom + spec.length + 3;
  const threadMale = ringLoopMesh(
    [
      ...maleThreadRings(spec, zBottom, segments, g.threadRowsPerPitch),
      { z: topZ, r: spec.rootR },
      { z: topZ, r: spec.boreR },
      { z: zBottom, r: spec.boreR },
    ],
    segments,
  );

  const femaleOuterR = spec.majorR + spec.clearance + g.baseMinOuterWallMm;
  const shelf = 3;
  const femaleLayers = buildFeatureLayers(
    { z0: layout.ledgeZ - shelf, z1: layout.baseTopZ, polygons: [circlePoly(femaleOuterR, segmentsFor(femaleOuterR))] },
    [{ z0: layout.ledgeZ - shelf, z1: layout.ledgeZ, cut: [circlePoly(spec.boreR, segmentsFor(spec.boreR))] }, ...threadVoidFeatures(layout)],
  );
  const threadFemale = layersToIndexed(femaleLayers);

  const fx = layout.fixing;
  const extent = Math.max(layout.seatR, ...fx.centers.map((c) => Math.hypot(c.x, c.y) + fx.nutPocketCircumR), layout.tie ? layout.tie.x + layout.tie.halfX : 0);
  const fitR = Math.ceil(extent + 8);
  const holderFit = layersToIndexed(buildFeatureLayers({ z0: 0, z1: layout.floorTopZ, polygons: [circlePoly(fitR, segmentsFor(fitR))] }, floorFeatures(layout, fitR)));

  return { threadMale: restOnBed(threadMale), threadFemale: restOnBed(threadFemale), holderFit: restOnBed(holderFit) };
}
