import { test, expect, describeAsRole, describeMutating, gotoSettled } from "../support/fixtures";
import { BETA_CODE_VALID, BETA_CODE_INVALID } from "../support/env";

const NIL_UUID = "00000000-0000-4000-8000-000000000000";

for (const role of ["paid", "beta"] as const) {
  describeAsRole(role, "Academia", () => {
    test("listado de cursos: cards con enlace, o estado vacío; sin errores", async ({ page }) => {
      await gotoSettled(page, "/academia");
      await expect(page.getByRole("heading").first()).toBeVisible();
      await gotoSettled(page, "/cursos");
      const courseLinks = page.locator('a[href^="/cursos/"]');
      if ((await courseLinks.count()) === 0) {
        await expect(page.locator("main")).toContainText(/no hay|todavía|próximamente|sin cursos/i);
      }
    });

    test("curso → clase: reproductor/estado, progreso coherente (0–100%) y navegación entre clases", async ({ page }) => {
      await gotoSettled(page, "/cursos");
      const first = page.locator('a[href^="/cursos/"]').first();
      test.skip((await first.count()) === 0, "no hay cursos publicados");
      await first.click();
      await expect(page).toHaveURL(/\/cursos\/[^/?]+/);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      const percent = page.getByText(/^\d{1,3}%$/).first();
      if (await percent.count()) {
        const value = Number((await percent.innerText()).replace("%", ""));
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      const next = page.getByRole("button", { name: /Siguiente clase/ });
      if (await next.count()) {
        await next.click();
        await expect(page.locator("main")).not.toContainText(/undefined|NaN/);
      }
    });

    test("curso inexistente: estado entendible, sin trazas", async ({ page, monitor }) => {
      monitor.expectHttp({ status: [400, 404, 406] });
      await gotoSettled(page, `/cursos/${NIL_UUID}`);
      await expect(page.locator("body")).not.toContainText(/PGRST|invalid input syntax|TypeError|undefined/i);
    });

    test("Talleres, Sorteos y Stampa Maker cargan", async ({ page }) => {
      for (const path of ["/talleres", "/sorteos", "/stampa-maker", "/stampa-maker/carteles", "/stampa-maker/neon"]) {
        const response = await gotoSettled(page, path);
        expect(response?.status(), path).toBeLessThan(400);
      }
    });

    test("Stampa Maker Jarros es solo Admin: usuarios comunes vuelven a /stampa-maker", async ({ page }) => {
      await gotoSettled(page, "/stampa-maker/jarros");
      await expect(page).toHaveURL(/\/stampa-maker$/);
    });
  });
}

describeMutating("paid", "Academia: progreso", () => {
  test("marcar completada es idempotente y persiste tras recargar", async ({ page }) => {
    await gotoSettled(page, "/cursos");
    const first = page.locator('a[href^="/cursos/"]').first();
    test.skip((await first.count()) === 0, "no hay cursos publicados");
    await first.click();
    const toggle = page.getByRole("button", { name: /Marcar completada|Completada/ }).first();
    test.skip((await toggle.count()) === 0, "el curso no tiene clases");
    const wasCompleted = /^Completada$/.test((await toggle.innerText()).trim());
    await toggle.click();
    await page.reload();
    const after = page.getByRole("button", { name: /Marcar completada|Completada/ }).first();
    expect(/^Completada$/.test((await after.innerText()).trim())).toBe(!wasCompleted);
    await after.click(); // restaurar
  });
});

describeAsRole("beta", "Beta ACTIVA: acceso completo sin confundirse con Paid", () => {
  test("Perfil muestra 'Beta Tester' y aclara que no es una suscripción; no ofrece canjear de nuevo", async ({ page }) => {
    await gotoSettled(page, "/perfil");
    await expect(page.getByText(/Beta Tester/).first()).toBeVisible();
    await expect(page.getByText(/No es una suscripción/)).toBeVisible();
    await expect(page.getByText(/Plan Premium|Premium/)).toHaveCount(0);
    await expect(page.getByText("Canjear código de invitación")).toHaveCount(0);
  });

  test("tiene acceso completo tras recargar y tras volver a entrar (sesión persistida)", async ({ page }) => {
    for (const path of ["/", "/mi-taller/impresoras", "/mi-negocio", "/academia", "/stampy"]) {
      await gotoSettled(page, path);
      await page.reload();
      await expect(page, path).not.toHaveURL(/sin-acceso|login/);
    }
  });

  test("Beta NO ve el panel de administración", async ({ page }) => {
    await gotoSettled(page, "/admin");
    await expect(page).not.toHaveURL(/\/admin/);
  });
});

describeAsRole("free", "Free: Perfil", () => {
  test("Perfil ofrece canje de código y no muestra Beta/Premium", async ({ page }) => {
    await gotoSettled(page, "/perfil");
    await expect(page.getByText("Canjear código de invitación")).toBeVisible();
    await expect(page.getByText(/Beta Tester/)).toHaveCount(0);
  });

  test("canje con código vacío valida en cliente", async ({ page }) => {
    await gotoSettled(page, "/perfil");
    await page.getByRole("button", { name: "Canjear" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
  });
});

describeMutating("free", "Beta: canje (solo entornos descartables)", () => {
  test("código inválido: error entendible, sigue Free, la UI no confunde Beta con Premium", async ({ page }) => {
    await gotoSettled(page, "/perfil");
    await page.getByLabel("Código de invitación").fill(BETA_CODE_INVALID);
    await page.getByRole("button", { name: "Canjear" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await gotoSettled(page, "/mi-negocio");
    await expect(page).toHaveURL(/\/sin-acceso/);
  });

  test("código válido: acceso inmediato, persiste tras recargar y la UI dice Beta (no Premium)", async ({ page }) => {
    test.skip(!BETA_CODE_VALID, "definir E2E_BETA_CODE_VALID (un código de un solo uso de un entorno descartable)");
    await gotoSettled(page, "/perfil");
    await page.getByLabel("Código de invitación").fill(BETA_CODE_VALID!);
    await page.getByRole("button", { name: "Canjear" }).click();
    await expect(page.getByRole("status").first()).toBeVisible();
    await page.waitForURL(/\/perfil/);
    await page.reload();
    await expect(page.getByText(/Beta Tester/).first()).toBeVisible();
    await gotoSettled(page, "/mi-negocio");
    await expect(page).toHaveURL(/\/mi-negocio/);
  });
});

for (const role of ["betaExpired", "betaRevoked"] as const) {
  describeAsRole(role, "sin acceso por Beta vencida/revocada", () => {
    test("se comporta como Free: /sin-acceso en rutas de plataforma, Calculadora disponible", async ({ page }) => {
      await gotoSettled(page, "/mi-negocio");
      await expect(page).toHaveURL(/\/sin-acceso/);
      await gotoSettled(page, "/calculadora");
      await expect(page).toHaveURL(/\/calculadora/);
    });

    test("Perfil no muestra 'Beta Tester' activo", async ({ page }) => {
      await gotoSettled(page, "/perfil");
      await expect(page.getByText(/Acceso Beta Tester/)).toHaveCount(0);
    });
  });
}
