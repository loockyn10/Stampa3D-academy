import { maleThreadRings, ringLoopMesh } from "@/lib/maker/lamps/geometry/ringLoop";
import { buildFeatureLayers, circlePoly, layersToIndexed } from "@/lib/maker/lamps/geometry/solid";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import { segmentsFor, threadVoidFeatures, towerFeatures } from "@/lib/maker/lamps/parts/baseFeatures";
import { LAMP_GEOMETRY } from "@/lib/maker/lamps/types";
import { indexedBounds, translateMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * Piezas CHICAS de prueba para validar el encastre sin imprimir una lámpara completa. Salen de las mismas funciones
 * que la lámpara (rosca: `lampThread` + `threadVoidFeatures`; alojamiento: `towerFeatures`), así que lo que encaja en
 * la prueba es lo que encaja en la pieza real. Cada malla se apoya en Z = 0.
 */
export interface LampTestPieces {
  /** Tramo macho: el mismo cuello roscado que la pantalla (o el collar), cortado a la longitud de la rosca + 3 mm. */
  threadMale: IndexedMesh;
  /** Tramo hembra: un anillo con la rosca hembra completa y el mismo tope plano de la base. */
  threadFemale: IndexedMesh;
  /** Tramo alto de la torre de la base: agujero central, rebaje de los anillos con su apoyo y ranura del cilindro, con las mismas medidas. */
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
    [{ z0: layout.ledgeZ - shelf, z1: layout.ledgeZ, cut: [circlePoly(spec.boreR, segmentsFor(spec.boreR))] }, ...threadVoidFeatures(layout, false)],
  );
  const threadFemale = layersToIndexed(femaleLayers);

  // Tramo de la torre: el apoyo de los anillos con 8 mm de material debajo, el rebaje y la ranura del cilindro (deja >= 3 mm bajo su fondo)
  const t = layout.tower;
  const towerShelf = Math.max(8, t.topZ - (t.slot?.bottomZ ?? t.topZ) + g.towerFloorBelowSlotMm - (t.topZ - t.seatZ));
  const zFloor = t.seatZ - towerShelf;
  const holderFit = layersToIndexed(buildFeatureLayers({ z0: zFloor, z1: t.topZ, polygons: [circlePoly(t.towerR, segmentsFor(t.towerR))] }, towerFeatures(layout, zFloor)));

  return { threadMale: restOnBed(threadMale), threadFemale: restOnBed(threadFemale), holderFit: restOnBed(holderFit) };
}
