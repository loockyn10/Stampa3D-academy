import { maleThreadRings, ringLoopMesh, type Ring } from "@/lib/maker/lamps/geometry/ringLoop";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import { LAMP_GEOMETRY } from "@/lib/maker/lamps/types";
import type { IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/** Altura radial (0..socketRibHeightMm) de los nervios de apriete del pozo en la columna `j`. */
export function socketRibHeight(column: number, segments: number): number {
  const g = LAMP_GEOMETRY;
  const theta = (2 * Math.PI * column) / segments;
  const pitch = (2 * Math.PI) / g.socketRibs;
  const half = (g.socketRibArcDeg * Math.PI) / 180;
  const delta = Math.abs(((theta + pitch / 2) % pitch) - pitch / 2);
  return delta >= half ? 0 : g.socketRibHeightMm * 0.5 * (1 + Math.cos((Math.PI * delta) / half));
}

/**
 * COLLAR ROSCADO independiente (conexión "collar", pensada para imprimir la pantalla en modo vaso). Reúne en una pieza
 * maciza lo que una pared de un solo perímetro no puede producir:
 *   - abajo, el cuello con la rosca macho de la interfaz estándar (idéntico al integrado en la pantalla);
 *   - una transición cónica de 45° hacia afuera (sin soportes al imprimir con el cuello sobre la cama);
 *   - arriba, un POZO anular cuyo radio sale del diámetro EXTERIOR de la pantalla (en modo vaso el exterior es exacto
 *     y el espesor lo decide el laminador), con 6 nervios de apriete de 0,6 mm: el borde inferior de la pantalla entra a
 *     presión sobre el piso del pozo, queda centrado, apoyado y se puede sacar tirando.
 * El interior del collar es el mismo orificio del cuello (el inserto lo atraviesa) y nunca queda más angosto.
 */
export function createCollarMesh(layout: LampLayout, segments: number): IndexedMesh {
  const g = LAMP_GEOMETRY;
  const c = layout.collar;
  if (!c) throw new Error("createCollarMesh: la conexión no es de tipo collar.");
  const spec = layout.spec;
  const zBottom = layout.ledgeZ;
  const ribs = (j: number) => c.socketR - socketRibHeight(j, segments);
  const innerConeBottomZ = c.floorZ - (c.floorInnerR - spec.boreR) * Math.tan((g.flareDeg * Math.PI) / 180);

  const outer: Ring[] = [
    ...maleThreadRings(spec, zBottom, segments, g.threadRowsPerPitch),
    { z: layout.neckTopZ, r: spec.rootR },
    { z: c.floorZ, r: c.outerWallR },
    { z: c.topZ, r: c.outerWallR },
  ];
  const inner: Ring[] = [
    { z: c.topZ, r: c.socketR + g.socketLeadInMm },
    { z: c.topZ - g.socketLeadInMm, r: c.socketR },
    { z: c.topZ - 2.5, r: ribs },
    { z: c.floorZ + 1.5, r: ribs },
    { z: c.floorZ, r: c.socketR },
    { z: c.floorZ, r: c.floorInnerR },
    { z: innerConeBottomZ, r: spec.boreR },
    { z: zBottom, r: spec.boreR },
  ];
  return ringLoopMesh([...outer, ...inner], segments);
}
