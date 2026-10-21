import { test, expect, gotoSettled } from "../support/fixtures";

/**
 * Fallas de red simuladas con route(): la UI no debe crashear, el loading debe terminar,
 * el mensaje debe ser entendible y, cuando corresponde, ofrecer reintento.
 */
const CALC_ERROR_TITLE = "No pudimos cargar la configuración de cálculo.";

test.describe("[anonymous] Calculadora ante fallas de la API de catálogo", () => {
  test("500: muestra error con Reintentar y recupera al volver la API", async ({ page, monitor }) => {
    monitor.expectHttp({ status: 500, url: "/api/calculator/catalog" });
    let failing = true;
    await page.route("**/api/calculator/catalog", (route) => (failing ? route.fulfill({ status: 500, json: { error: "boom" } }) : route.continue()));
    await gotoSettled(page, "/calculadora");
    await expect(page.getByRole("heading", { name: CALC_ERROR_TITLE })).toBeVisible();
    await expect(page.getByText(/boom|stack|PGRST/i)).toHaveCount(0);
    failing = false;
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByRole("heading", { name: "Calculadora de precios" })).toBeVisible();
  });

  test("request abortada: mismo manejo, sin pantalla en blanco", async ({ page, monitor }) => {
    monitor.allow({ id: "aborted-by-test", reason: "el test aborta la request a propósito", matches: (f) => f.kind === "requestfailed" && !!f.url?.includes("/api/calculator/catalog") });
    monitor.allow({ id: "aborted-by-test-console", reason: "eco de consola de la request abortada a propósito", matches: (f) => f.kind === "console" && /ERR_FAILED|Failed to load resource|catálogo|catalog/i.test(f.message) });
    await page.route("**/api/calculator/catalog", (route) => route.abort("failed"));
    await gotoSettled(page, "/calculadora");
    await expect(page.getByRole("heading", { name: CALC_ERROR_TITLE })).toBeVisible();
  });

  test("respuesta JSON inválida o vacía no deja el skeleton para siempre", async ({ page, monitor }) => {
    monitor.allow({ id: "bad-json-by-test", reason: "el test devuelve un cuerpo inválido a propósito", matches: (f) => f.kind === "console" || f.kind === "pageerror" });
    await page.route("**/api/calculator/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{not-json" }));
    await gotoSettled(page, "/calculadora");
    await expect(page.getByRole("heading", { name: CALC_ERROR_TITLE })).toBeVisible({ timeout: 15_000 });
  });

  test("API lenta (6 s): muestra skeleton y termina cargando", async ({ page }) => {
    await page.route("**/api/calculator/catalog", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      await route.continue();
    });
    await page.goto("/calculadora", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Calculadora de precios" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Calculadora de precios" })).toBeVisible({ timeout: 20_000 });
  });

  test("catálogo vacío (sin impresoras/filamentos/tipos) no lanza excepciones y la página sigue usable", async ({ page }) => {
    const empty = {
      catalogPrinters: [], catalogFilaments: [], selectedPrinterTemplateIds: [], selectedFilamentTemplateIds: [],
      printers: [], filaments: [], productTypes: [],
      settings: { defaultErrorPercent: 0, electricityPriceKwh: 0, platformCommissionPercent: 0, platformExtraAmount: 0 },
      preferences: null,
    };
    await page.route("**/api/calculator/catalog", (route) => route.fulfill({ json: empty }));
    await gotoSettled(page, "/calculadora");
    await expect(page.getByText(/Application error/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Calculadora de precios" })).toBeVisible();
    await page.getByLabel("Gramos").first().fill("100");
    await expect(page.locator("main")).not.toContainText(/NaN|Infinity/);
  });
});

test.describe("[anonymous] Auth ante fallas de red", () => {
  test("login: Supabase inalcanzable → error entendible y el botón se libera", async ({ page, monitor }) => {
    monitor.allow({ id: "aborted-by-test", reason: "el test aborta el login a propósito", matches: (f) => (f.kind === "requestfailed" || f.kind === "console") && /auth\/v1\/token|ERR_FAILED|Failed to fetch|Failed to load resource/.test(`${f.url ?? ""} ${f.message}`) });
    await page.route("**/auth/v1/token**", (route) => route.abort("failed"));
    await gotoSettled(page, "/login");
    await page.getByLabel("Email").fill("qa@example.invalid");
    await page.getByLabel("Contraseña", { exact: true }).fill("x-no-real");
    await page.getByRole("button", { name: "Entrar" }).click();
    const box = page.locator("form div.text-red-300");
    await expect(box).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled();
    const text = (await box.innerText()).trim();
    test.fail(/failed to fetch|fetch failed|network/i.test(text), "QA-005d: el error de red se muestra crudo en inglés ('Failed to fetch')");
    expect(text).not.toMatch(/failed to fetch|fetch failed|network/i);
  });

  test("login: 500 de Supabase Auth → no crashea, botón liberado", async ({ page, monitor }) => {
    monitor.expectHttp({ status: 500, url: "/auth/v1/token" });
    await page.route("**/auth/v1/token**", (route) => route.fulfill({ status: 500, json: { msg: "internal" } }));
    await gotoSettled(page, "/login");
    await page.getByLabel("Email").fill("qa@example.invalid");
    await page.getByLabel("Contraseña", { exact: true }).fill("x-no-real");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator("form div.text-red-300")).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });

  test("registro: servicio caído → mensaje de conexión, sin crear nada, botón liberado", async ({ page, monitor }) => {
    monitor.allow({ id: "aborted-by-test", reason: "el test aborta el signup a propósito", matches: (f) => (f.kind === "requestfailed" || f.kind === "console") && /auth\/v1\/signup|ERR_FAILED|signup connection failed|Failed to load resource/.test(`${f.url ?? ""} ${f.message}`) });
    await page.route("**/auth/v1/signup**", (route) => route.abort("failed"));
    await gotoSettled(page, "/registro");
    await page.locator("#name").fill("QA Network");
    await page.locator("#email-address").fill("qa-network@example.invalid");
    await page.locator("#password").fill("clave-de-prueba-123");
    await page.locator("form button[type=submit]").click();
    const box = page.locator("form div.text-red-300, form div.text-red-400, form [role=alert]").first();
    await expect(box).toBeVisible();
    await expect(page.locator("form button[type=submit]")).toBeEnabled();
    // supabase-js devuelve { error } (AuthRetryableFetchError) en vez de lanzar: el catch con el mensaje amigable
    // de registro/page.tsx nunca se ejecuta y el usuario ve el texto crudo en inglés.
    const text = (await box.innerText()).trim();
    test.fail(/failed to fetch|fetch failed|network/i.test(text), "QA-005d: el mensaje amigable de conexión es código muerto; se muestra 'Failed to fetch'");
    expect(text).toMatch(/No pudimos conectar|conexión/i);
  });

  test("login: doble clic rápido no dispara dos logins simultáneos", async ({ page, monitor }) => {
    monitor.expectHttp({ status: [400, 422], url: "/auth/v1/token" });
    let tokenCalls = 0;
    await page.route("**/auth/v1/token**", async (route) => {
      tokenCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ status: 400, json: { error: "invalid_grant", error_description: "Invalid login credentials" } });
    });
    await gotoSettled(page, "/login");
    await page.getByLabel("Email").fill("qa@example.invalid");
    await page.getByLabel("Contraseña", { exact: true }).fill("x-no-real");
    const submit = page.getByRole("button", { name: "Entrar" });
    await submit.dblclick();
    await expect(page.locator("form div.text-red-300")).toBeVisible();
    expect(tokenCalls, "doble submit → una sola request").toBe(1);
  });
});
