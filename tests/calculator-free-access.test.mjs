import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (request) => { throw new Error(`Unexpected dependency: ${request}`); },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const accessPolicy = loadTypeScriptModule("src/lib/auth/access-policy.ts");
const returnTo = loadTypeScriptModule("src/lib/auth/return-to.ts");
const guestDraft = loadTypeScriptModule("src/lib/calculator/guest-draft.ts");
const middleware = fs.readFileSync(path.join(root, "src/utils/supabase/middleware.ts"), "utf8");
const calculator = fs.readFileSync(path.join(root, "src/app/calculadora/page.tsx"), "utf8");
const catalogRoute = fs.readFileSync(path.join(root, "src/app/api/calculator/catalog/route.ts"), "utf8");
const preferenceRoute = fs.readFileSync(path.join(root, "src/app/api/calculator/preferences/route.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260912011034_calculator_free_preferences.sql"), "utf8");

function policyInput(overrides = {}) {
  return {
    authenticated: false,
    role: null,
    membershipStatus: null,
    membershipExpiresAt: null,
    onboardingCompleted: false,
    grants: [],
    ...overrides,
  };
}

test("calculator capabilities do not broaden paid platform access", () => {
  const anonymous = accessPolicy.evaluateAccessPolicy(policyInput());
  assert.equal(anonymous.capabilities.useCalculator, true);
  assert.equal(anonymous.capabilities.personalizeCalculator, false);
  assert.equal(anonymous.capabilities.accessPlatform, false);

  const free = accessPolicy.evaluateAccessPolicy(policyInput({ authenticated: true }));
  assert.equal(free.capabilities.useCalculator, true);
  assert.equal(free.capabilities.personalizeCalculator, true);
  assert.equal(free.capabilities.accessPlatform, false);

  const paid = accessPolicy.evaluateAccessPolicy(policyInput({ authenticated: true, membershipStatus: "active" }));
  assert.equal(paid.capabilities.accessPlatform, true);
  assert.equal(paid.capabilities.personalizeCalculator, true);
});

test("returnTo accepts only local paths", () => {
  assert.equal(returnTo.sanitizeReturnTo("/calculadora?from=signup"), "/calculadora?from=signup");
  assert.equal(returnTo.sanitizeReturnTo("https://evil.example/calculadora"), "/");
  assert.equal(returnTo.sanitizeReturnTo("//evil.example"), "/");
  assert.equal(returnTo.sanitizeReturnTo("/\\evil.example"), "/");
});

test("guest calculator draft is versioned, expires and contains no identity fields", () => {
  const now = 1_800_000_000_000;
  const draft = {
    version: 1,
    savedAt: now,
    advanced: true,
    grams: ["200"],
    hours: "8",
    minutes: "30",
    manualPricePerKg: "",
    manualErrorPercent: "5",
    manualKwhPrice: "120",
    manualPrinterConsumption: "350",
    manualPrinterMaintenance: "50",
    laborCost: "",
    otherCost: "100",
    fixedCost: "",
    manualMultiplier: "1.4",
    manualPlatformCommission: "15",
    manualPlatformExtra: "",
    shippingCost: "",
  };
  assert.deepEqual(guestDraft.parseCalculatorGuestDraft(JSON.stringify(draft), now), draft);
  assert.equal(guestDraft.parseCalculatorGuestDraft(JSON.stringify(draft), now + guestDraft.CALCULATOR_GUEST_DRAFT_TTL_MS + 1), null);
  assert.equal(JSON.stringify(draft).includes("email"), false);
});

test("route guard exposes calculator but keeps premium routes behind accessPlatform", () => {
  assert.match(middleware, /pathname === '\/calculadora'/);
  assert.match(middleware, /isFreeAccountRoute/);
  assert.match(middleware, /!hasAccess && !isPublicRoute && !isFreeAccountRoute/);
  assert.doesNotMatch(middleware, /has_platform_access[^\n]*free/i);
});

test("catalog endpoint returns narrow DTOs and anonymous mode selects one demo", () => {
  assert.doesNotMatch(catalogRoute, /\.select\(["']\*["']\)/);
  assert.match(catalogRoute, /user && selectedPrinters\.length > 0 \? selectedPrinters : \[demoPrinter\]/);
  assert.match(catalogRoute, /user && selectedFilaments\.length > 0 \? selectedFilaments : \[demoFilament\]/);
  assert.match(catalogRoute, /catalogPrinters: user \? printers : \[\]/);
  assert.match(catalogRoute, /catalogFilaments: user \? filaments : \[\]/);
  assert.match(catalogRoute, /STAMPA_DEMO_PRINTER_TEMPLATE_ID|CALCULATOR_DEMO_CONFIG/);
});

test("free preferences validate active catalog entries and never create physical stock", () => {
  assert.match(preferenceRoute, /printer_templates/);
  assert.match(preferenceRoute, /filament_templates/);
  assert.match(preferenceRoute, /calculator_user_preferences/);
  assert.doesNotMatch(preferenceRoute, /from\(["'](?:printers|filaments)["']\)/);
  assert.match(calculator, /accessMode !== "paid"/);
  assert.match(calculator, /CALCULATOR_GUEST_DRAFT_KEY/);
});

test("migration isolates preferences and restricts legacy premium calculator tables", () => {
  assert.match(migration, /create table if not exists public\.calculator_user_preferences/);
  assert.match(migration, /default_printer_template_id uuid references public\.printer_templates/);
  assert.match(migration, /default_filament_template_id uuid references public\.filament_templates/);
  assert.match(migration, /user_id = auth\.uid\(\)/);
  assert.match(migration, /as restrictive for all to authenticated/);
  assert.match(migration, /public\.has_platform_access\(auth\.uid\(\)\) or public\.is_admin\(auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /insert into public\.(?:printers|filaments)/);
});
