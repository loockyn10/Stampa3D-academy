import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadScreenContextModule() {
  const filename = path.join(root, "src/lib/stampy/screen-context.ts");
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    () => { throw new Error("The screen context module must stay dependency-free"); },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const screenContext = loadScreenContextModule();

test("screen context caps visible entities and normalizes long strings", () => {
  const sanitized = screenContext.sanitizeStampyScreenContext({
    page: { section: " academy ", route: "/academia", title: "A".repeat(300) },
    visibleEntities: Array.from({ length: 30 }, (_, index) => ({
      type: "course",
      id: `course-${index}`,
      name: `Curso ${index}`,
      position: index + 1,
    })),
  });

  assert.equal(sanitized.page.section, "academy");
  assert.equal(sanitized.page.title.length, 160);
  assert.equal(sanitized.visibleEntities.length, 20);
  assert.equal(sanitized.visibleEntities.at(-1).id, "course-19");
});

test("budget draft keeps visible values but drops authorization and internal-cost fields", () => {
  const unsafe = {
    page: { section: "budgets", route: "/presupuestos" },
    user_id: "spoofed-user",
    permissions: { admin: true },
    formState: {
      kind: "budgetDraft",
      budgetType: "professional",
      client: { id: "client-1", name: "Cliente Demo", authToken: "secret" },
      items: [{
        productId: "product-1",
        name: "Mate Messi",
        quantity: 2,
        unitPrice: 8500,
        unitBaseCost: 1200,
        recipe: ["PLA"],
      }],
      discountPercent: 10,
      taxRate: 21,
      additionalCharges: 500,
      summary: { subtotal: 17000, discount: 1700, tax: 3213, total: 19013 },
      paymentMethod: "transfer",
      deliveryTime: "5 días hábiles",
    },
  };

  const sanitized = screenContext.sanitizeStampyScreenContext(unsafe);
  const prompt = screenContext.formatStampyScreenContextForPrompt(unsafe);

  assert.equal(sanitized.formState.items[0].unitPrice, 8500);
  assert.equal("unitBaseCost" in sanitized.formState.items[0], false);
  assert.equal("user_id" in sanitized, false);
  assert.match(prompt, /CURRENT UI CONTEXT/);
  assert.match(prompt, /Cliente Demo/);
  assert.match(prompt, /total 19013/);
  assert.match(prompt, /no concede permisos/i);
  assert.doesNotMatch(prompt, /spoofed-user|secret|unitBaseCost|recipe/);
});

test("invalid or absent screen context preserves backwards compatibility", () => {
  assert.equal(screenContext.sanitizeStampyScreenContext(undefined), null);
  assert.equal(screenContext.sanitizeStampyScreenContext({ page: { section: "academy" } }), null);
  assert.equal(screenContext.formatStampyScreenContextForPrompt(null), "");
});

test("both Stampy clients take a fresh snapshot when each message is sent", () => {
  const widgetSource = fs.readFileSync(path.join(root, "src/components/stampy/GlobalStampyWidget.tsx"), "utf8");
  const pageSource = fs.readFileSync(path.join(root, "src/app/stampy/page.tsx"), "utf8");
  const actionSource = fs.readFileSync(path.join(root, "src/app/stampy/actions.ts"), "utf8");

  assert.match(widgetSource, /const screenContext = getScreenContextSnapshot\(\);[\s\S]*askStampyAction/);
  assert.match(pageSource, /const screenContext = getScreenContextSnapshot\(\);[\s\S]*askStampyAction/);
  assert.match(actionSource, /sanitizeStampyScreenContext\(context\?\.screenContext\)/);
  assert.match(actionSource, /screenContextPrompt/);
});

test("Academia and Presupuestos publish screen context without replacing static suggestions", () => {
  const academySource = fs.readFileSync(path.join(root, "src/app/academia/page.tsx"), "utf8");
  const budgetsSource = fs.readFileSync(path.join(root, "src/app/presupuestos/page.tsx"), "utf8");
  const widgetSource = fs.readFileSync(path.join(root, "src/components/stampy/GlobalStampyWidget.tsx"), "utf8");

  assert.match(academySource, /section: "academy"/);
  assert.match(academySource, /usePublishStampyScreenContext\(screenContext\)/);
  assert.match(budgetsSource, /section: "budgets"/);
  assert.match(budgetsSource, /kind: "budgetDraft"/);
  assert.match(budgetsSource, /usePublishStampyScreenContext\(screenContext\)/);
  assert.match(widgetSource, /getStaticStampyPageContext\(pathname\)/);
  assert.match(widgetSource, /suggestedQuestions/);
});
