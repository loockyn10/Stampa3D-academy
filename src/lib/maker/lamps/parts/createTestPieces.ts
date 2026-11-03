import { flangeInnerRings, maleThreadRings, ringLoopMesh } from "@/lib/maker/lamps/geometry/ringLoop";
import { buildFeatureLayers, circlePoly, layersToIndexed, type SolidFeature } from "@/lib/maker/lamps/geometry/solid";
import { pressFeatures, threadBoreFeatures } from "@/lib/maker/lamps/holder/mounts";
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
  /** Tramo macho: el mismo cuello roscado que la pantalla (o el collar), cortado a la longitud de la rosca + 3 mm, con el mismo reborde interno de adhesión si está activado (prueba de adhesión y de holgura con la torre: apoyalo sobre `holderFit`). */
  threadMale: IndexedMesh;
  /** Tramo hembra: un anillo con la rosca hembra completa y el mismo tope plano de la base. */
  threadFemale: IndexedMesh;
  /**
   * Tramo de la torre de la base con el alojamiento del portalámparas del sistema de fijación elegido, con las mismas medidas: doble anillo (agujero + rebaje +
   * ranura del cilindro), a presión (agujero liso de 20 mm sobre el piso), o rosca hembra (el agujero roscado completo).
   */
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
      ...flangeInnerRings(layout, zBottom),
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

  const t = layout.tower;
  let holderFit: IndexedMesh;
  if (t.press) {
    // 20 mm de agujero a presión (lo que hace falta para medir el ajuste) sobre 3 mm de piso con el orificio del cable; el resto del tubo no cambia el ajuste
    const trial = { ...t.press, depth: Math.min(t.press.depth, 20) };
    trial.topZ = trial.seatZ + trial.depth + trial.leadInH;
    const zFloor = trial.seatZ - 3;
    const features: SolidFeature[] = pressFeatures(trial, zFloor);
    holderFit = layersToIndexed(buildFeatureLayers({ z0: zFloor, z1: trial.topZ, polygons: [circlePoly(t.towerR, segmentsFor(t.towerR))] }, features));
  } else if (t.thread) {
    // el agujero roscado completo (2 vueltas) con 4 mm de material debajo de la raíz del filete
    const zFloor = t.thread.ribLoZ - 4;
    holderFit = layersToIndexed(buildFeatureLayers({ z0: zFloor, z1: t.thread.faceZ, polygons: [circlePoly(Math.min(t.towerR, t.thread.rootR + 9), segmentsFor(t.towerR))] }, threadBoreFeatures(t.thread, zFloor, t.thread.rootR)));
  } else {
    // Tramo de la torre: el apoyo de los anillos con 8 mm de material debajo, el rebaje y la ranura del cilindro (deja >= 3 mm bajo su fondo)
    const towerShelf = Math.max(8, t.topZ - (t.slot?.bottomZ ?? t.topZ) + g.towerFloorBelowSlotMm - (t.topZ - t.seatZ));
    const zFloor = t.seatZ - towerShelf;
    holderFit = layersToIndexed(buildFeatureLayers({ z0: zFloor, z1: t.topZ, polygons: [circlePoly(t.towerR, segmentsFor(t.towerR))] }, towerFeatures(layout, zFloor)));
  }

  return { threadMale: restOnBed(threadMale), threadFemale: restOnBed(threadFemale), holderFit: restOnBed(holderFit) };
}
