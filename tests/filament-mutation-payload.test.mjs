import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadPayloadModule() {
  const filename = path.join(root, "src/lib/filaments/mutation-payload.ts");
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    () => {
      throw new Error("Filament payload helper must not have runtime dependencies");
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const {
  buildFilamentInsertPayload,
  buildFilamentMutationPayload,
} = loadPayloadModule();

test("catalog filament updates exclude joined and read-only properties", () => {
  const payload = buildFilamentMutationPayload({
    id: "filament-1",
    user_id: "user-1",
    created_at: "2026-01-01",
    updated_at: "2026-01-02",
    filament_templates: { id: "template-1", brand: "Elegoo" },
    label: "PLA Elegoo Rojo",
    displayName: "PLA Elegoo Rojo",
    name: "Basic",
    filament_type: "PLA",
    brand: "Elegoo",
    color: "Rojo",
    color_hex: "#ff0000",
    total_grams: "1000",
    remaining_grams: "750",
    purchase_price: "15000",
    is_active: true,
    source_template_id: "template-1",
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    "brand",
    "color",
    "color_hex",
    "filament_type",
    "is_active",
    "name",
    "purchase_price",
    "remaining_grams",
    "source_template_id",
    "total_grams",
  ]);
  assert.equal("filament_templates" in payload, false);
  assert.equal("user_id" in payload, false);
  assert.equal(payload.source_template_id, "template-1");
  assert.equal(payload.remaining_grams, 750);
});

test("manual filament updates keep a null source template", () => {
  const payload = buildFilamentMutationPayload({
    filament_type: " PETG ",
    brand: " W3D ",
    name: " Pro ",
    color: " Azul ",
    color_hex: " #123456 ",
    total_grams: 1_000,
    remaining_grams: 900,
    purchase_price: 20_000,
    is_active: true,
    source_template_id: null,
  });

  assert.equal(payload.source_template_id, null);
  assert.equal(payload.filament_type, "PETG");
  assert.equal(payload.brand, "W3D");
  assert.equal(payload.name, "Pro");
  assert.equal(payload.color, "Azul");
  assert.equal(payload.color_hex, "#123456");
  assert.equal(payload.total_grams, 1_000);
  assert.equal(payload.remaining_grams, 900);
  assert.equal(payload.purchase_price, 20_000);
});

test("filament inserts add only the authenticated owner id", () => {
  const payload = buildFilamentInsertPayload({
    filament_type: "PLA",
    total_grams: 1_000,
    remaining_grams: 1_000,
    purchase_price: 10_000,
    filament_templates: { id: "must-not-leak" },
  }, "user-1");

  assert.equal(payload.user_id, "user-1");
  assert.equal(payload.source_template_id, null);
  assert.equal("filament_templates" in payload, false);
});

test("stock and settings writes use the explicit payload builders", () => {
  const stockSource = fs.readFileSync(
    path.join(root, "src/app/stock/page.tsx"),
    "utf8",
  );
  const managerSource = fs.readFileSync(
    path.join(root, "src/components/configuracion/filaments-manager.tsx"),
    "utf8",
  );

  for (const source of [stockSource, managerSource]) {
    assert.match(source, /buildFilamentMutationPayload\(/);
    assert.match(source, /buildFilamentInsertPayload\(/);
    assert.doesNotMatch(source, /const payload = \{\s*\.\.\.(?:filamentFormData|formData)/);
  }
});

test("catalog imports store the template id as a foreign key, not a relation object", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/calculadora/filament-catalog-modal.tsx"),
    "utf8",
  );

  assert.match(source, /source_template_id: template\.id/);
  assert.doesNotMatch(source, /filament_templates\s*:/);
  assert.doesNotMatch(source, /\.update\(\{ is_active: (?:true|false), updated_at:/);
});
