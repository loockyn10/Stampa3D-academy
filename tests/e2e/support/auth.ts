import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { Credentials } from "./env";

/** Login por UI real (labels visibles). Devuelve tras la redirección post-login. */
export async function loginViaUi(page: Page, credentials: Credentials, returnTo = "/") {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

export async function expectOnLogin(page: Page) {
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
}
