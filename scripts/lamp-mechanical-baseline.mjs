// Genera la LÍNEA BASE mecánica de las lámparas: mediciones de las interfaces mecánicas (portalámparas, canal y encastre del difusor, roscas) sobre las
// mallas y los STL que produce el motor REAL, para una matriz de diseños. Se corre una vez (antes de tocar la interfaz) y el resultado se versiona en
// tests/fixtures/lamp-mechanical-baseline.json; la prueba tests/maker-lamps-editor-mechanics.test.mjs lo compara con el motor actual.
//
// Uso:  node scripts/lamp-mechanical-baseline.mjs            (escribe el fixture)
//       node scripts/lamp-mechanical-baseline.mjs --check    (solo mide y compara, sin escribir)
//
// REGENERAR este archivo solo es válido si se cambió A PROPÓSITO una interfaz mecánica y se validó físicamente: no es un paso de mantenimiento.
import fs from "node:fs";
import path from "node:path";
import { measureMechanics, referenceDesigns } from "../tests/helpers/lamp-mechanics.mjs";

const out = path.join(process.cwd(), "tests", "fixtures", "lamp-mechanical-baseline.json");
const designs = referenceDesigns();
const cases = {};
for (const [id, def] of Object.entries(designs)) {
  const started = Date.now();
  cases[id] = { def, measures: await measureMechanics(def) };
  console.log(`${id}: ${Date.now() - started} ms · mount=${cases[id].measures.layout.mount} · rosca Ø${cases[id].measures.layout.thread.majorR * 2}`);
}
const fixture = {
  note: "Línea base de las interfaces mecánicas de las lámparas E27 (motor al 2026-11-12, antes del sprint del editor visual). No se regenera salvo cambio mecánico validado físicamente.",
  generatedFrom: "scripts/lamp-mechanical-baseline.mjs",
  cases,
};
if (process.argv.includes("--check")) console.log("(--check: no se escribió nada)");
else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(fixture));
  console.log(`Escrito ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}
