import JSZip from "jszip";
import type { LetterGeometryResult } from "@/lib/maker/types";
import { buildSTLBlob, downloadBlob } from "@/lib/maker/exporters/exportSTL";
import { partFileEntries } from "@/lib/maker/exporters/parts";

/**
 * Arma el ZIP de la palabra completa con más de una pieza (cuerpo + tapa/
 * máscara/difusor/etc., según `frontType`), en las mismas coordenadas del
 * preview — sin recentrar: representan el conjunto tal como se ve
 * ensamblado. No dispara ninguna descarga: función pura, para poder
 * testearla sin DOM.
 */
export async function buildWordZipBlob(result: LetterGeometryResult, baseName: string): Promise<Blob> {
  if (result.errors.length > 0) {
    throw new Error(result.errors[0].message);
  }
  if (result.parts.length < 2) {
    throw new Error("buildWordZipBlob requiere al menos 2 piezas (frontType !== \"open\").");
  }
  const zip = new JSZip();
  for (const entry of partFileEntries(result.parts, baseName)) {
    zip.file(entry.fileName, buildSTLBlob(entry.mesh));
  }
  return zip.generateAsync({ type: "blob" });
}

/**
 * Exporta la palabra completa (misma geometría que el preview: `parts`
 * combinadas). Una sola pieza (frente abierto): un solo `<nombre>.stl`
 * (comportamiento 0.1, sin cambios). Más de una pieza: son piezas
 * separadas a propósito (nunca se fusionan, ver createLetterGeometry.ts) —
 * para no mezclarlas en un único STL ambiguo se exportan como
 * `<nombre>.zip` con `<nombre>_<sufijo>.stl` por pieza.
 */
export async function exportWord(result: LetterGeometryResult, baseName: string): Promise<void> {
  if (result.triangleCount === 0) {
    throw new Error("No hay geometría para exportar.");
  }
  if (result.errors.length > 0) {
    throw new Error(result.errors[0].message);
  }

  if (result.parts.length === 1) {
    downloadBlob(buildSTLBlob(partFileEntries(result.parts, baseName)[0].mesh), `${baseName}.stl`);
    return;
  }

  const blob = await buildWordZipBlob(result, baseName);
  downloadBlob(blob, `${baseName}.zip`);
}
