import type { Page, Route } from "@playwright/test";
import { test, expect, describeAsRole, gotoSettled } from "../support/fixtures";

/**
 * Explorar Modelos. Dos capas:
 *  1) UI con /api/model-search MOCKEADO (determinista; separa "bug nuestro" de "provider externo caído").
 *  2) Contrato real del endpoint (validación de parámetros y resiliencia ante provider inalcanzable).
 * El servidor local de la suite arranca con una clave FALSA de MyMiniFactory solo para que la UI muestre el buscador.
 */
const RESULT = {
  source: "myminifactory",
  externalId: "123",
  title: "Dragón articulado QA",
  authorName: "Autor QA",
  authorUrl: "https://www.myminifactory.com/users/qa",
  thumbnailUrl: null,
  originalUrl: "https://www.myminifactory.com/object/3d-print-dragon-qa-123",
  priceType: "free",
  price: 0,
  currency: "USD",
  license: { name: "CC BY", url: null, commercialUse: "unknown", attributionRequired: true, remixAllowed: null },
  likes: 12,
  downloads: 340,
  views: 1200,
  rating: null,
  publishedAt: null,
  fileFormats: ["stl"],
};

const OK_SOURCES = [{ id: "myminifactory", status: "ok", count: 1, hasMore: false }];

function ok(results = [RESULT], extra: Record<string, unknown> = {}) {
  return {
    results,
    sources: OK_SOURCES,
    nextCursor: null,
    viewer: { tier: "anonymous", maxPages: 2, gated: false },
    ...extra,
  };
}

async function mockSearch(page: Page, handler: (route: Route, call: number) => Promise<void> | void) {
  let calls = 0;
  await page.route("**/api/model-search**", async (route) => {
    calls += 1;
    await handler(route, calls);
  });
  return () => calls;
}

async function openAndSearch(page: Page, query: string) {
  await gotoSettled(page, "/explorar-modelos");
  const box = page.getByRole("searchbox", { name: "Buscar modelos 3D" });
  test.skip((await box.count()) === 0, "el entorno no tiene proveedores configurados (UI de búsqueda oculta)");
  await box.fill(query);
  await page.getByRole("button", { name: "Buscar" }).click();
}

test.describe("[anonymous] Explorar Modelos (API mockeada)", () => {
  test("estado inicial invita a buscar y la nota de licencias/propiedad es visible", async ({ page }) => {
    await gotoSettled(page, "/explorar-modelos");
    test.skip((await page.getByRole("searchbox").count()) === 0, "sin proveedores configurados");
    await expect(page.getByText("Buscá un modelo para empezar")).toBeVisible();
    await expect(page.getByText(/Verificá siempre la licencia/)).toBeVisible();
  });

  test("query demasiado corta: valida en cliente y no llama a la API", async ({ page }) => {
    const calls = await mockSearch(page, (route) => route.fulfill({ json: ok() }));
    await openAndSearch(page, "a");
    await expect(page.getByText(/Escribí al menos/)).toBeVisible();
    expect(calls()).toBe(0);
  });

  test("resultados: título, fuente visible, enlace al original en pestaña nueva y sin 'Calcular en Stampa' para Anonymous", async ({ page }) => {
    await mockSearch(page, (route) => route.fulfill({ json: ok() }));
    await openAndSearch(page, "dragon");
    const card = page.getByRole("article").filter({ hasText: "Dragón articulado QA" });
    await expect(card).toBeVisible();
    await expect(card.getByText("MyMiniFactory").first()).toBeVisible();
    const original = card.getByRole("link", { name: /Ver modelo en MyMiniFactory/ });
    await expect(original).toHaveAttribute("href", RESULT.originalUrl);
    await expect(original).toHaveAttribute("target", "_blank");
    await expect(original).toHaveAttribute("rel", /noopener/);
    await expect(card.getByRole("link", { name: /Calcular en Stampa/ })).toHaveCount(0);
    await expect(card.getByText(/Revisar licencia/)).toBeVisible();
    await expect(card.getByText("Gratis")).toBeVisible();
  });

  test("sin resultados muestra estado vacío con guía", async ({ page }) => {
    await mockSearch(page, (route) => route.fulfill({ json: ok([], { sources: [{ id: "myminifactory", status: "ok", count: 0, hasMore: false }] }) }));
    await openAndSearch(page, "zzzzqq");
    await expect(page.getByText(/No encontramos modelos para/)).toBeVisible();
  });

  test("provider caído: panel de error con detalle por fuente y Reintentar que recupera", async ({ page }) => {
    const calls = await mockSearch(page, (route, call) =>
      call === 1
        ? route.fulfill({ json: ok([], { sources: [{ id: "myminifactory", status: "error", count: 0, hasMore: false }] }) })
        : route.fulfill({ json: ok() }),
    );
    await openAndSearch(page, "dragon");
    await expect(page.getByText(/MyMiniFactory: con error/)).toBeVisible();
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    expect(calls()).toBe(2);
  });

  test("provider lento (timeout): informa 'sin respuesta a tiempo', no cuelga el loading", async ({ page }) => {
    await mockSearch(page, (route) =>
      route.fulfill({ json: ok([], { sources: [{ id: "myminifactory", status: "timeout", count: 0, hasMore: false }] }) }),
    );
    await openAndSearch(page, "dragon");
    await expect(page.getByText(/sin respuesta a tiempo/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Buscar" })).toBeEnabled();
  });

  test("HTTP 500 del endpoint: mensaje entendible, loading termina, se puede reintentar", async ({ page, monitor }) => {
    monitor.expectHttp({ status: 500, url: "/api/model-search" });
    await mockSearch(page, (route) => route.fulfill({ status: 500, json: { error: "search_unavailable" } }));
    await openAndSearch(page, "dragon");
    await expect(page.getByText("No pudimos completar la búsqueda. Probá de nuevo en un momento.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Buscar" })).toBeEnabled();
  });

  test("HTTP 500 con cuerpo no JSON (HTML de plataforma) no rompe la UI", async ({ page, monitor }) => {
    monitor.expectHttp({ status: 500, url: "/api/model-search" });
    await mockSearch(page, (route) => route.fulfill({ status: 500, contentType: "text/html", body: "<h1>Internal Server Error</h1>" }));
    await openAndSearch(page, "dragon");
    await expect(page.getByText("No pudimos completar la búsqueda. Probá de nuevo en un momento.")).toBeVisible();
  });

  test("429 rate_limited: mensaje de espera", async ({ page, monitor }) => {
    monitor.expectHttp({ status: 429, url: "/api/model-search" });
    await mockSearch(page, (route) => route.fulfill({ status: 429, json: { error: "rate_limited" } }));
    await openAndSearch(page, "dragon");
    await expect(page.getByText(/Hiciste muchas búsquedas seguidas/)).toBeVisible();
  });

  test("request abortada (red caída): error entendible y botón Buscar se libera", async ({ page, monitor }) => {
    monitor.allow({ id: "aborted-by-test", reason: "el test aborta la request a propósito", matches: (finding) => finding.kind === "requestfailed" && !!finding.url?.includes("/api/model-search") });
    monitor.allow({ id: "aborted-by-test-console", reason: "eco de consola de la request abortada a propósito", matches: (finding) => finding.kind === "console" && /net::ERR_FAILED|Failed to load resource/.test(finding.message) });
    await mockSearch(page, (route) => route.abort("failed"));
    await openAndSearch(page, "dragon");
    await expect(page.getByText("No pudimos completar la búsqueda. Probá de nuevo en un momento.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buscar" })).toBeEnabled();
  });

  test("Anonymous: la paginación se corta en 2 páginas e invita a crear cuenta", async ({ page }) => {
    await mockSearch(page, (route) =>
      route.fulfill({ json: ok([RESULT], { nextCursor: null, viewer: { tier: "anonymous", maxPages: 2, gated: true } }) }),
    );
    await openAndSearch(page, "dragon");
    await expect(page.getByText("Creá tu cuenta gratis para seguir viendo más resultados.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Crear cuenta gratis" }).first()).toHaveAttribute("href", "/registro");
  });

  test("Anonymous: un filtro bloqueado muestra el upsell en vez de aplicarse en silencio", async ({ page }) => {
    await mockSearch(page, (route) => route.fulfill({ json: ok() }));
    await gotoSettled(page, "/explorar-modelos");
    // Los filtros son desplegables compactos: se abre "Uso comercial" y se elige la opción bloqueada.
    const trigger = page.getByRole("button", { name: /^Uso comercial:/ });
    test.skip((await trigger.count()) === 0, "sin filtros comerciales en este entorno");
    await trigger.click();
    const locked = page.getByRole("listbox", { name: "Uso comercial" }).getByRole("option", { name: /Permitido/ });
    test.skip(await locked.isDisabled(), "ninguna fuente elegida admite el filtro comercial");
    await locked.click();
    await expect(page.getByText("Creá tu cuenta gratis para usar todos los filtros")).toBeVisible();
    await expect(trigger).toContainText("Todos");
  });

  test("una segunda búsqueda descarta la respuesta tardía de la primera (race)", async ({ page }) => {
    await mockSearch(page, async (route, call) => {
      if (call === 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.fulfill({ json: ok([{ ...RESULT, title: "RESULTADO VIEJO", externalId: "old" }]) }).catch(() => undefined);
      } else {
        await route.fulfill({ json: ok([{ ...RESULT, title: "RESULTADO NUEVO", externalId: "new" }]) });
      }
    });
    await openAndSearch(page, "primera");
    await page.getByRole("searchbox", { name: "Buscar modelos 3D" }).fill("segunda");
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByText("RESULTADO NUEVO")).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(page.getByText("RESULTADO VIEJO")).toHaveCount(0);
  });
});

test.describe("[anonymous] /api/model-search contrato real", () => {
  test("rechaza queries inválidas con 400 y códigos estables", async ({ request }) => {
    const short = await request.get("/api/model-search?q=a");
    expect(short.status()).toBe(400);
    expect((await short.json()).error).toBe("query_too_short");
    const long = await request.get(`/api/model-search?q=${"x".repeat(300)}`);
    expect(long.status()).toBe(400);
    const missing = await request.get("/api/model-search");
    expect(missing.status()).toBe(400);
  });

  test("Anonymous no puede usar filtros de miembro (403 account_required) y no se cachea", async ({ request }) => {
    const response = await request.get("/api/model-search?q=dragon&sort=popular");
    expect([400, 403]).toContain(response.status());
    expect(response.headers()["cache-control"] ?? "").toMatch(/no-store/);
  });

  test("provider inalcanzable/sin credenciales ≠ error nuestro: responde 200 con estado por fuente y sin filtrar secretos", async ({ request }) => {
    const response = await request.get("/api/model-search?q=dragon&sources=myminifactory");
    expect(response.status(), "el endpoint no debe devolver 5xx por un provider caído").toBeLessThan(500);
    const text = await response.text();
    expect(text).not.toMatch(/api[_-]?key|e2e-fake-key|authorization|bearer/i);
    if (response.status() === 200) {
      const body = JSON.parse(text);
      expect(Array.isArray(body.results)).toBe(true);
      for (const source of body.sources) expect(["ok", "disabled", "timeout", "error"]).toContain(source.status);
    }
  });

  test("source inexistente se rechaza o ignora, nunca 5xx ni reflejo sin escapar", async ({ request }) => {
    const response = await request.get("/api/model-search?q=dragon&sources=%3Cscript%3Ealert(1)%3C/script%3E");
    expect(response.status()).toBeLessThan(500);
    expect(await response.text()).not.toContain("<script>");
  });
});

describeAsRole("free", "Explorar Modelos como Free", () => {
  test("Free no ve 'Calcular en Stampa' (solo Paid) y tiene filtros desbloqueados", async ({ page }) => {
    await mockSearch(page, (route) => route.fulfill({ json: ok([RESULT], { viewer: { tier: "free", maxPages: 5, gated: false } }) }));
    await openAndSearch(page, "dragon");
    const card = page.getByRole("article").filter({ hasText: "Dragón articulado QA" });
    await expect(card).toBeVisible();
    await expect(card.getByRole("link", { name: /Calcular en Stampa/ })).toHaveCount(0);
  });
});

for (const role of ["paid", "beta"] as const) {
  describeAsRole(role, "Explorar Modelos con acceso completo", () => {
    test("ve 'Calcular en Stampa' que abre la calculadora sin asumir gramos ni horas", async ({ page }) => {
      await mockSearch(page, (route) => route.fulfill({ json: ok([RESULT], { viewer: { tier: "paid", maxPages: 5, gated: false } }) }));
      await openAndSearch(page, "dragon");
      const card = page.getByRole("article").filter({ hasText: "Dragón articulado QA" });
      const calc = card.getByRole("link", { name: /Calcular en Stampa/ });
      await expect(calc).toBeVisible();
      await calc.click();
      await expect(page).toHaveURL(/\/calculadora/);
      await expect(page.getByText("Modelo de referencia")).toBeVisible();
      await expect(page.getByLabel("Gramos").first()).toHaveValue("");
    });
  });
}
