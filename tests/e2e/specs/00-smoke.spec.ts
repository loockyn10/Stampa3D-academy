import { test, expect, gotoSettled, currentPath } from "../support/fixtures";

/**
 * Smoke global SIN credenciales (Anonymous). Cada página pública debe:
 * responder < 400, renderizar contenido, no lanzar excepciones JS y no generar console.error
 * ni requests 4xx/5xx inesperadas (el monitor lo exige en cada test).
 */
const PUBLIC_PAGES: Array<{ path: string; heading?: RegExp }> = [
  { path: "/login", heading: /Iniciar sesión/ },
  { path: "/registro", heading: /Crear cuenta/ },
  { path: "/recuperar-password" },
  { path: "/calculadora" },
  { path: "/explorar-modelos" },
  { path: "/landing" },
];

for (const { path, heading } of PUBLIC_PAGES) {
  test(`smoke público: ${path} renderiza sin errores`, async ({ page }) => {
    const response = await gotoSettled(page, path);
    expect(response?.status(), `status de ${path}`).toBeLessThan(400);
    expect(currentPath(page).split("?")[0]).toBe(path);
    await expect(page.locator("body")).not.toBeEmpty();
    if (heading) await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    // Next muestra este texto cuando una página revienta en el server/cliente.
    await expect(page.getByText(/Application error|Internal Server Error|This page couldn.t load/i)).toHaveCount(0);
  });
}

test("smoke: la raíz sin sesión redirige a /login", async ({ page }) => {
  await gotoSettled(page, "/");
  await expect(page).toHaveURL(/\/login/);
});

test("smoke: manifest, favicon y assets estáticos principales cargan", async ({ request }) => {
  for (const asset of ["/manifest.webmanifest", "/favicon.svg"]) {
    const response = await request.get(asset);
    expect(response.status(), asset).toBe(200);
  }
});

test("smoke: ruta inexistente muestra 404 y no crashea", async ({ page, monitor }) => {
  monitor.expectHttp({ status: 404, url: "/esta-ruta-no-existe-qa" });
  const response = await page.goto("/esta-ruta-no-existe-qa");
  // Anonymous: el middleware default-deny redirige a /login antes del 404; ambos son válidos pero deben ser 2xx/404.
  expect([200, 404]).toContain(response?.status());
  await expect(page.getByText(/Application error|Internal Server Error/i)).toHaveCount(0);
});
