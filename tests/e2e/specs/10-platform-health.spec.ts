import type { Page } from "@playwright/test";
import { test, expect, describeAsRole, gotoSettled, currentPath } from "../support/fixtures";
import { ROUTES } from "../support/routes";
import type { Role } from "../support/env";

/**
 * "Salud" de cada pantalla de plataforma con una cuenta con acceso (Paid / Beta / Admin):
 * carga, no queda en loading infinito, sin errores de backend en pantalla, sin NaN/Infinity/undefined,
 * y sin errores de consola ni requests 4xx/5xx inesperadas (monitor estricto).
 */
const BAD_RENDERED_TEXT = /\bNaN\b|\bInfinity\b|\bundefined\b|\[object Object\]|invalid input syntax|PGRST\d+|violates (row-level|foreign|check)|permission denied for/i;

async function expectHealthyPage(page: Page, path: string) {
  const response = await gotoSettled(page, path);
  expect(response?.status(), `status de ${path}`).toBeLessThan(400);
  await expect(page.getByText(/Application error|Internal Server Error|This page couldn.t load/i)).toHaveCount(0);

  // Loading infinito: tras la espera de red no deben quedar skeletons animados ni spinners de carga de página.
  await expect
    .poll(async () => page.locator("main .animate-pulse, main [aria-busy='true']").count(), {
      message: `${path} sigue mostrando skeletons/aria-busy (loading infinito)`,
      timeout: 20_000,
    })
    .toBe(0);

  const body = await page.locator("body").innerText();
  expect(body, `${path} muestra texto inválido`).not.toMatch(BAD_RENDERED_TEXT);
  await expect(page.locator("h1, h2").first(), `${path} sin encabezado`).toBeVisible();
}

const MEMBER_ROUTES = ROUTES.filter((route) => route.tier === "member" && !route.finalPath && route.path !== "/");

for (const role of ["paid", "beta", "admin"] as Role[]) {
  describeAsRole(role, "salud de pantallas de plataforma", () => {
    test("/ (Inicio) carga y no se redirige a /sin-acceso", async ({ page }) => {
      await expectHealthyPage(page, "/");
      expect(currentPath(page)).not.toMatch(/sin-acceso|login/);
    });

    for (const route of MEMBER_ROUTES) {
      test(`${route.path} está sana`, async ({ page }) => {
        await expectHealthyPage(page, route.path);
        expect(currentPath(page).split("?")[0]).toBe(route.path);
      });
    }
  });
}

describeAsRole("admin", "salud de pantallas de Admin", () => {
  for (const route of ROUTES.filter((candidate) => candidate.tier === "admin")) {
    test(`${route.path} está sana`, async ({ page }) => {
      await expectHealthyPage(page, route.path);
      expect(currentPath(page).split("?")[0]).toBe(route.path);
    });
  }
});

describeAsRole("free", "salud de pantallas accesibles para Free", () => {
  for (const path of ["/calculadora", "/perfil", "/explorar-modelos", "/sin-acceso"]) {
    test(`${path} está sana`, async ({ page }) => {
      await expectHealthyPage(page, path);
    });
  }
});
