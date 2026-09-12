import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const migration = read("supabase/migrations/20260912034506_calculator_free_template_selections.sql");
const selectionsRoute = read("src/app/api/calculator/selections/route.ts");
const catalogRoute = read("src/app/api/calculator/catalog/route.ts");
const preferencesRoute = read("src/app/api/calculator/preferences/route.ts");
const calculator = read("src/app/calculadora/page.tsx");
const printerModal = read("src/components/calculadora/printer-catalog-modal.tsx");
const filamentModal = read("src/components/calculadora/filament-catalog-modal.tsx");
const calculatorSelect = read("src/components/ui/calculator-select.tsx");
const middleware = read("src/utils/supabase/middleware.ts");

test("Free selections are user-owned template references with no physical inventory columns", () => {
  assert.match(migration, /create table if not exists public\.calculator_user_printer_templates/);
  assert.match(migration, /primary key \(user_id, printer_template_id\)/);
  assert.match(migration, /create table if not exists public\.calculator_user_filament_templates/);
  assert.match(migration, /primary key \(user_id, filament_template_id\)/);
  assert.doesNotMatch(migration, /remaining_grams|total_grams|public\.printers\s*\(|public\.filaments\s*\(/);
});

test("selection RLS and grants expose only own rows to authenticated users", () => {
  assert.match(migration, /alter table public\.calculator_user_printer_templates enable row level security/);
  assert.match(migration, /alter table public\.calculator_user_filament_templates enable row level security/);
  assert.ok((migration.match(/user_id = auth\.uid\(\)/g) ?? []).length >= 6);
  assert.match(migration, /revoke all on table public\.calculator_user_printer_templates from public, anon/);
  assert.match(migration, /grant select, insert, delete on table public\.calculator_user_printer_templates to authenticated/);
  assert.doesNotMatch(migration, /alter policy.*(?:public\.printers|public\.filaments)|drop policy.*calculator_free_requires_platform_access/i);
});

test("defaults must reference a selected template and existing defaults are backfilled", () => {
  assert.match(migration, /insert into public\.calculator_user_printer_templates[\s\S]*default_printer_template_id/);
  assert.match(migration, /insert into public\.calculator_user_filament_templates[\s\S]*default_filament_template_id/);
  assert.match(migration, /foreign key \(user_id, default_printer_template_id\)/);
  assert.match(migration, /foreign key \(user_id, default_filament_template_id\)/);
});

test("selection API authenticates, validates active templates and never trusts a user id", () => {
  assert.match(selectionsRoute, /supabase\.auth\.getUser\(\)/);
  assert.match(selectionsRoute, /\.eq\("is_active", true\)/);
  assert.match(selectionsRoute, /user_id: context\.user\.id/);
  assert.match(selectionsRoute, /ignoreDuplicates: true/);
  assert.doesNotMatch(selectionsRoute, /body\.user_id|from\("(?:printers|filaments)"\)/);
  assert.match(middleware, /"\/api\/calculator\/selections"/);
});

test("onboarding and later catalog additions use the same selection tables", () => {
  assert.match(preferencesRoute, /calculator_user_printer_templates/);
  assert.match(preferencesRoute, /calculator_user_filament_templates/);
  assert.match(calculator, /mutateFreeSelection\("printer", templateId/);
  assert.match(calculator, /mutateFreeSelection\("filament", templateId/);
  assert.doesNotMatch(preferencesRoute, /from\("(?:printers|filaments)"\)/);
  assert.doesNotMatch(selectionsRoute, /from\("(?:printers|filaments)"\)/);
});

test("Free dropdowns receive only selected templates while authenticated catalog remains separate", () => {
  assert.match(catalogRoute, /selectedPrinterTemplateIds\.includes\(printer\.id\)/);
  assert.match(catalogRoute, /selectedFilamentTemplateIds\.includes\(filament\.id\)/);
  assert.match(catalogRoute, /catalogPrinters: user \? printers : \[\]/);
  assert.match(catalogRoute, /catalogFilaments: user \? filaments : \[\]/);
  assert.match(calculator, /setCatalogPrinters\(catalog\.catalogPrinters\)/);
  assert.match(calculator, /setCatalogFilaments\(catalog\.catalogFilaments\)/);
});

test("Anonymous uses the real select surface but every personalization entry opens signup", () => {
  assert.match(calculatorSelect, /onReadOnlyClick/);
  assert.match(calculatorSelect, /<LockKeyhole/);
  assert.ok((calculator.match(/onReadOnlyClick=\{\(\) => setShowSignupModal\(true\)\}/g) ?? []).length >= 2);
  assert.match(calculator, /if \(accessMode === "anonymous"\) setShowSignupModal\(true\)/);
  assert.match(calculator, /grid grid-cols-\[minmax\(0,1fr\)_2\.75rem\] items-start gap-2/);
});

test("Free and Paid share catalog components while Paid keeps physical-table mutations", () => {
  assert.match(calculator, /calculatorSelection=\{isFree \?/);
  assert.match(printerModal, /calculatorSelection[\s\S]*from\("printers"\)/);
  assert.match(filamentModal, /calculatorSelection[\s\S]*from\("filaments"\)/);
  assert.match(filamentModal, /remaining_grams: template\.default_total_grams/);
  assert.match(calculator, /if \(accessMode === "free"\)/);
});
