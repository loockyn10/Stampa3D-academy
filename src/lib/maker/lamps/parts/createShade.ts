import { maleThreadRings, ringLoopMesh, type Ring } from "@/lib/maker/lamps/geometry/ringLoop";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import type { ShadeField } from "@/lib/maker/lamps/shade/surface";
import { LAMP_GEOMETRY, type LampDefinition } from "@/lib/maker/lamps/types";
import type { IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";

/** Anillos de la parte decorativa: la piel exterior (de abajo hacia arriba) o la interior (de arriba hacia abajo). */
function decorRings(field: ShadeField, zOffset: number, skin: "outer" | "inner"): Ring[] {
  const { nRows: rows, nTheta } = field;
  const data = skin === "outer" ? field.outer : field.inner;
  const rings: Ring[] = [];
  for (let k = 0; k < rows; k++) {
    const i = skin === "outer" ? k : rows - 1 - k;
    rings.push({ z: field.z[i] + zOffset, r: (j) => data[i * nTheta + j] });
  }
  return rings;
}

/**
 * PANTALLA exterior: malla única cerrada (tubo de pared fina abierto arriba y abajo). La piel exterior y la interior de la
 * parte decorativa salen de la MISMA grilla (θ, z) del campo ya validado.
 *
 * Conexión "integrated": debajo de la parte decorativa lleva el CUELLO ROSCADO macho (cuello grueso con la rosca
 * helicoidal de la interfaz estándar, cuello liso y una transición cónica de 45° hasta el diámetro inferior de la
 * pantalla). El cuello no depende de las ondas ni del perfil: cambiar la decoración no cambia la unión. Con la unión
 * "collar" la pantalla es solo la parte decorativa y la rosca vive en el collar independiente.
 *
 * Todo en coordenadas de ensamblado: el borde inferior del cuello apoya en el tope de la base (`layout.ledgeZ`).
 */
export function createShadeMesh(def: LampDefinition, field: ShadeField, layout: LampLayout): IndexedMesh {
  const g = LAMP_GEOMETRY;
  const { nTheta } = field;
  if (layout.connection === "collar") {
    return ringLoopMesh([...decorRings(field, layout.decorZ0, "outer"), ...decorRings(field, layout.decorZ0, "inner")], nTheta);
  }

  const spec = layout.spec;
  const wallRad = def.shade.wallMm * Math.SQRT2; // espesor horizontal de la pared sobre el tramo a 45°
  const bottomR = def.shade.bottomDiameterMm / 2;
  const zBottom = layout.ledgeZ;
  // La transición interior (45°) nace en el radio del cuello y llega al radio interior de la parte decorativa.
  const innerFlareTopR = bottomR - wallRad;
  const innerConeBottomZ = layout.decorZ0 - (innerFlareTopR - spec.boreR) * Math.tan((g.flareDeg * Math.PI) / 180);

  const outer: Ring[] = [
    ...maleThreadRings(spec, zBottom, nTheta, g.threadRowsPerPitch),
    { z: layout.neckTopZ, r: spec.rootR },
    ...decorRings(field, layout.decorZ0, "outer"),
  ];
  const inner: Ring[] = [
    ...decorRings(field, layout.decorZ0, "inner"),
    { z: layout.decorZ0, r: innerFlareTopR },
    { z: innerConeBottomZ, r: spec.boreR },
    { z: zBottom, r: spec.boreR },
  ];
  return ringLoopMesh([...outer, ...inner], nTheta);
}
