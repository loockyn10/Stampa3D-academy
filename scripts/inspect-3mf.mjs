#!/usr/bin/env node
/**
 * Inspección de solo lectura de un .3mf real (Bambu Studio / OrcaSlicer / estándar).
 * Usa EXACTAMENTE el mismo módulo que la Librería STL (src/lib/stl/three-mf-package.ts), así que
 * muestra lo que el viewer/miniatura/WebM van a decidir: slicer, camas, piezas, filamentos y colores.
 * No extrae nada a disco ni ejecuta contenido; solo imprime un resumen (nunca el contenido binario).
 *
 * Uso:  node scripts/inspect-3mf.mjs ruta/al/archivo.3mf
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { unzipSync } from "three/examples/jsm/libs/fflate.module.js";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/inspect-3mf.mjs archivo.3mf");
  process.exit(1);
}

const sourcePath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "src", "lib", "stl", "three-mf-package.ts");
const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const mod = { exports: {} };
new Function("module", "exports", outputText)(mod, mod.exports);
const pkg = mod.exports;

const data = fs.readFileSync(file);
const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
console.log(`Archivo: ${path.basename(file)} (${data.length} bytes)`);

try {
  pkg.assertSafeThreeMfArchive(buffer, unzipSync);
  console.log("Límites ZIP: OK");
} catch (error) {
  console.log(`Límites ZIP: RECHAZADO (${error.message})`);
  process.exit(2);
}

let entries;
try {
  entries = pkg.listZipEntries(buffer, unzipSync);
} catch (error) {
  console.log(`No es un ZIP/3MF legible: ${error.message}`);
  process.exit(2);
}
console.log(`\nEntries (${entries.length}):`);
for (const entry of entries.slice(0, 80)) console.log(`  ${String(entry.originalSize).padStart(11)}  ${entry.name}`);
if (entries.length > 80) console.log(`  … y ${entries.length - 80} más`);

const info = pkg.inspect3mfPackage(buffer, unzipSync);
console.log("\nInspección:");
if (info.kind === "generic") {
  console.log(`  tipo: GENÉRICO (build completo, colores propios del archivo) — motivo: ${info.reason}`);
  process.exit(0);
}
console.log(`  tipo: slicer (${info.slicer})   Application: ${info.application}`);
console.log(`  modelo raíz: ${info.rootModelPath}`);
console.log(`  camas con contenido: ${info.plates.length} -> la preparación muestra la cama 1 (plater_id ${info.plates[0].plateId})`);
console.log(`  filament_colour: ${JSON.stringify(info.filamentColors)}`);
for (const plate of info.plates) {
  console.log(`\n  Cama plater_id=${plate.plateId}`);
  for (const index of plate.itemIndices) {
    const item = info.buildItems[index];
    console.log(`    build item #${index} (objectid ${item.objectId})`);
    for (const part of item.parts ?? []) {
      const colour = part.extruder !== null ? (info.filamentColors[part.extruder - 1] ?? "—") : "—";
      console.log(`      parte ${part.partId}  extruder=${part.extruder ?? "—"}  color=${colour}  modelo=${part.path ?? "(inline)"}`);
    }
    if (!item.parts) console.log("      (malla directa sin componentes: color neutro)");
  }
}
const first = info.plates[0].itemIndices.flatMap((i) => info.buildItems[i].parts ?? []);
const painted = pkg.findPaintedModelPaths(buffer, unzipSync, info.rootModelPath, first.map((p) => p.path));
console.log(`\nSub-modelos de la cama 1 con facetas pintadas (paint_color) o archivo ausente/ilegible (se muestran en neutro): ${painted.size ? [...painted].map((p) => p ?? "(raíz)").join(", ") : "ninguno"}`);
