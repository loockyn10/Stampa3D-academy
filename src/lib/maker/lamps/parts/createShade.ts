import { flangeInnerRings, maleThreadRings, ringLoopMesh, type Ring } from "@/lib/maker/lamps/geometry/ringLoop";
import type { LampLayout } from "@/lib/maker/lamps/layout";
import { createDoubleWallShadeMesh } from "@/lib/maker/lamps/doublewall/buildShade";
import type { DoubleWallField } from "@/lib/maker/lamps/doublewall/field";
import { cutShellMesh, type CutRing } from "@/lib/maker/lamps/openwork/cutShell";
import type { OpenworkField } from "@/lib/maker/lamps/openwork/field";
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

export function isOpenworkField(field: ShadeField): field is OpenworkField {
  return "f" in field && "latticeRowFrom" in field;
}

export function isDoubleWallField(field: ShadeField): field is DoubleWallField {
  return "params" in field && "ringFree" in field && "gap" in field;
}

/** Anillos de la parte decorativa CALADA: una fila por altura, con el campo de corte de esa fila (vista del mismo arreglo en las dos pieles). */
function openworkDecorRings(field: OpenworkField, zOffset: number, skin: "outer" | "inner"): CutRing[] {
  const { nRows: rows, nTheta } = field;
  const rings: CutRing[] = [];
  for (let k = 0; k < rows; k++) {
    const i = skin === "outer" ? k : rows - 1 - k;
    rings.push({ z: field.z[i] + zOffset, r: skin === "outer" ? field.rowR[i] : field.rowRin[i], f: field.f.subarray(i * nTheta, (i + 1) * nTheta), row: i });
  }
  return rings;
}

/**
 * PANTALLA CALADA: el mismo cuello roscado, la misma transición de 45° y el mismo reborde de adhesión que la sólida (la interfaz
 * mecánica no depende de la decoración), pero la parte decorativa se malla cortada por el campo de aberturas: anillo inferior
 * continuo, tiras y anillo superior forman UNA superficie cerrada, con huecos reales entre las tiras.
 */
function createOpenworkShadeMesh(def: LampDefinition, field: OpenworkField, layout: LampLayout): IndexedMesh {
  const g = LAMP_GEOMETRY;
  const { nTheta } = field;
  if (layout.connection === "collar") {
    return cutShellMesh([...openworkDecorRings(field, layout.decorZ0, "outer")], [...openworkDecorRings(field, layout.decorZ0, "inner")], nTheta);
  }
  const spec = layout.spec;
  const wallRad = def.openwork.depthMm * Math.SQRT2; // espesor horizontal de la pared sobre el tramo a 45°
  const bottomR = field.rowR[0];
  const zBottom = layout.ledgeZ;
  const innerFlareTopR = bottomR - wallRad;
  const innerConeBottomZ = layout.decorZ0 - (innerFlareTopR - spec.boreR) * Math.tan((g.flareDeg * Math.PI) / 180);
  // Transición hacia ADENTRO (anillos más angostos que la raíz de la rosca): la cara exterior se inclina 45° hacia el eje; la interior es la
  // exterior desplazada `wallRad` y se corta recta contra el orificio del cuello (abajo) y contra la cara interior del anillo (arriba),
  // así el libre del anillo no tiene escalón y el difusor pasa de punta a punta.
  const inward = bottomR < spec.rootR;
  const ringInnerR = field.rowRin[0];
  const coneTopZ = layout.neckTopZ + spec.rootR - wallRad - ringInnerR;
  const coneBottomZ = layout.neckTopZ + spec.rootR - wallRad - spec.boreR;

  const outer: CutRing[] = [
    ...maleThreadRings(spec, zBottom, nTheta, g.threadRowsPerPitch),
    { z: layout.neckTopZ, r: spec.rootR },
    ...openworkDecorRings(field, layout.decorZ0, "outer"),
  ];
  const inner: CutRing[] = [
    ...openworkDecorRings(field, layout.decorZ0, "inner"),
    ...(inward
      ? [{ z: coneTopZ, r: ringInnerR }, { z: coneBottomZ, r: spec.boreR }]
      : [{ z: layout.decorZ0, r: innerFlareTopR }, { z: innerConeBottomZ, r: spec.boreR }]),
    ...flangeInnerRings(layout, zBottom),
  ];
  return cutShellMesh(outer, inner, nTheta);
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
 * REBORDE de adhesión (opcional, `layout.adhesion`): un anillo plano interno de `heightMm` en el borde inferior, que se extiende
 * `widthMm` hacia el eje desde el orificio del cuello. Aumenta la superficie contra la cama sin tocar el exterior ni la rosca;
 * su ancho se valida contra la torre y el inserto (nunca se achica en silencio).
 *
 * Con `shadeType: "openwork"` la parte decorativa es calada (ver `createOpenworkShadeMesh`).
 *
 * Todo en coordenadas de ensamblado: el borde inferior del cuello apoya en el tope de la base (`layout.ledgeZ`).
 */
export function createShadeMesh(def: LampDefinition, field: ShadeField, layout: LampLayout): IndexedMesh {
  if (def.shadeType === "double") {
    if (!isDoubleWallField(field)) throw new Error("createShadeMesh: la doble pared necesita su campo.");
    return createDoubleWallShadeMesh(def, field, layout);
  }
  if (def.shadeType === "openwork") {
    if (!isOpenworkField(field)) throw new Error("createShadeMesh: la pantalla calada necesita el campo de aberturas.");
    return createOpenworkShadeMesh(def, field, layout);
  }
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
    ...flangeInnerRings(layout, zBottom),
  ];
  return ringLoopMesh([...outer, ...inner], nTheta);
}
