import JSZip from "jszip";
import type { LetterGeometryResult, LetterPieceResult, TriangleSoupData } from "@/lib/maker/types";
import { buildSTLBlob, downloadBlob } from "@/lib/maker/exporters/exportSTL";

/**
 * Exportación de letras individuales: usa exactamente los mismos
 * LetterPieceResult que arma createLetterGeometry() para el preview y para
 * la palabra completa (una sola fuente de verdad geométrica, ver
 * docs/STAMPA_MAKER.md). Solo recentra coordenadas para el archivo
 * individual; no recalcula ni reinterpreta la malla.
 *
 * Con tapa frontal, cada letra exporta 2 STL (`..._cuerpo.stl` +
 * `..._tapa.stl`), cada uno recentrado por separado: son piezas
 * independientes para imprimir por separado, así que cada una debe apoyar
 * en Z=0 y quedar centrada en XY por su cuenta (no una respecto de la
 * otra).
 *
 * Toma el `LetterGeometryResult` completo (no solo `letters[]`) para poder
 * rechazar la exportación cuando `result.errors` no está vacío (p.ej.
 * LIP_COLLAPSED en alguna letra): es la misma fuente de verdad que usa
 * exportWord.ts, no una ruta alternativa que ignore el error.
 */

/**
 * Traslada una pieza para que su bounding box quede centrada en XY
 * alrededor del origen y apoyada en Z (minZ = 0). No modifica las normales
 * (una traslación no las afecta) ni la malla original.
 */
export function recenterMesh(mesh: TriangleSoupData): TriangleSoupData {
  const { positions } = mesh;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] - centerX;
    out[i + 1] = positions[i + 1] - centerY;
    out[i + 2] = positions[i + 2] - minZ;
  }
  return { positions: out, normals: mesh.normals, triangleCount: mesh.triangleCount };
}

/** Reemplaza caracteres inválidos/riesgosos para un nombre de archivo. El índice numérico ya garantiza unicidad, esto solo evita nombres rotos. */
function sanitizeFileNameChar(char: string): string {
  const cleaned = char.replace(/[\\/:*?"<>|\s]/g, "_");
  return cleaned.length > 0 ? cleaned : "_";
}

function letterBaseName(piece: LetterPieceResult): string {
  const index = String(piece.index).padStart(2, "0");
  return `${index}_${sanitizeFileNameChar(piece.char)}`;
}

/** Arma el ZIP en memoria (sin descargar): 1 o 2 entradas .stl por letra, recentradas. */
export async function buildLettersZipBlob(result: LetterGeometryResult): Promise<Blob> {
  if (result.errors.length > 0) {
    throw new Error(result.errors[0].message);
  }
  const zip = new JSZip();
  for (const letter of result.letters) {
    const baseName = letterBaseName(letter);
    if (letter.lid) {
      zip.file(`${baseName}_cuerpo.stl`, buildSTLBlob(recenterMesh(letter.body)));
      zip.file(`${baseName}_tapa.stl`, buildSTLBlob(recenterMesh(letter.lid)));
    } else {
      zip.file(`${baseName}.stl`, buildSTLBlob(recenterMesh(letter.body)));
    }
  }
  return zip.generateAsync({ type: "blob" });
}

/** Arma el ZIP y dispara la descarga en el navegador. */
export async function downloadLettersZip(result: LetterGeometryResult, zipFileName: string): Promise<void> {
  if (result.letters.length === 0) {
    throw new Error("No hay letras para exportar.");
  }
  const blob = await buildLettersZipBlob(result);
  downloadBlob(blob, zipFileName.endsWith(".zip") ? zipFileName : `${zipFileName}.zip`);
}
