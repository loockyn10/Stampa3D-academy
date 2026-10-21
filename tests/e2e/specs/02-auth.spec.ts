import { test, expect, describeAsRole, describeMutating, gotoSettled, currentPath } from "../support/fixtures";
import { credentialsFor, hasCredentials, missingCredentialsReason, BETA_CODE_INVALID, type Role } from "../support/env";
import { loginViaUi } from "../support/auth";

const LOGIN_ERROR_BOX = "form div.text-red-300";

test.describe("[anonymous] login", () => {
  test("renderiza formulario accesible con enlaces a registro y recuperación", async ({ page }) => {
    await gotoSettled(page, "/login");
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAttribute("type", "password");
    await expect(page.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toHaveAttribute("href", "/recuperar-password");
    await expect(page.getByRole("link", { name: "Registrate acá" })).toHaveAttribute("href", /^\/registro/);
  });

  test("botón mostrar/ocultar contraseña alterna el tipo de input", async ({ page }) => {
    await gotoSettled(page, "/login");
    const password = page.getByLabel("Contraseña", { exact: true });
    await page.getByRole("button", { name: "Mostrar contraseña" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Ocultar contraseña" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("submit vacío no navega ni dispara requests de auth (validación nativa)", async ({ page }) => {
    await gotoSettled(page, "/login");
    let authCalls = 0;
    page.on("request", (request) => {
      if (request.url().includes("/auth/v1/token")) authCalls += 1;
    });
    await page.getByRole("button", { name: "Entrar" }).click();
    expect(authCalls).toBe(0);
    await expect(page).toHaveURL(/\/login/);
  });

  test("credenciales inválidas muestran error y liberan el botón", async ({ page, monitor }) => {
    monitor.expectHttp({ status: [400, 422], url: "/auth/v1/token" });
    await gotoSettled(page, "/login");
    await page.getByLabel("Email").fill(`qa-invalid-${Date.now()}@example.invalid`);
    await page.getByLabel("Contraseña", { exact: true }).fill("no-es-una-clave-real");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator(LOGIN_ERROR_BOX)).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled();
    await expect(page).toHaveURL(/\/login/);
  });

  test("QA-005: el error de login está en español (hoy muestra el mensaje crudo de Supabase)", async ({ page, monitor }) => {
    monitor.expectHttp({ status: [400, 422], url: "/auth/v1/token" });
    await gotoSettled(page, "/login");
    await page.getByLabel("Email").fill(`qa-invalid-${Date.now()}@example.invalid`);
    await page.getByLabel("Contraseña", { exact: true }).fill("no-es-una-clave-real");
    await page.getByRole("button", { name: "Entrar" }).click();
    const box = page.locator(LOGIN_ERROR_BOX);
    await expect(box).toBeVisible();
    const text = (await box.innerText()).trim();
    test.fail(/invalid login credentials/i.test(text), "QA-005: mensaje crudo en inglés de Supabase Auth");
    expect(text).not.toMatch(/invalid login credentials/i);
  });

  test("QA-005b: /login?error=auth-callback-failed informa el fallo al usuario", async ({ page }) => {
    await gotoSettled(page, "/login?error=auth-callback-failed");
    const informed = await page.getByText(/no pudimos|falló|enlace|expir/i).count();
    test.fail(informed === 0, "QA-005b: el callback redirige con ?error=... pero /login lo ignora");
    expect(informed).toBeGreaterThan(0);
  });

  test("returnTo externo/protocolo-relativo se neutraliza (open redirect)", async ({ page }) => {
    for (const malicious of ["//evil.example/x", "https://evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      await gotoSettled(page, `/login?returnTo=${encodeURIComponent(malicious)}`);
      const href = await page.getByRole("link", { name: "Registrate acá" }).getAttribute("href");
      expect(href, `returnTo=${malicious}`).toBe(`/registro?returnTo=${encodeURIComponent("/")}`);
    }
  });
});

test.describe("[anonymous] registro (sin enviar el formulario: no se crean cuentas)", () => {
  test("renderiza campos obligatorios y el código Beta opcional", async ({ page }) => {
    await gotoSettled(page, "/registro");
    await expect(page.getByLabel("Nombre completo")).toBeVisible();
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#name")).toHaveAttribute("required", "");
    await expect(page.locator("#email-address")).toHaveAttribute("required", "");
    await expect(page.locator("#password")).toHaveAttribute("required", "");
    const beta = page.locator("#beta-code");
    await expect(beta).toBeVisible();
    await expect(beta).not.toHaveAttribute("required", "");
    await expect(beta).toHaveAttribute("maxlength", /\d+/);
  });

  test("?ref=abc123 precarga el código de referido en mayúsculas", async ({ page }) => {
    await gotoSettled(page, "/registro?ref=abc123");
    await expect(page.locator("#ref-code")).toHaveValue("ABC123");
  });

  test("returnTo=/calculadora cambia el copy a 'Crear cuenta gratis'", async ({ page }) => {
    await gotoSettled(page, "/registro?returnTo=%2Fcalculadora");
    await expect(page.getByRole("heading", { name: "Crear cuenta gratis" })).toBeVisible();
  });

  test("submit vacío no dispara signup", async ({ page }) => {
    await gotoSettled(page, "/registro");
    let signups = 0;
    page.on("request", (request) => {
      if (request.url().includes("/auth/v1/signup")) signups += 1;
    });
    await page.locator("form button[type=submit]").click();
    expect(signups).toBe(0);
  });
});

test.describe("[anonymous] recuperar / actualizar contraseña", () => {
  test("recuperar-password renderiza y exige email", async ({ page }) => {
    await gotoSettled(page, "/recuperar-password");
    await expect(page.getByRole("heading", { name: "Recuperar contraseña" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("required", "");
    await expect(page.getByRole("link", { name: /volver al inicio de sesión/i })).toBeVisible();
  });

  test("actualizar-password valida largo mínimo y coincidencia en cliente", async ({ page }) => {
    await gotoSettled(page, "/actualizar-password");
    const first = page.getByLabel("Nueva contraseña", { exact: true });
    const second = page.getByLabel("Repetir nueva contraseña");
    await first.fill("123");
    await second.fill("123");
    await page.locator("form button[type=submit]").click();
    await expect(page.getByText(/al menos 6 caracteres/)).toBeVisible();
    await first.fill("abcdef1");
    await second.fill("abcdef2");
    await page.locator("form button[type=submit]").click();
    await expect(page.getByText(/no coincide/)).toBeVisible();
  });

  test("QA-005c: sin sesión de recuperación, actualizar-password no muestra mensajes crudos en inglés", async ({ page }) => {
    await gotoSettled(page, "/actualizar-password");
    await page.getByLabel("Nueva contraseña", { exact: true }).fill("abcdef12");
    await page.getByLabel("Repetir nueva contraseña").fill("abcdef12");
    await page.locator("form button[type=submit]").click();
    const feedback = page.locator("form div.text-red-600");
    await expect(feedback).toBeVisible();
    const text = (await feedback.innerText()).trim();
    test.fail(/session missing|auth/i.test(text), "QA-005c: no valida que exista sesión de recuperación y muestra el error crudo");
    expect(text).not.toMatch(/session missing|auth/i);
  });
});

test.describe("[anonymous] rutas de sesión", () => {
  test("/salir sin sesión termina en /login", async ({ page }) => {
    await gotoSettled(page, "/salir");
    await expect(page).toHaveURL(/\/login/);
  });
});

/** Un login de UI por rol, SIN storageState previo: prueba el flujo real y el destino post-login. */
for (const role of ["free", "beta", "paid", "admin"] as Role[]) {
  test.describe(`[${role}] login por UI`, () => {
    test.skip(!hasCredentials(role), missingCredentialsReason(role));

    test("entra, aterriza donde corresponde y la sesión persiste tras recargar", async ({ page }) => {
      await loginViaUi(page, credentialsFor(role)!);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      const landing = currentPath(page).split("?")[0];
      if (role === "free") expect(landing).toBe("/sin-acceso");
      else expect(["/", "/onboarding"]).toContain(landing);

      await page.reload();
      expect(currentPath(page).split("?")[0], "tras recargar no debe perder la sesión").toBe(landing);
    });

    test("con sesión, /login y /registro redirigen fuera", async ({ page }) => {
      await loginViaUi(page, credentialsFor(role)!);
      for (const path of ["/login", "/registro"]) {
        await gotoSettled(page, path);
        expect(currentPath(page), `${path} con sesión`).not.toMatch(/^\/(login|registro)/);
      }
    });

    test("logout por /salir limpia la sesión y vuelve a proteger rutas", async ({ page }) => {
      await loginViaUi(page, credentialsFor(role)!);
      await gotoSettled(page, "/salir");
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
      await gotoSettled(page, "/perfil");
      await expect(page).toHaveURL(/\/login/);
      await gotoSettled(page, "/mi-negocio");
      await expect(page).toHaveURL(/\/login/);
    });
  });
}

describeAsRole("free", "Free: /sin-acceso", () => {
  test("ofrece canje de código, refrescar acceso y logout; no regala acceso por estar autenticado", async ({ page }) => {
    await gotoSettled(page, "/sin-acceso");
    await expect(page.getByRole("heading", { name: /Tu cuenta está lista|Desbloqueá/ })).toBeVisible();
    await expect(page.getByLabel("Código de invitación")).toBeVisible();
    await expect(page.getByRole("button", { name: "Activar acceso" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Actualizar acceso" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await page.getByRole("button", { name: "Actualizar acceso" }).click();
    await expect(page.getByText("Tu acceso todavía no está activo.")).toBeVisible();
    await expect(page).toHaveURL(/\/sin-acceso/);
  });

  test("código vacío muestra validación sin llamar al servidor", async ({ page }) => {
    await gotoSettled(page, "/sin-acceso");
    await page.getByRole("button", { name: "Activar acceso" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /código/i })).toBeVisible();
  });
});

describeMutating("free", "Free: código Beta inválido", () => {
  test("rechaza el código sin otorgar acceso ni romper la sesión", async ({ page }) => {
    await gotoSettled(page, "/sin-acceso");
    await page.getByLabel("Código de invitación").fill(BETA_CODE_INVALID);
    await page.getByRole("button", { name: "Activar acceso" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await gotoSettled(page, "/mi-negocio");
    await expect(page).toHaveURL(/\/sin-acceso/);
  });
});
