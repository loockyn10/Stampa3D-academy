import type { LampLayout } from "@/lib/maker/lamps/layout";
import type { LampDefinition } from "@/lib/maker/lamps/types";
import { newMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";
import { revolveProfile } from "@/lib/maker/mugs/geometry/revolveProfile";

/**
 * INSERTO de color: pieza independiente e intercambiable, en tres familias (plano, gota, ondulado) que comparten la misma
 * interfaz de montaje: su borde inferior apoya en la ranura anular de la torre de la base (profundidad `seatDepthMm`) con un
 * tubo liso de Ø exterior nominal; se coloca y se saca por arriba sin tocar el portalámparas. Sin rosca propia.
 *
 * La malla sale del perfil de `insert/surface.ts` (el mismo que usan la validación y las miniaturas), revolucionado por
 * `revolveProfile`: sin CSG, sin polos más que los de una tapa/ápice, sin triángulos degenerados. Se genera con el origen en
 * el eje, en coordenadas de ensamblado.
 *   - plano / ondulado con tapa: perfil con polos (cerrado arriba, abierto abajo).
 *   - ondulado abierto: lazo de anillos (sin lengüetas: ningún difusor las lleva).
 */
export function createInsertMesh(def: LampDefinition, layout: LampLayout): IndexedMesh {
  void def;
  const ins = layout.insert;
  if (!ins) throw new Error("createInsertMesh: el inserto está desactivado.");
  const surface = ins.surface;
  if (!surface.valid) throw new Error("createInsertMesh: la superficie del inserto no es válida.");
  const { rows, segments } = surface;
  const mesh = newMesh();
  const profile = rows.map((row) => ({ r: typeof row.r === "number" && row.r === 0 ? 0 : 1, z: row.z }));
  revolveProfile(mesh, profile, {
    segments,
    closed: surface.mode === "closed",
    radiusAt: (_p, theta, i) => {
      const r = rows[i].r;
      if (typeof r === "number") return r;
      return r[Math.round((theta * segments) / (2 * Math.PI)) % segments];
    },
  });
  return mesh;
}
