import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { TriangleSoupData } from "@/lib/maker/types";
import { letterGeometryToBufferGeometry, type TriangleSoup } from "@/lib/maker/geometry/toBufferGeometry";

/**
 * Genera un STL binario a partir de un triangle soup (misma geometría que
 * ve el preview: el cuerpo o la tapa de la palabra completa, o de una
 * letra individual). No dispara ninguna descarga: función pura, reutilizada
 * por la exportación de palabra completa y por el ZIP de letras
 * individuales (una sola fuente de verdad geométrica).
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

/** Exporta una sola pieza (cuerpo o tapa) como STL binario, descargándola. */
export function exportMeshToSTL(mesh: TriangleSoupData, fileName: string): void {
  if (mesh.triangleCount === 0) {
    throw new Error("No hay geometría para exportar.");
  }

  const blob = buildSTLBlob(mesh);
  downloadBlob(blob, fileName.endsWith(".stl") ? fileName : `${fileName}.stl`);
}
