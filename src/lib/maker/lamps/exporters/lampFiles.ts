import JSZip from "jszip";
import { buildSTLBlob, downloadBlob } from "@/lib/maker/exporters/exportSTL";
import { partFileEntries, type PartFileEntry } from "@/lib/maker/exporters/parts";
import { encodeLampDesign } from "@/lib/maker/lamps/designCode";
import { createLampTestPieces } from "@/lib/maker/lamps/parts/createTestPieces";
import { lampReadmeText, lampTestReadmeText } from "@/lib/maker/lamps/safety";
import { validateLamp } from "@/lib/maker/lamps/validation/validateLamp";
import { meshToSoup } from "@/lib/maker/mugs/geometry/mesh";
import type { LampDefinition, LampIssue, LampResult } from "@/lib/maker/lamps/types";
import type { PartKind } from "@/lib/maker/types";

export const LAMP_FILE_BASE_NAME = "lampara";

/** Un archivo por pieza, en su orientación de impresión (misma tabla que la Vista Cama) y con las mallas del visor. */
export function lampPartEntries(result: LampResult): PartFileEntry[] {
  if (!result.geometry || result.errors.length > 0) throw new Error(result.errors[0]?.message ?? "No hay una lámpara válida para exportar.");
  const geometry = result.geometry;
  if (geometry.triangleCount === 0 || geometry.parts.some((p) => p.mesh.triangleCount === 0)) throw new Error("La lámpara tiene una pieza vacía: no se exporta.");
  return partFileEntries(geometry.parts, LAMP_FILE_BASE_NAME);
}

export function lampEntryForKind(result: LampResult, kind: PartKind): PartFileEntry {
  const index = result.geometry?.parts.findIndex((p) => p.kind === kind) ?? -1;
  if (index < 0) throw new Error("Esa pieza no está en el diseño.");
  return lampPartEntries(result)[index];
}

/** ZIP con los STL de las piezas y un LÉEME con los avisos de seguridad y el código del diseño. Función pura (testeable sin DOM). */
export async function buildLampZipBlob(result: LampResult, def: LampDefinition): Promise<Blob> {
  const entries = lampPartEntries(result);
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.fileName, buildSTLBlob(entry.mesh));
  zip.file("LEEME.txt", lampReadmeText({ designCode: encodeLampDesign(def), holderMeasured: def.holder.measured, partNames: entries.map((e) => e.fileName), collar: def.thread.connection === "collar" }));
  return zip.generateAsync({ type: "blob" });
}

export function downloadLampPart(result: LampResult, kind: PartKind): void {
  const entry = lampEntryForKind(result, kind);
  downloadBlob(buildSTLBlob(entry.mesh), entry.fileName);
}

export async function downloadLampZip(result: LampResult, def: LampDefinition): Promise<void> {
  downloadBlob(await buildLampZipBlob(result, def), `${LAMP_FILE_BASE_NAME}.zip`);
}

/** Errores que impiden generar las piezas de prueba (la pantalla puede estar incompleta: no las afecta). */
export function isTestPieceBlocker(e: LampIssue): boolean {
  return /^(thread|holder|cable)\./.test(e.field ?? "") || e.code === "FIXING_TOO_SHORT" || e.code === "THREAD_ENGAGEMENT_SHORT" || e.code === "HOLDER_WIDER_THAN_CAVITY";
}

/**
 * Piezas de prueba (rosca macho y hembra, disco de ajuste del portalámparas) generadas con las mismas funciones que la
 * lámpara. Necesitan que la rosca, el portalámparas y el cable sean válidos; la pantalla puede estar incompleta.
 */
export function lampTestPieceEntries(def: LampDefinition): PartFileEntry[] {
  const validation = validateLamp(def);
  const blocking = validation.errors.filter(isTestPieceBlocker);
  if (blocking.length > 0 || !validation.layout) throw new Error(blocking[0]?.message ?? "Las piezas de prueba necesitan una rosca y un portalámparas válidos.");
  const pieces = createLampTestPieces(validation.layout);
  const entry = (suffix: string, mesh: Parameters<typeof meshToSoup>[0]): PartFileEntry => ({ fileName: `${LAMP_FILE_BASE_NAME}_prueba_${suffix}.stl`, mesh: meshToSoup(mesh, 45) });
  return [entry("rosca_macho", pieces.threadMale), entry("rosca_hembra", pieces.threadFemale), entry("portalamparas", pieces.holderFit)];
}

export async function buildLampTestZipBlob(def: LampDefinition): Promise<Blob> {
  const entries = lampTestPieceEntries(def);
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.fileName, buildSTLBlob(entry.mesh));
  zip.file(
    "LEEME_PRUEBAS.txt",
    lampTestReadmeText({ threadDiameterMm: def.thread.majorDiameterMm, pitchMm: def.thread.pitchMm, starts: def.thread.starts, clearanceMm: def.thread.clearanceMm, holderMeasured: def.holder.measured }),
  );
  return zip.generateAsync({ type: "blob" });
}

export async function downloadLampTestZip(def: LampDefinition): Promise<void> {
  downloadBlob(await buildLampTestZipBlob(def), `${LAMP_FILE_BASE_NAME}_piezas_de_prueba.zip`);
}
