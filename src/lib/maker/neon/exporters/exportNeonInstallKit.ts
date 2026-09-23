// Exportación de Instalación 0.3 (Secciones 41-43 del pedido): STL del Neon (sin
// cambios, sección NEON del panel), STL del Wall Clip (una pieza + cantidad, nunca N
// archivos), resumen de instalación (.txt — sin PDF todavía, Neon no tiene esa
// infraestructura; el ZIP queda estructurado para agregarlo después sin cambiar el
// layout) y el kit completo. Exportador LOCAL a Neon: `exportInstallKit.ts` de
// Carteles itera `result.letters` (siempre vacío en Neon, no reutilizable tal cual).
import JSZip from "jszip";
import { buildSTLBlob, downloadBlob } from "@/lib/maker/exporters/exportSTL";
import type { NeonGeometryResult } from "@/lib/maker/neon/createNeonGeometry";
import type { NeonAuxPart } from "@/lib/maker/neon/installation/types";

function assertNeonExportable(result: NeonGeometryResult): void {
  if (!result.geometry || result.geometry.triangleCount === 0) throw new Error("No hay geometría para exportar.");
  if (result.errors.length > 0) throw new Error(result.errors[0].message);
}

export interface NeonAuxPartExport {
  kind: NeonAuxPart["kind"];
  fileName: string;
  blob: Blob;
  quantity: number;
}

/** STL de cada pieza auxiliar distinta (hoy: solo `neonWallClip`), con su cantidad. Nunca N archivos idénticos. */
export function buildNeonWallClipExports(result: NeonGeometryResult): NeonAuxPartExport[] {
  assertNeonExportable(result);
  return result.installation.auxParts.map((part) => ({
    kind: part.kind,
    fileName: `${part.fileBaseName}.stl`,
    blob: buildSTLBlob(part.mesh),
    quantity: part.quantity,
  }));
}

function meters(mm: number): string {
  return `${(mm / 1000).toFixed(2)} m`;
}

/** Resumen de instalación en texto plano (Sección 43): segmentos, longitud, jumpers, clips, wallGap. */
export function buildNeonInstallationSummary(result: NeonGeometryResult, title: string): string {
  const inst = result.installation;
  const lines = [`${title} — resumen de instalación (Stampa Maker)`, "", `Segmentos: ${inst.segments.length}`, `Neon total: ${meters(result.metrics.lengthMm)} (recomendado +5%: ${meters(result.metrics.recommendedLengthMm)})`];
  if (inst.wiring) {
    lines.push("", "Jumpers:");
    for (const j of inst.wiring.jumpers) lines.push(`  ${j.fromSegmentId} -> ${j.toSegmentId}: ${Math.round(j.lengthMm)} mm`);
    lines.push(`Cable auxiliar total: ${Math.round(inst.wiring.totalCableMm)} mm`);
  } else {
    lines.push("", "Cableado: desactivado.");
  }
  lines.push("", `Puentes traseros: ${inst.bridges.length}`);
  const clipPart = inst.auxParts.find((p) => p.kind === "neonWallClip");
  lines.push(`Clips de pared: ${clipPart?.quantity ?? 0}`);
  lines.push("", "Los cables y empalmes los realiza el usuario; Stampa solo imprime las piezas que sostienen, separan y retienen el canal. Baja tensión DC únicamente.");
  return lines.join("\n");
}

/** Kit completo: /STL (canal + clip) e /INSTALL (resumen de instalación). */
export async function buildNeonInstallKitZipBlob(result: NeonGeometryResult, baseName: string, title: string): Promise<Blob> {
  assertNeonExportable(result);
  const zip = new JSZip();
  const stl = zip.folder("STL")!;
  stl.file(`${baseName}.stl`, buildSTLBlob(result.geometry!.parts[0].mesh));
  for (const part of buildNeonWallClipExports(result)) stl.file(part.fileName, part.blob);

  const install = zip.folder("INSTALL")!;
  install.file("installation-summary.txt", buildNeonInstallationSummary(result, title));
  return zip.generateAsync({ type: "blob" });
}

export function downloadNeonWallClipStl(result: NeonGeometryResult): void {
  const parts = buildNeonWallClipExports(result);
  if (parts.length === 0) throw new Error("No hay clips de pared para exportar con la configuración actual.");
  for (const part of parts) downloadBlob(part.blob, part.fileName);
}

export async function downloadNeonInstallKit(result: NeonGeometryResult, baseName: string, title: string): Promise<void> {
  const blob = await buildNeonInstallKitZipBlob(result, baseName, title);
  downloadBlob(blob, `${baseName}-kit.zip`);
}
