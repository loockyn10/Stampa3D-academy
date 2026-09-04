import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadCalculationModule() {
  const filename = path.join(root, "src/lib/budgets/calculation.ts");
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    () => { throw new Error("The budget calculation module must stay dependency-free"); },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const calculations = loadCalculationModule();

test("IVA is calculated on the net amount after discount", () => {
  assert.deepEqual(
    calculations.calculateBudgetTotals({ subtotal: 100000, discountPercent: 10, taxRate: 21 }),
    {
      subtotal: 100000,
      discountPercent: 10,
      discountAmount: 10000,
      netAmount: 90000,
      taxRate: 21,
      taxAmount: 18900,
      additionalCharges: 0,
      total: 108900,
    },
  );
});

test("additional charges are added after tax without changing the tax base", () => {
  const result = calculations.calculateBudgetTotals({
    subtotal: 100000,
    discountPercent: 10,
    taxRate: 21,
    additionalCharges: 5000,
  });
  assert.equal(result.netAmount, 90000);
  assert.equal(result.taxAmount, 18900);
  assert.equal(result.additionalCharges, 5000);
  assert.equal(result.total, 113900);
});

test("deposit conditions calculate amount and remaining balance without changing total", () => {
  assert.deepEqual(calculations.calculateBudgetDeposit(250000, "percent", 50), {
    requiredAmount: 125000,
    remainingAmount: 125000,
  });
  assert.deepEqual(calculations.calculateBudgetDeposit(250000, "fixed", 50000), {
    requiredAmount: 50000,
    remainingAmount: 200000,
  });
});

test("payment methods have stable customer-facing labels", () => {
  assert.equal(calculations.getBudgetPaymentLabel("transfer"), "Transferencia");
  assert.equal(calculations.getBudgetPaymentLabel("custom", "Cheque a 30 días"), "Cheque a 30 días");
  assert.equal(calculations.getBudgetPaymentLabel(null, "Condición histórica"), "Condición histórica");
});

test("professional fields are persisted and isolated from quick presentation", () => {
  const pageSource = fs.readFileSync(path.join(root, "src/app/presupuestos/page.tsx"), "utf8");
  const migrationSource = fs.readFileSync(
    path.join(root, "supabase/migrations/20260903172131_budget_modes_and_numbering.sql"),
    "utf8",
  );

  for (const field of [
    "client_snapshot", "client_reference", "payment_method", "deposit_type",
    "deposit_value", "additional_charges", "warranty", "warranty_conditions",
  ]) {
    assert.match(pageSource, new RegExp(`${field}:`));
    assert.match(migrationSource, new RegExp(`add column if not exists ${field}`));
  }
  for (const field of ["commercial_description", "material", "color", "finish", "technology", "commercial_notes"]) {
    assert.match(pageSource, new RegExp(`${field}: item\\.${field}`));
    assert.match(migrationSource, new RegExp(`add column if not exists ${field}`));
  }
  assert.match(pageSource, /formData\.budget_type === "professional"/);
});

test("supported tax rates calculate deterministic totals", () => {
  assert.equal(calculations.calculateBudgetTotals({ subtotal: 1000, discountPercent: 0, taxRate: 0 }).total, 1000);
  assert.equal(calculations.calculateBudgetTotals({ subtotal: 1000, discountPercent: 0, taxRate: 10.5 }).total, 1105);
  assert.equal(calculations.calculateBudgetTotals({ subtotal: 1000, discountPercent: 0, taxRate: 21 }).total, 1210);
});

test("unknown modes and tax rates fail closed to quick and zero IVA", () => {
  assert.equal(calculations.normalizeBudgetMode("legacy"), "quick");
  assert.equal(calculations.normalizeBudgetTaxRate(15), 0);
});

test("human budget number never exposes the internal UUID", () => {
  assert.equal(calculations.formatBudgetNumber(124), "PRES-000124");
  assert.equal(calculations.formatBudgetNumber("not-a-number"), "PRES-PENDIENTE");
});

test("automatic titles are clean before and after receiving a real number", () => {
  assert.equal(
    calculations.buildAutomaticBudgetTitle("Escuela Técnica N° 455"),
    "Presupuesto - Escuela Técnica N° 455",
  );
  assert.equal(
    calculations.buildAutomaticBudgetTitle("Escuela Técnica N° 455", 1),
    "Presupuesto - Escuela Técnica N° 455 - PRES-000001",
  );
  assert.equal(calculations.buildAutomaticBudgetTitle(null, 1), "Presupuesto - PRES-000001");
  assert.doesNotMatch(calculations.buildAutomaticBudgetTitle(undefined, 1), /undefined|null/);
});

test("default validity is seven local calendar days after issuance", () => {
  assert.equal(
    calculations.getDefaultBudgetValidUntil(new Date(2026, 8, 3, 23, 30)),
    "2026-09-10",
  );
  assert.equal(
    calculations.getDefaultBudgetValidUntil(new Date(2026, 11, 28, 12, 0)),
    "2027-01-04",
  );
});

test("new automatic titles are finalized by the database trigger", () => {
  const pageSource = fs.readFileSync(path.join(root, "src/app/presupuestos/page.tsx"), "utf8");
  const migrationSource = fs.readFileSync(
    path.join(root, "supabase/migrations/20260903172131_budget_modes_and_numbering.sql"),
    "utf8",
  );

  assert.match(pageSource, /editingId === "new" && isTitleAutomatic \? "" : formData\.title\.trim\(\)/);
  assert.match(migrationSource, /new\.budget_number := nextval/);
  assert.match(migrationSource, /if nullif\(btrim\(new\.title\), ''\) is null then/);
  assert.match(migrationSource, /'PRES-' \|\| lpad\(new\.budget_number::text, 6, '0'\)/);
  assert.doesNotMatch(pageSource, /count\([^)]*\)\s*\+\s*1/i);
});

test("PDF uses item_name snapshots and creation dates", () => {
  const pdfSource = fs.readFileSync(
    path.join(root, "src/components/presupuestos/budget-pdf-document.tsx"),
    "utf8",
  );
  assert.match(pdfSource, /item\.item_name/);
  assert.doesNotMatch(pdfSource, /item\.product_name/);
  assert.match(pdfSource, /budget\?\.created_at/);
  assert.match(pdfSource, /formatBudgetNumber\(budget\?\.budget_number\)/);
  assert.match(pdfSource, /item\.commercial_description/);
  assert.match(pdfSource, /budget\?\.additional_charges/);
  assert.match(pdfSource, /paymentLabel/);
  assert.match(pdfSource, /budget\?\.warranty/);
  assert.doesNotMatch(pdfSource, /Ganancia|unit_base_cost|total_profit/);
});
