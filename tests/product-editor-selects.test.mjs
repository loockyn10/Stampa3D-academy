import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(filename, dependencies = {}) {
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
    (request) => {
      if (request in dependencies) return dependencies[request];
      throw new Error(`Unexpected dependency: ${request}`);
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const filamentUtils = loadTypeScriptModule(
  path.join(root, "src/lib/filaments/utils.ts"),
);

test("filament display names cover manual, catalog and partial legacy rows without blanks", () => {
  assert.equal(
    filamentUtils.getFilamentDisplayName({
      brand: "W3D",
      filament_type: "PLA",
      name: "PLA Negro",
      color: "Negro",
    }),
    "W3D PLA Negro",
  );
  assert.equal(
    filamentUtils.getFilamentDisplayName({
      brand: null,
      filament_templates: { brand: "Hellbot" },
      filament_type: "PLA",
      name: "Ecofila Silk",
      color: null,
    }),
    "Hellbot PLA Ecofila Silk",
  );
  assert.equal(
    filamentUtils.getFilamentDisplayName({ color: "Rojo" }),
    "Rojo",
  );
  assert.equal(
    filamentUtils.getFilamentDisplayName({ name: "   " }),
    "Filamento sin nombre",
  );
});

test("filament search text includes catalog brand, material, variant and color", () => {
  const searchText = filamentUtils.getFilamentSearchText({
    filament_templates: { brand: "Elegoo" },
    filament_type: "PETG",
    name: "Rapid",
    color: "Rojo",
  });

  assert.match(searchText, /Elegoo/i);
  assert.match(searchText, /PETG/i);
  assert.match(searchText, /Rapid/i);
  assert.match(searchText, /Rojo/i);
});

test("product editor uses Stampa selects and keeps historical recipe references visible", () => {
  const page = fs.readFileSync(path.join(root, "src/app/productos/page.tsx"), "utf8");

  assert.doesNotMatch(page, /<select\b/);
  assert.match(page, /<CalculatorSelect/g);
  assert.match(page, /searchable[\s\S]{0,100}usePortal/);
  assert.match(page, /select\("\*, filament_templates\(brand\)"\)\.eq\("user_id", user\.id\)/);
  assert.match(page, /Filamento no disponible/);
  assert.match(page, /!isActiveFilament\(filament\)/);
});

test("inactive filaments mark a saved price as needing recalculation", () => {
  const pricingStatus = loadTypeScriptModule(
    path.join(root, "src/lib/products/pricing-status.ts"),
    { "@/lib/filaments/utils": filamentUtils },
  );
  const result = pricingStatus.getProductPricingStatus({
    calculation_snapshot: {
      source: "product_editor",
      materials: [{ filament_id: "filament-1" }],
    },
  }, [{ id: "filament-1", is_active: false }], [], []);

  assert.equal(result.needsRecalculation, true);
  assert.deepEqual(result.reasons, ["Configuración de material no encontrada"]);
});
