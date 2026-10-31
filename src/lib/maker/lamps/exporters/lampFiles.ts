import JSZip from "jszip";
import { buildSTLBlob, downloadBlob } from "@/lib/maker/exporters/exportSTL";
import { partFileEntries, type PartFileEntry } from "@/lib/maker/exporters/parts";
import { encodeLampDesign } from "@/lib/maker/lamps/designCode";
import { lampReadmeText } from "@/lib/maker/lamps/safety";
import type { LampDefinition, LampResult } from "@/lib/maker/lamps/types";
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
  zip.file("LEEME.txt", lampReadmeText({ designCode: encodeLampDesign(def), holderMeasured: def.holder.measured, partNames: entries.map((e) => e.fileName) }));
  return zip.generateAsync({ type: "blob" });
}

export function downloadLampPart(result: LampResult, kind: PartKind): void {
  const entry = lampEntryForKind(result, kind);
  downloadBlob(buildSTLBlob(entry.mesh), entry.fileName);
}

export async function downloadLampZip(result: LampResult, def: LampDefinition): Promise<void> {
  downloadBlob(await buildLampZipBlob(result, def), `${LAMP_FILE_BASE_NAME}.zip`);
}
