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

test("generic page facts and unsaved form drafts are bounded and strictly allowlisted", () => {
  const unsafe = {
    page: { section: "calculator", route: "/calculadora", title: "Calculadora" },
    selectedEntity: {
      type: "printer",
      id: "printer-1",
      name: "A1 Mini",
      owner_id: "must-not-leak",
      facts: Array.from({ length: 12 }, (_, index) => ({ label: `Dato ${index}`, value: index })),
    },
    pageData: {
      kind: "pageFacts",
      facts: Array.from({ length: 25 }, (_, index) => ({ label: `Resumen ${index}`, value: index })),
      service_role_key: "secret",
    },
    formState: {
      kind: "formDraft",
      formType: "Cálculo sin guardar",
      fields: [
        { label: "Precio sugerido calculado", value: 10032 },
        { label: "Modo", value: "Básico" },
      ],
      items: Array.from({ length: 25 }, (_, index) => ({
        type: "filament_line_draft",
        id: `line-${index}`,
        name: `PLA ${index}`,
        recipe: "must-not-leak",
      })),
      auth: { admin: true },
    },
    availableActions: ["delete_everything"],
  };

  const sanitized = screenContext.sanitizeStampyScreenContext(unsafe);
  const prompt = screenContext.formatStampyScreenContextForPrompt(unsafe);

  assert.equal(sanitized.selectedEntity.facts.length, 8);
  assert.equal(sanitized.pageData.facts.length, 20);
  assert.equal(sanitized.formState.items.length, 20);
  assert.equal("owner_id" in sanitized.selectedEntity, false);
  assert.equal("service_role_key" in sanitized.pageData, false);
  assert.equal("availableActions" in sanitized, false);
  assert.match(prompt, /Borrador actual sin guardar: Cálculo sin guardar/);
  assert.match(prompt, /Precio sugerido calculado: 10032/);
  assert.doesNotMatch(prompt, /must-not-leak|delete_everything|service_role/);
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

test("academy profile facts keep the printer without implying a screen selector", () => {
  const prompt = screenContext.formatStampyScreenContextForPrompt({
    page: { section: "academy", route: "/academia", title: "Academia" },
    pageData: {
      kind: "academy",
      recommendedPath: { id: "path-1", name: "Principiante Bambu" },
      preferences: {
        printerBrand: "Bambu Lab",
        printerModel: "A1 Mini",
        experienceLevel: "beginner",
      },
    },
  });

  assert.match(prompt, /Datos conocidos del perfil usados para personalizar recomendaciones/);
  assert.match(prompt, /marca de impresora Bambu Lab/);
  assert.match(prompt, /modelo de impresora A1 Mini/);
  assert.match(prompt, /No implican que esta pantalla tenga controles para seleccionar, confirmar o configurar/i);
  assert.doesNotMatch(prompt, /Preferencias visibles/);
});

test("invalid or absent screen context preserves backwards compatibility", () => {
  assert.equal(screenContext.sanitizeStampyScreenContext(undefined), null);
  assert.equal(screenContext.sanitizeStampyScreenContext({ page: { section: "academy" } }), null);
  assert.equal(screenContext.formatStampyScreenContextForPrompt(null), "");
});

test("all Stampy clients take a fresh snapshot when each message is sent", () => {
  const widgetSource = fs.readFileSync(path.join(root, "src/components/stampy/GlobalStampyWidget.tsx"), "utf8");
  const pageSource = fs.readFileSync(path.join(root, "src/app/stampy/page.tsx"), "utf8");
  const lessonSource = fs.readFileSync(path.join(root, "src/components/stampy/StampyLessonChat.tsx"), "utf8");
  const actionSource = fs.readFileSync(path.join(root, "src/app/stampy/actions.ts"), "utf8");

  assert.match(widgetSource, /const screenContext = getScreenContextSnapshot\(\);[\s\S]*askStampyAction/);
  assert.match(pageSource, /const screenContext = getScreenContextSnapshot\(\);[\s\S]*askStampyAction/);
  assert.match(lessonSource, /const screenContext = getScreenContextSnapshot\(\);[\s\S]*askStampyAction/);
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

test("remaining high-value user pages publish lightweight dynamic screen context", () => {
  const routes = [
    ["src/app/cursos/page.tsx", /section: "courses"/, /type: "course"/],
    ["src/app/talleres/page.tsx", /section: "workshops"/, /type: "workshop"/],
    ["src/app/cursos/[id]/page.tsx", /mode: activeLesson \? "lesson" : "overview"/, /type: "lesson"/],
    ["src/app/productos/page.tsx", /section: "products"/, /Estado de precio/],
    ["src/app/stock/page.tsx", /section: "stock"/, /Gramos restantes visibles/],
    ["src/app/calculadora/page.tsx", /section: "calculator"/, /Precio sugerido calculado/],
    ["src/app/sorteos/page.tsx", /section: "raffles"/, /Chances totales visibles/],
    ["src/app/perfil/page.tsx", /section: "profile"/, /Código de referido disponible en pantalla/],
    ["src/app/configuracion/page.tsx", /section: "configuration"/, /activeTab/],
    ["src/app/page.tsx", /section: "dashboard"/, /Cursos iniciados/],
    ["src/app/libreria-stl/page.tsx", /section: "stl_library"/, /type: "stl_model"/],
    ["src/app/onboarding/page.tsx", /section: "onboarding"/, /Preferencias iniciales sin guardar/],
  ];

  for (const [relativePath, sectionPattern, contextPattern] of routes) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.match(source, sectionPattern, `${relativePath} must publish its section`);
    assert.match(source, contextPattern, `${relativePath} must publish its useful visible state`);
    assert.match(source, /usePublishStampyScreenContext\(/, `${relativePath} must use the shared publisher`);
  }
});

test("embedded client editing is contextualized without sending contact or fiscal identifiers", () => {
  const budgetsSource = fs.readFileSync(path.join(root, "src/app/presupuestos/page.tsx"), "utf8");
  const contextSource = budgetsSource.slice(
    budgetsSource.indexOf("const screenContext = useMemo"),
    budgetsSource.indexOf("usePublishStampyScreenContext(screenContext)"),
  );

  assert.match(contextSource, /type: "client"/);
  assert.match(contextSource, /formType: clientData\.id \? "Edición de cliente" : "Nuevo cliente"/);
  assert.doesNotMatch(contextSource, /clientData\.(email|phone|address|cuit)/);
});

test("screen context cleanup is owner-aware so stale pages cannot clear a newer route", () => {
  const providerSource = fs.readFileSync(path.join(root, "src/components/stampy/StampyContextProvider.tsx"), "utf8");

  assert.match(providerSource, /screenContextOwnerRef\.current = ownerId/);
  assert.match(providerSource, /if \(screenContextOwnerRef\.current !== ownerId\) return/);
  assert.match(providerSource, /useEffect\(\(\) => \(\) => \{[\s\S]*clearScreenContext\(ownerId\)/);
});
