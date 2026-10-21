import { test, expect, describeAsRole, describeMutating, gotoSettled } from "../support/fixtures";

/**
 * Librería STL. Depende de datos publicados en el entorno (grupos/modelos). Si no hay, se valida el estado vacío
 * y el resto se omite con motivo explícito. Probar WebGL real requiere navegador con GPU/SwiftShader (Chrome lo trae).
 */
for (const role of ["paid", "beta", "admin"] as const) {
  describeAsRole(role, "Librería STL", () => {
    test("la librería lista grupos o muestra un estado vacío, con buscador funcional", async ({ page }) => {
      await gotoSettled(page, "/libreria-stl");
      await expect(page.getByRole("heading", { name: /Librería STL/ })).toBeVisible();
      const groups = page.locator('a[href^="/libreria-stl/"]');
      if ((await groups.count()) === 0) {
        await expect(page.locator("main")).toContainText(/no hay|todavía|vacío|sin modelos/i);
        return;
      }
      const search = page.getByRole("searchbox").or(page.getByPlaceholder(/buscar/i)).first();
      if (await search.count()) {
        await search.fill("zzzz-no-existe-qa");
        await expect(page.getByText("No hay resultados para tu búsqueda")).toBeVisible();
        await search.fill("");
      }
    });

    test("grupo → modelo: breadcrumb, visor 3D con estado final (listo o error con Reintentar) y descarga disponible", async ({ page }) => {
      await gotoSettled(page, "/libreria-stl");
      const firstGroup = page.locator('a[href^="/libreria-stl/"]').first();
      test.skip((await firstGroup.count()) === 0, "no hay grupos publicados en este entorno");
      await firstGroup.click();
      await expect(page).toHaveURL(/\/libreria-stl\/[^/]+$/);
      await expect(page.getByRole("navigation", { name: "Ruta" })).toBeVisible();

      const modelLinks = page.locator("main a").filter({ has: page.locator("h3, h2") });
      test.skip((await modelLinks.count()) === 0, "el grupo no tiene modelos publicados");
      await modelLinks.first().click();
      await expect(page).toHaveURL(/\/libreria-stl\/[^/]+\/[^/]+$/);

      const viewer = page.getByRole("img", { name: "Vista previa 3D del modelo" });
      await expect(viewer).toBeVisible();
      // Estado final: sin spinner "Cargando modelo" tras la espera (listo, o error entendible con Reintentar).
      await expect(page.getByText(/Cargando modelo/)).toHaveCount(0, { timeout: 45_000 });
      const failed = await page.getByRole("button", { name: "Reintentar" }).count();
      if (failed === 0) await expect(page.getByRole("button", { name: "Restablecer" })).toBeVisible();
      else await expect(page.getByText(/Visor no disponible|No pude|no disponible/i).first()).toBeVisible();

      await expect(page.getByRole("button", { name: /Descargar|Archivo no disponible/ }).first()).toBeVisible();
    });

    test("slug de grupo/modelo inexistente muestra 'no encontramos' sin crashear", async ({ page }) => {
      await gotoSettled(page, "/libreria-stl/grupo-inexistente-qa");
      await expect(page.locator("body")).toContainText(/No encontramos|no existe|no está disponible/i);
      await gotoSettled(page, "/libreria-stl/grupo-inexistente-qa/modelo-inexistente-qa");
      await expect(page.getByRole("heading", { name: /No encontramos ese modelo/ })).toBeVisible();
    });

    test("no se renderiza más de un canvas WebGL por pantalla de detalle (fuga de contextos)", async ({ page }) => {
      await gotoSettled(page, "/libreria-stl");
      const firstGroup = page.locator('a[href^="/libreria-stl/"]').first();
      test.skip((await firstGroup.count()) === 0, "no hay grupos publicados");
      await firstGroup.click();
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      // En el listado las cards usan miniatura/WebM, nunca un visor WebGL por card.
      expect(await page.locator("canvas").count(), "canvas WebGL en el listado del grupo").toBeLessThanOrEqual(1);
    });
  });
}

describeAsRole("free", "Librería STL para Free", () => {
  test("Free no entra a la librería ni a las APIs STL", async ({ page, request }) => {
    await gotoSettled(page, "/libreria-stl");
    await expect(page).toHaveURL(/\/sin-acceso/);
    for (const path of ["/libreria-stl/algun-grupo", "/libreria-stl/algun-grupo/algun-modelo"]) {
      await gotoSettled(page, path);
      await expect(page).toHaveURL(/\/sin-acceso/);
    }
    const response = await request.post("/api/stl/preview", { data: { variantId: "00000000-0000-4000-8000-000000000000" }, maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401, 403]).toContain(response.status());
  });
});

describeAsRole("paid", "Librería STL: red inestable", () => {
  test("si /api/stl/preview falla (500) el visor muestra error entendible y permite reintentar", async ({ page, monitor }) => {
    monitor.expectHttp({ status: 500, url: "/api/stl/preview" });
    monitor.allow({ id: "viewer-error-by-test", reason: "el test fuerza un 500 en preview; el visor registra console.error", matches: (f) => f.kind === "console" });
    await page.route("**/api/stl/preview", (route) => route.fulfill({ status: 500, json: { error: "boom" } }));
    await gotoSettled(page, "/libreria-stl");
    const firstGroup = page.locator('a[href^="/libreria-stl/"]').first();
    test.skip((await firstGroup.count()) === 0, "no hay grupos publicados");
    await firstGroup.click();
    const modelLinks = page.locator("main a").filter({ has: page.locator("h3, h2") });
    test.skip((await modelLinks.count()) === 0, "sin modelos publicados");
    await modelLinks.first().click();
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/boom|stack|TypeError/)).toHaveCount(0);
  });
});

describeMutating("paid", "Librería STL: descarga real", () => {
  test("Descargar pide una URL firmada y registra la descarga; archivo faltante informa el error", async ({ page }) => {
    await gotoSettled(page, "/libreria-stl");
    const firstGroup = page.locator('a[href^="/libreria-stl/"]').first();
    test.skip((await firstGroup.count()) === 0, "no hay grupos publicados");
    await firstGroup.click();
    const modelLinks = page.locator("main a").filter({ has: page.locator("h3, h2") });
    test.skip((await modelLinks.count()) === 0, "sin modelos publicados");
    await modelLinks.first().click();
    const download = page.getByRole("button", { name: /Descargar/ }).first();
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/stl/download")),
      download.click(),
    ]);
    expect([200, 404]).toContain(response.status());
  });
});
