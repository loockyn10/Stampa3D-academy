import type { Point2D } from "@/lib/maker/types";
import { buildFeatureLayers, layersToIndexed, sectorPoly, type SolidFeature } from "@/lib/maker/lamps/geometry/solid";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import { LAMP_GEOMETRY, type LampDefinition } from "@/lib/maker/lamps/types";
import { translateMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/**
 * CILINDRO de color (inserto): tubo de pared fina, pieza independiente e intercambiable.
 *   - Su borde inferior apoya en la ranura anular de la torre de la base (profundidad `seatDepthMm`): se coloca y se saca por
 *     arriba, se centra solo y no toca el portalámparas. Sin rosca propia.
 *   - Pared CONTINUA de borde a borde: sin ventanas ni cortes laterales.
 *   - Dos lengüetas EXTERIORES en el borde superior (para extraerlo con los dedos); no se acercan a la bombilla.
 *   - Abierto arriba; sin tapa ni contacto con la bombilla (la separación radial se valida aparte).
 * Con lengüetas se imprime de forma convencional (con su geometría real no es modo vaso); un tubo liso (sin lengüetas) sí
 * es candidato a modo vaso. Se genera con el origen en el eje, en coordenadas de ensamblado.
 */
export function createInsertMesh(def: LampDefinition, layout: LampLayout): IndexedMesh {
  const ins = layout.insert;
  if (!ins) throw new Error("createInsertMesh: el inserto está desactivado.");
  const g = LAMP_GEOMETRY;
  const { insert } = def;
  const { outerR: Ro, innerR: Rn, heightMm: h } = ins;
  const body: Point2D[][] = Array.from({ length: 8 }, (_, k) => sectorPoly(Rn, Ro, k * 45, (k + 1) * 45));
  const features: SolidFeature[] = [];

  if (insert.tabs) {
    const half = ((g.tabArcMm / 2 / Ro) * 180) / Math.PI;
    const add: Point2D[][] = [90, 270].map((center) => sectorPoly(Rn + insert.thicknessMm / 2, Ro + g.tabLengthMm, center - half, center + half));
    features.push({ z0: h - g.tabThicknessMm, z1: h, add });
  }

  const mesh = layersToIndexed(buildFeatureLayers({ z0: 0, z1: h, polygons: body }, features));
  translateMesh(mesh, 0, 0, ins.z0);
  return mesh;
}
