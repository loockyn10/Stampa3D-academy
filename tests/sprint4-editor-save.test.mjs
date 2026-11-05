// Sprint 4 / QA-014: los editores de Mi Taller y Admin no deben cerrar el editor tras un guardado fallido
// (el `error` del estado de React estaba desactualizado) ni permitir el doble envío.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const EDITORS = [
  "src/components/configuracion/printers-manager.tsx",
  "src/components/configuracion/filaments-manager.tsx",
  "src/components/configuracion/product-types-manager.tsx",
  "src/app/admin/calculadora/page.tsx",
  "src/app/admin/calculadora/filamentos/page.tsx",
];

for (const file of EDITORS) {
  test(`${file}: el cierre del editor depende del resultado real del guardado`, () => {
    const src = read(file);
    assert.doesNotMatch(src, /if \(!error\) setEditingId\(null\)/, "no leer el estado `error` desactualizado");
    assert.match(src, /let failed = false;/);
    assert.match(src, /failed = true/);
    assert.match(src, /if \(!failed\) setEditingId\(null\)/);
    assert.match(src, /runSave\(async \(\) => \{/, "el guardado pasa por la guarda de doble envío");
    assert.match(src, /saving=\{saving\}/, "el editor recibe `saving`");
  });
}

test("los botones Guardar se deshabilitan mientras hay un guardado en vuelo", () => {
  for (const file of [
    "src/components/configuracion/printers-manager.tsx",
    "src/components/configuracion/product-types-manager.tsx",
    "src/components/filaments/FilamentEditor.tsx",
    "src/app/admin/calculadora/page.tsx",
    "src/app/admin/calculadora/filamentos/page.tsx",
  ]) {
    assert.match(read(file), /onClick=\{onSave\} disabled=\{saving\}/, file);
  }
});

test("useSaveGuard ignora llamadas mientras hay una operación en vuelo", () => {
  const src = read("src/lib/forms/use-save-guard.ts");
  assert.match(src, /if \(inFlight\.current\) return;/);
  assert.match(src, /finally \{\s*inFlight\.current = false;/);
});
