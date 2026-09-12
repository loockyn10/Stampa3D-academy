import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function transpile(relativePath, dependencies = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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

const filamentUtils = transpile("src/lib/filaments/utils.ts");
const demoCatalog = transpile("src/lib/calculator/demo-catalog.ts", {
  "@/lib/filaments/utils": filamentUtils,
});
const route = fs.readFileSync(path.join(root, "src/app/api/calculator/catalog/route.ts"), "utf8");
const calculator = fs.readFileSync(path.join(root, "src/app/calculadora/page.tsx"), "utf8");
const registration = fs.readFileSync(path.join(root, "src/app/registro/page.tsx"), "utf8");
const repairMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260912030215_restore_calculator_catalog_service_role_select.sql"),
  "utf8",
);

const validPrinter = {
  id: "printer-good",
  name: "A1 Mini",
  brand: "Bambu Lab",
  model: "A1 Mini",
  power_watts: 350,
  maintenance_cost_per_hour: 50,
};
const validFilament = {
  id: "filament-good",
  name: "Basic",
  brand: "W3D",
  filament_type: "PLA",
  color: "Cian",
  default_total_grams: 1000,
  default_purchase_price: 18000,
};

test("demo catalog skips incomplete legacy rows instead of picking the first active row", () => {
  const printer = demoCatalog.selectDemoCatalogItem(
    [{ ...validPrinter, id: "printer-bad", power_watts: 0 }, validPrinter],
    null,
    demoCatalog.isUsableDemoPrinter,
  );
  const filament = demoCatalog.selectDemoCatalogItem(
    [{ ...validFilament, id: "filament-bad", name: null, brand: null, filament_type: "", default_purchase_price: 0 }, validFilament],
    null,
    demoCatalog.isUsableDemoFilament,
  );

  assert.equal(printer.item?.id, "printer-good");
  assert.equal(filament.item?.id, "filament-good");
  assert.equal(filament.item && demoCatalog.getCalculatorFilamentDisplayName(filament.item), "W3D PLA Basic Cian");
});

test("invalid configured demo IDs fall back only to a complete template and expose the reason", () => {
  const missing = demoCatalog.selectDemoCatalogItem(
    [validPrinter],
    "not-present",
    demoCatalog.isUsableDemoPrinter,
  );
  const invalid = demoCatalog.selectDemoCatalogItem(
    [{ ...validFilament, id: "configured", default_purchase_price: 0 }, validFilament],
    "configured",
    demoCatalog.isUsableDemoFilament,
  );

  assert.equal(missing.status, "configured_missing");
  assert.equal(missing.item?.id, "printer-good");
  assert.equal(invalid.status, "configured_invalid");
  assert.equal(invalid.item?.id, "filament-good");
});

test("catalog route keeps service role server-side, narrows fields and returns a stable public error", () => {
  assert.match(route, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(route, /select\(["']\*["']\)/);
  assert.match(route, /calculator_catalog_unavailable/);
  assert.match(route, /permission_denied/);
  assert.match(route, /no_complete_demo_template/);
  assert.match(route, /user \? printers : \[demoPrinter\]/);
  assert.match(route, /user \? filaments : \[demoFilament\]/);
});

test("calculator shows a retry state and hides the printer add button for anonymous demo", () => {
  assert.match(calculator, /No pudimos cargar la configuración de cálculo\./);
  assert.match(calculator, />\s*Reintentar\s*</);
  assert.match(calculator, /accessMode !== "anonymous" && <button/);
  assert.match(calculator, /sm:grid-cols-\[minmax\(0,1fr\)_8rem\]/);
});

test("signup keeps the local safe callback and handles transport failures", () => {
  assert.match(registration, /window\.location\.origin}\/auth\/callback\?next=/);
  assert.match(registration, /sanitizeReturnTo/);
  assert.match(registration, /No pudimos conectar con el servicio de registro/);
  assert.doesNotMatch(registration, /\/api\/signup/);
});

test("new migration grants only SELECT to service_role and does not edit catalog RLS", () => {
  assert.match(repairMigration, /grant select on table public\.printer_templates to service_role/);
  assert.match(repairMigration, /grant select on table public\.filament_templates to service_role/);
  assert.doesNotMatch(repairMigration, /grant .* to anon/i);
  assert.doesNotMatch(repairMigration, /drop policy|create policy|alter table/i);
});
