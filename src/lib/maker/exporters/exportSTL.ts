import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { LetterGeometryResult } from "@/lib/maker/types";
import { letterGeometryToBufferGeometry, type TriangleSoup } from "@/lib/maker/geometry/toBufferGeometry";

/**
 * Genera un STL binario a partir de un triangle soup (misma geometría que
 * ve el preview: LetterGeometryResult para la palabra completa, o un
 * LetterPieceResult individual). No dispara ninguna descarga: función pura,
 * reutilizada tanto por el STL de la palabra completa como por el ZIP de
 * letras individuales (una sola fuente de verdad geométrica).
 */
export function buildSTLBlob(mesh: TriangleSoup): Blob {
  const geometry = letterGeometryToBufferGeometry(mesh);
  const threeMesh = new THREE.Mesh(geometry);

  const exporter = new STLExporter();
  const dataView = exporter.parse(threeMesh, { binary: true });

  geometry.dispose();
  return new Blob([dataView.buffer], { type: "model/stl" });
}

/** Dispara la descarga de un Blob en el navegador con el nombre de archivo dado. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Exporta el resultado geométrico actual (la misma geometría del preview) como STL binario. */
export function exportLetterGeometryToSTL(result: LetterGeometryResult, fileName: string): void {
  if (result.triangleCount === 0) {
    throw new Error("No hay geometría para exportar.");
  }

  const blob = buildSTLBlob(result);
  downloadBlob(blob, fileName.endsWith(".stl") ? fileName : `${fileName}.stl`);
}
