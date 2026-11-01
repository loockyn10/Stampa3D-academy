import type { LetterGeometryResult, SignPart } from "@/lib/maker/types";
import { applyInsertStyle, INSERT_STYLE_LABELS } from "@/lib/maker/lamps/defaults";
import { insertKind } from "@/lib/maker/lamps/createLamp";
import { createInsertMesh } from "@/lib/maker/lamps/parts/createInsert";
import { validateLamp } from "@/lib/maker/lamps/validation/validateLamp";
import type { LampDefinition, LampInsertStyle } from "@/lib/maker/lamps/types";
import { indexedBounds, meshToSoup, translateMesh } from "@/lib/maker/mugs/geometry/mesh";

export interface InsertComparison {
  geometry: LetterGeometryResult | null;
  /** Estilos que no se pudieron generar con las medidas actuales, con el motivo. */
  skipped: { style: LampInsertStyle; reason: string }[];
}

/**
 * Los tres insertos lado a lado para compararlos: cada uno es el inserto REAL (mismo generador, misma validación y misma
 * malla que el ensamblado) con los parámetros iniciales de su estilo sobre las medidas actuales de la lámpara; el estilo
 * elegido conserva sus parámetros actuales. Solo se traslada en X para mostrarlos juntos: no se exporta.
 */
export function createInsertComparison(def: LampDefinition): InsertComparison {
  const parts: SignPart[] = [];
  const skipped: InsertComparison["skipped"] = [];
  const meshes: { style: LampInsertStyle; def: LampDefinition; mesh: ReturnType<typeof createInsertMesh>; width: number }[] = [];
  for (const style of ["flat", "drop", "wavy"] as const) {
    const d: LampDefinition = style === def.insert.style ? def : applyInsertStyle(def, style);
    const v = validateLamp(d);
    const blocking = v.errors.find((e) => e.field?.startsWith("insert.") || e.code.startsWith("INSERT_") || e.code.startsWith("TOWER_"));
    if (!v.layout || !v.layout.insert || blocking || !v.layout.insert.surface.valid) {
      skipped.push({ style, reason: blocking?.message ?? v.errors[0]?.message ?? "No se pudo generar con estas medidas." });
      continue;
    }
    meshes.push({ style, def: d, mesh: createInsertMesh(d, v.layout), width: 2 * (v.layout.insert.bodyMaxR + v.layout.insert.tabLengthMm) });
  }
  if (meshes.length === 0) return { geometry: null, skipped };
  const gap = 20;
  const total = meshes.reduce((s, m) => s + m.width, 0) + gap * (meshes.length - 1);
  let x = -total / 2;
  let triangles = 0;
  for (const m of meshes) {
    translateMesh(m.mesh, x + m.width / 2, 0, 0);
    x += m.width + gap;
    const soup = meshToSoup(m.mesh, 45);
    triangles += soup.triangleCount;
    parts.push({ kind: insertKind(m.def), filenameSuffix: INSERT_STYLE_LABELS[m.style].toLowerCase(), mesh: soup });
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const m of meshes) {
    const b = indexedBounds(m.mesh);
    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
    minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ);
  }
  const geometry: LetterGeometryResult = {
    parts,
    triangleCount: triangles,
    boundingBox: { width: maxX - minX, depth: maxY - minY, height: maxZ - minZ },
    errors: [],
    warnings: [],
    letters: [],
    designCenter: { x: 0, y: 0 },
    backCutoutSafeZone: null,
    installation: null,
    installationParts: [],
  };
  return { geometry, skipped };
}
