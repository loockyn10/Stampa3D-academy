import JSZip from "jszip";
import type { LetterGeometryResult } from "@/lib/maker/types";
import { buildSTLBlob, downloadBlob } from "@/lib/maker/exporters/exportSTL";

/**
 * Arma el ZIP de la palabra completa con tapa frontal (cuerpo + tapa como
 * piezas separadas, en las mismas coordenadas del preview — sin recentrar:
 * representan el conjunto tal como se ve ensamblado). No dispara ninguna
 * descarga: función pura, para poder testearla sin DOM.
 */
export async function buildWordZipBlob(result: LetterGeometryResult, baseName: string): Promise<Blob> {
  if (!result.lid) {
    throw new Error("buildWordZipBlob requiere que result.lid exista (frontType === \"lid\").");
  }
  const zip = new JSZip();
  zip.file(`${baseName}_cuerpo.stl`, buildSTLBlob(result.body));
  zip.file(`${baseName}_tapa.stl`, buildSTLBlob(result.lid));
  return zip.generateAsync({ type: "blob" });
}

/**
 * Exporta la palabra completa (misma geometría que el preview: `body`/`lid`
 * combinados). Frente abierto: un solo `<nombre>.stl` (comportamiento 0.1,
 * sin cambios). Tapa frontal: cuerpo y tapa son piezas separadas a
 * propósito (no se fusionan, ver createLetterGeometry.ts) — para no
 * mezclarlas en un único STL ambiguo se exportan como `<nombre>.zip` con
 * `<nombre>_cuerpo.stl` + `<nombre>_tapa.stl`.
 */
export async function exportWord(result: LetterGeometryResult, baseName: string): Promise<void> {
  if (result.triangleCount === 0) {
    throw new Error("No hay geometría para exportar.");
  }

  if (!result.lid) {
    downloadBlob(buildSTLBlob(result.body), `${baseName}.stl`);
    return;
  }

  const blob = await buildWordZipBlob(result, baseName);
  downloadBlob(blob, `${baseName}.zip`);
}
