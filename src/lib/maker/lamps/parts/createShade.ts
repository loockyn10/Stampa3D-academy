import type { ShadeField } from "@/lib/maker/lamps/shade/surface";
import { newMesh, type IndexedMesh } from "@/lib/maker/mugs/geometry/mesh";
import { revolveProfile, type ProfilePoint } from "@/lib/maker/mugs/geometry/revolveProfile";

/**
 * PANTALLA exterior: tubo de pared fina abierto arriba y abajo, malla única cerrada. La piel exterior y la interior
 * salen de la MISMA grilla (θ, z) del campo ya validado; el lazo de revolución (piel exterior hacia arriba, borde
 * superior, piel interior hacia abajo, borde inferior) reutiliza `revolveProfile` de Jarros con `closed: true`.
 * `zOffset` ubica la pantalla en coordenadas de ensamblado (su borde inferior apoya sobre los apoyos de la base).
 */
export function createShadeMesh(field: ShadeField, zOffset: number): IndexedMesh {
  const { nRows: rows, nTheta } = field;
  const profile: ProfilePoint[] = [];
  for (let i = 0; i < rows; i++) profile.push({ r: 1, z: field.z[i] + zOffset });
  for (let i = rows - 1; i >= 0; i--) profile.push({ r: 1, z: field.z[i] + zOffset });
  const mesh = newMesh();
  revolveProfile(mesh, profile, {
    segments: nTheta,
    closed: true,
    radiusAt: (_p, theta, idx) => {
      const j = Math.round((theta * nTheta) / (2 * Math.PI)) % nTheta;
      return idx < rows ? field.outer[idx * nTheta + j] : field.inner[(2 * rows - 1 - idx) * nTheta + j];
    },
  });
  return mesh;
}
