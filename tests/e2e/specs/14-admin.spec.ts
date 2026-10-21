import { test, expect, describeAsRole, gotoSettled } from "../support/fixtures";

const HUB_LINKS = [
  "/admin/usuarios", "/admin/cursos", "/admin/stl", "/admin/sorteos", "/admin/insignias", "/admin/cursos/configuracion",
  "/admin/impresoras", "/admin/membresia", "/admin/roadmaps", "/admin/calculadora", "/admin/calculadora/filamentos",
  "/admin/codigos", "/admin/stampy", "/admin/stampy/contextos", "/admin/stampy/documentos", "/admin/transcripciones",
];

describeAsRole("admin", "Admin: navegación y consistencia", () => {
  test("el hub enlaza a todas las secciones y ninguna da 404/5xx", async ({ page }) => {
    await gotoSettled(page, "/admin");
    await expect(page.getByRole("heading", { name: "Panel Admin" })).toBeVisible();
    for (const href of HUB_LINKS) {
      await expect(page.locator(`a[href="${href}"]`).first(), `enlace ${href}`).toBeVisible();
    }
    for (const href of HUB_LINKS) {
      const response = await gotoSettled(page, href);
      expect(response?.status(), href).toBeLessThan(400);
      await expect(page.getByText(/Application error|Internal Server Error/)).toHaveCount(0);
    }
  });

  test("Admin conserva acceso a la plataforma y a /admin tras recargar (sin perder privilegios)", async ({ page }) => {
    await gotoSettled(page, "/admin/usuarios");
    await page.reload();
    await expect(page).toHaveURL(/\/admin\/usuarios/);
    await gotoSettled(page, "/mi-negocio");
    await expect(page).toHaveURL(/\/mi-negocio/);
  });

  test("Usuarios: la tabla carga sin mostrar errores crudos de Supabase", async ({ page }) => {
    await gotoSettled(page, "/admin/usuarios");
    await expect(page.locator("table").first()).toBeVisible({ timeout: 20_000 });
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/PGRST|permission denied|violates|invalid input syntax/i);
  });

  test("QA-016: cambiar rol/membresía de un usuario pide confirmación antes de escribir (hoy escribe en el onChange)", async ({ page }) => {
    // Seguro: se intercepta el PATCH a profiles, NADA llega a la base.
    const writes: string[] = [];
    await page.route("**/rest/v1/profiles?*", async (route) => {
      if (route.request().method() === "PATCH") {
        writes.push(route.request().postData() ?? "");
        await route.fulfill({ status: 204, body: "" });
      } else {
        await route.continue();
      }
    });
    await gotoSettled(page, "/admin/usuarios");
    const roleSelects = page.locator("table select").filter({ has: page.locator("option[value='admin']") });
    test.skip((await roleSelects.count()) < 2, "se necesitan al menos 2 usuarios para no tocar el propio");
    await roleSelects.last().selectOption("admin");
    const confirmDialog = page.getByRole("dialog").or(page.getByRole("alertdialog"));
    const asked = (await confirmDialog.count()) > 0;
    test.fail(!asked && writes.length > 0, "QA-016: el cambio de rol se envía sin confirmación (acción peligrosa)");
    expect(asked, "debe pedir confirmación antes de escalar privilegios").toBe(true);
  });

  test("QA-017: editar 'meses activos' no escribe en la base en cada pulsación de tecla", async ({ page }) => {
    const writes: string[] = [];
    await page.route("**/rest/v1/profiles?*", async (route) => {
      if (route.request().method() === "PATCH") {
        writes.push(route.request().postData() ?? "");
        await route.fulfill({ status: 204, body: "" });
      } else {
        await route.continue();
      }
    });
    await gotoSettled(page, "/admin/usuarios");
    const months = page.locator("table input[type='number']").first();
    test.skip((await months.count()) === 0, "no hay campo de meses activos visible");
    await months.fill("");
    await months.pressSequentially("123", { delay: 50 });
    test.fail(writes.length > 1, "QA-017: cada tecla dispara un UPDATE (onChange sin debounce ni confirmación)");
    expect(writes.length, "una edición de 3 dígitos debería producir a lo sumo 1 escritura").toBeLessThanOrEqual(1);
  });
});

describeAsRole("admin", "Admin: STL (solo lectura)", () => {
  test("categorías y modelos cargan; el formulario de modelo exige campos clave", async ({ page }) => {
    await gotoSettled(page, "/admin/stl/categorias");
    await expect(page.locator("main")).not.toContainText(/PGRST|permission denied/i);
    await gotoSettled(page, "/admin/stl/modelos/nuevo");
    const submit = page.getByRole("button", { name: /Guardar|Crear/ }).first();
    if (await submit.count()) {
      await submit.click();
      await expect(page.getByText(/obligatori|requerid|ingres/i).first()).toBeVisible();
    }
  });

  test("editar un modelo inexistente muestra estado de error entendible", async ({ page, monitor }) => {
    monitor.expectHttp({ status: [400, 404, 406] });
    await gotoSettled(page, "/admin/stl/modelos/00000000-0000-4000-8000-000000000000");
    await expect(page.locator("body")).not.toContainText(/PGRST|invalid input syntax|TypeError/i);
  });
});

describeAsRole("admin", "Admin: contenido (solo lectura)", () => {
  test("curso inexistente / roadmap inexistente no crashean", async ({ page, monitor }) => {
    monitor.expectHttp({ status: [400, 404, 406] });
    for (const path of ["/admin/cursos/00000000-0000-4000-8000-000000000000", "/admin/roadmaps/00000000-0000-4000-8000-000000000000", "/admin/sorteos/00000000-0000-4000-8000-000000000000"]) {
      const response = await gotoSettled(page, path);
      expect(response?.status(), path).toBeLessThan(500);
      await expect(page.locator("body")).not.toContainText(/invalid input syntax|PGRST|TypeError/i);
    }
  });
});
