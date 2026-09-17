import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { LetterGeometryResult } from "@/lib/maker/types";
import { letterGeometryToBufferGeometry } from "@/lib/maker/geometry/toBufferGeometry";

/** Exporta el resultado geométrico actual (la misma geometría del preview) como STL binario. */
export function exportLetterGeometryToSTL(result: LetterGeometryResult, fileName: string): void {
  if (result.triangleCount === 0) {
    throw new Error("No hay geometría para exportar.");
  }

  const geometry = letterGeometryToBufferGeometry(result);
  const mesh = new THREE.Mesh(geometry);

  const exporter = new STLExporter();
  const dataView = exporter.parse(mesh, { binary: true });

  const blob = new Blob([dataView.buffer], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".stl") ? fileName : `${fileName}.stl`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  geometry.dispose();
}
