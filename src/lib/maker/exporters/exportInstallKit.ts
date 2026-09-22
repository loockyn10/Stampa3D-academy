import JSZip from "jszip";
import type { InstallationAuxPart, LetterGeometryResult, LetterSignParams } from "@/lib/maker/types";
import { buildSTLBlob, downloadBlob } from "@/lib/maker/exporters/exportSTL";
import { recenterMesh } from "@/lib/maker/exporters/exportLettersZip";
import { partFileEntries } from "@/lib/maker/exporters/parts";
import { buildInstallTemplatePdf, buildTemplateModel } from "@/lib/maker/installation/pdf/template";
import { buildWiringGuidePdf, wiringOrderText } from "@/lib/maker/installation/pdf/wiringGuide";

/**
 * Exportación de INSTALACIÓN: piezas auxiliares (separadores de pared y soporte de empalmes externo, cada una UN STL
 * + cantidad), plantilla 1:1 (PDF vectorial), guía de conexión (PDF) y el KIT completo (ZIP con /STL e /INSTALL).
 * Todo sale de la misma geometría/plan que el preview: no hay un motor paralelo. Los cables NO se exportan (son
 * helpers visuales): solo piezas imprimibles.
 */

function assertExportable(result: LetterGeometryResult): void {
  if (result.errors.length > 0) throw new Error(result.errors[0].message);
  if (result.letters.length === 0) throw new Error("No hay letras para exportar.");
}

export function hasInstallationOutputs(result: LetterGeometryResult | null): boolean {
  return !!result && !!result.installation;
}

/** Nombre seguro de archivo a partir de la etiqueta de la letra (A1, A2...). */
function labelForFile(label: string): string {
  const cleaned = label.replace(/[\\/:*?"<>|\s]/g, "_");
  return cleaned.length > 0 ? cleaned : "_";
}

export interface AuxPartExport {
  kind: InstallationAuxPart["kind"];
  fileName: string;
  blob: Blob;
  quantity: number;
}

/** STL de las piezas auxiliares (una por geometría distinta, con su cantidad). `kind` filtra (separadores / soporte de empalmes). */
export function buildAuxPartExports(result: LetterGeometryResult, kind?: InstallationAuxPart["kind"]): AuxPartExport[] {
  assertExportable(result);
  return result.installationParts
    .filter((part) => !kind || part.kind === kind)
    .map((part) => ({ kind: part.kind, fileName: `${part.fileBaseName}.stl`, blob: buildSTLBlob(part.mesh), quantity: part.quantity }));
}

export function buildTemplatePdfBytes(result: LetterGeometryResult, params: LetterSignParams, title: string): Uint8Array {
  assertExportable(result);
  if (!result.installation) throw new Error("Activá un sistema de montaje o cableado para generar la plantilla de instalación.");
  return buildInstallTemplatePdf(buildTemplateModel(result, params, title));
}

export function buildWiringGuidePdfBytes(result: LetterGeometryResult, params: LetterSignParams, title: string): Uint8Array {
  assertExportable(result);
  if (!result.installation?.wiring) throw new Error("Activá «Cableado: Encadenado» para generar la guía de conexión.");
  return buildWiringGuidePdf(result, params, title);
}

const PART_LABEL: Record<InstallationAuxPart["kind"], string> = {
  wallSpacer: "separador de pared",
  bipolarSpliceClip: "soporte de empalmes bipolar (mecánico, no eléctrico)",
};

export function buildKitReadme(result: LetterGeometryResult, parts: AuxPartExport[], title: string): string {
  const lines = [`${title} — kit de instalación (Stampa Maker)`, "", "STL/      Letras listas para imprimir (una carpeta plana; A1/A2 = letras repetidas, en orden de lectura)."];
  for (const p of parts) lines.push(`          ${p.fileName}: ${PART_LABEL[p.kind]}. Imprimir ${p.quantity} unidades (un solo archivo, sin duplicados).`);
  lines.push("INSTALL/  Plantilla 1:1 (imprimir al 100 %) y guía de conexión.", "");
  const wiring = result.installation?.wiring;
  if (wiring) {
    lines.push(`Orden físico del cable: ${wiringOrderText(wiring)}`, "Conexión eléctrica en paralelo (baja tensión DC). Cada conexión entre letras lleva DOS conductores (+ y -).");
    const clips = result.installation?.spliceClipCount ?? 0;
    lines.push(`Cantidad de soportes de empalme: ${clips} (letras - 1). Se hacen y aíslan los empalmes fuera de las letras y recién después se colocan en el soporte.`, "");
  }
  lines.push("Los cables y empalmes los realiza el usuario; Stampa solo imprime las piezas que los sostienen, ordenan, separan y protegen.");
  return lines.join("\n");
}

/** Kit completo: /STL (letras + piezas auxiliares) e /INSTALL (plantilla, guía, LEEME). */
export async function buildInstallKitZipBlob(result: LetterGeometryResult, params: LetterSignParams, baseName: string, title: string): Promise<Blob> {
  assertExportable(result);
  const zip = new JSZip();
  const stl = zip.folder("STL")!;
  for (const letter of result.letters) {
    const base = `${String(letter.index).padStart(2, "0")}_${labelForFile(letter.instance.label)}`;
    const parts = letter.parts.map((part) => ({ ...part, mesh: recenterMesh(part.mesh) }));
    for (const entry of partFileEntries(parts, base)) stl.file(entry.fileName, buildSTLBlob(entry.mesh));
  }
  const aux = buildAuxPartExports(result);
  for (const p of aux) stl.file(p.fileName, p.blob);

  const install = zip.folder("INSTALL")!;
  if (result.installation) install.file("plantilla-instalacion.pdf", buildTemplatePdfBytes(result, params, title));
  if (result.installation?.wiring) install.file("guia-conexion.pdf", buildWiringGuidePdfBytes(result, params, title));
  zip.file("LEEME.txt", buildKitReadme(result, aux, title));
  void baseName;
  return zip.generateAsync({ type: "blob" });
}

const PDF_TYPE = "application/pdf";

export function downloadInstallKit(result: LetterGeometryResult, params: LetterSignParams, baseName: string, title: string): Promise<void> {
  return buildInstallKitZipBlob(result, params, baseName, title).then((blob) => downloadBlob(blob, `${baseName}-kit.zip`));
}

/** Descarga las piezas auxiliares de un tipo (separadores o soporte de empalmes). */
export function downloadAuxParts(result: LetterGeometryResult, kind: InstallationAuxPart["kind"]): void {
  const parts = buildAuxPartExports(result, kind);
  if (parts.length === 0) throw new Error("No hay piezas de este tipo para exportar con la configuración actual.");
  for (const p of parts) downloadBlob(p.blob, p.fileName);
}

export function downloadTemplatePdf(result: LetterGeometryResult, params: LetterSignParams, baseName: string, title: string): void {
  const bytes = buildTemplatePdfBytes(result, params, title);
  downloadBlob(new Blob([bytes as BlobPart], { type: PDF_TYPE }), `${baseName}-plantilla-instalacion.pdf`);
}

export function downloadWiringGuidePdf(result: LetterGeometryResult, params: LetterSignParams, baseName: string, title: string): void {
  const bytes = buildWiringGuidePdfBytes(result, params, title);
  downloadBlob(new Blob([bytes as BlobPart], { type: PDF_TYPE }), `${baseName}-guia-conexion.pdf`);
}
