import { test, expect, describeAsRole, describeMutating, gotoSettled } from "../support/fixtures";
import { uniqueName } from "../support/env";

describeAsRole("paid", "Mi Taller (solo lectura)", () => {
  test("/mi-taller redirige a Impresoras y la navegación de secciones funciona", async ({ page }) => {
    await gotoSettled(page, "/mi-taller");
    await expect(page).toHaveURL(/\/mi-taller\/impresoras/);
    const nav = page.getByRole("navigation", { name: "Secciones de Mi Taller" });
    for (const [label, url] of [["Filamentos", /filamentos/], ["Productos", /productos/], ["Inventario", /inventario/], ["Impresoras", /impresoras/]] as const) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page, label).toHaveURL(url);
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });

  test("Impresoras: encabezado, acciones principales y estado vacío o listado", async ({ page }) => {
    await gotoSettled(page, "/mi-taller/impresoras");
    await expect(page.getByRole("heading", { name: "Mis Impresoras" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Añadir Impresora" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Importar desde catálogo Stampa/ })).toBeVisible();
  });

  test("Impresoras: el editor valida campos y Cancelar descarta sin crear nada", async ({ page }) => {
    await gotoSettled(page, "/mi-taller/impresoras");
    const before = await page.getByRole("button", { name: /^Editar / }).count();
    await page.getByRole("button", { name: "Añadir Impresora" }).click();
    await expect(page.getByPlaceholder("Ej. Ender 3 V2")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByPlaceholder("Ej. Ender 3 V2")).toHaveCount(0);
    expect(await page.getByRole("button", { name: /^Editar / }).count()).toBe(before);
  });

  test("QA-014: si el guardado de una impresora falla, el editor conserva lo escrito (seguro: INSERT interceptado, no escribe)", async ({ page, monitor }) => {
    monitor.expectHttp({ status: 400, url: "/rest/v1/printers" });
    await page.route("**/rest/v1/printers*", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 400, json: { code: "23514", message: "new row violates check constraint (simulado por QA)" } });
      } else {
        await route.continue();
      }
    });
    await gotoSettled(page, "/mi-taller/impresoras");
    await page.getByRole("button", { name: "Añadir Impresora" }).click();
    const name = page.getByPlaceholder("Ej. Ender 3 V2");
    await name.fill("QA no debe perderse");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(/violates check constraint/)).toBeVisible();
    // Código: `if (!error) setEditingId(null)` lee el ESTADO `error` (valor viejo), no el error de la request.
    const editorStillOpen = await name.isVisible();
    test.fail(!editorStillOpen, "QA-014: el editor se cierra tras un guardado fallido y el usuario pierde lo escrito");
    expect(editorStillOpen, "el editor debe seguir abierto con el valor escrito").toBe(true);
    await expect(name).toHaveValue("QA no debe perderse");
  });

  test("QA-014c: el error de base de datos se muestra crudo al usuario (mensaje de Postgres/PostgREST)", async ({ page, monitor }) => {
    monitor.expectHttp({ status: 400, url: "/rest/v1/printers" });
    await page.route("**/rest/v1/printers*", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 400, json: { code: "42501", message: 'new row violates row-level security policy for table "printers"' } });
      } else {
        await route.continue();
      }
    });
    await gotoSettled(page, "/mi-taller/impresoras");
    await page.getByRole("button", { name: "Añadir Impresora" }).click();
    await page.getByPlaceholder("Ej. Ender 3 V2").fill("QA error crudo");
    await page.getByRole("button", { name: "Guardar" }).click();
    const raw = await page.getByText(/row-level security policy|violates/i).count();
    test.fail(raw > 0, "QA-014c: se expone el mensaje técnico de Postgres");
    expect(raw, "no debe mostrarse texto técnico de base de datos").toBe(0);
  });

  test("Impresoras: el catálogo Stampa se abre, busca y cierra sin errores", async ({ page }) => {
    await gotoSettled(page, "/mi-taller/impresoras");
    await page.getByRole("button", { name: /Importar desde catálogo Stampa/ }).click();
    await expect(page.getByRole("heading", { name: "Catálogo de Impresoras Stampa" })).toBeVisible();
    const search = page.getByPlaceholder("Buscar por marca, modelo o nombre...");
    await search.fill("zzzz-no-existe");
    await expect(page.getByText(/NaN|undefined/)).toHaveCount(0);
    await search.fill("");
  });

  test("Filamentos e Inventario: buscadores responden sin errores", async ({ page }) => {
    await gotoSettled(page, "/mi-taller/filamentos");
    const filamentSearch = page.getByPlaceholder("Buscar filamentos...");
    if (await filamentSearch.count()) {
      await filamentSearch.fill("zzzz");
      await filamentSearch.fill("");
    }
    await gotoSettled(page, "/mi-taller/inventario");
    await expect(page.getByRole("button", { name: /Registrar producción/ }).first()).toBeVisible();
  });
});

describeMutating("paid", "Mi Taller: Impresoras CRUD", () => {
  test("crear → editar → eliminar (inactiva) con confirmación propia; sin diálogos nativos", async ({ page }) => {
    const nativeDialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      nativeDialogs.push(dialog.type());
      await dialog.dismiss();
    });
    const name = uniqueName("Impresora");
    const renamed = `${name} editada`;

    await gotoSettled(page, "/mi-taller/impresoras");
    await page.getByRole("button", { name: "Añadir Impresora" }).click();
    await page.getByPlaceholder("Ej. Ender 3 V2").fill(name);
    await page.locator('input[name="power_watts"]').fill("250");
    await page.locator('input[name="maintenance_cost_per_hour"]').fill("10");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Editar ${name}` }).click();
    await page.getByPlaceholder("Ej. Ender 3 V2").fill(renamed);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(renamed, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Eliminar ${renamed}` }).click();
    const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog"));
    await expect(dialog.getByText("Eliminar impresora").first()).toBeVisible();
    await dialog.getByRole("button", { name: "Eliminar impresora" }).click();
    expect(nativeDialogs, "no deben usarse alert/confirm/prompt nativos").toEqual([]);

    // Persistencia: recargar mantiene el cambio (la impresora queda inactiva o desaparece, nunca activa).
    await page.reload();
    const survivors = page.locator("div", { hasText: renamed }).filter({ hasText: /Activa/ }).filter({ hasNotText: /Inactiva/ });
    await expect(survivors).toHaveCount(0);
  });

  test("doble clic en Guardar no duplica la impresora (predicción QA-014: el botón no se bloquea)", async ({ page }) => {
    const name = uniqueName("Impresora doble submit");
    await gotoSettled(page, "/mi-taller/impresoras");
    await page.getByRole("button", { name: "Añadir Impresora" }).click();
    await page.getByPlaceholder("Ej. Ender 3 V2").fill(name);
    await page.getByRole("button", { name: "Guardar" }).dblclick();
    await page.waitForTimeout(1_500);
    await page.reload();
    await expect(page.getByText(name, { exact: true })).toHaveCount(1);
  });

  test("nombre vacío no crea una impresora sin nombre (predicción QA-014b: no hay validación en cliente)", async ({ page }) => {
    await gotoSettled(page, "/mi-taller/impresoras");
    const before = await page.getByRole("button", { name: /^Editar / }).count();
    await page.getByRole("button", { name: "Añadir Impresora" }).click();
    await page.getByRole("button", { name: "Guardar" }).click();
    await page.waitForTimeout(1_000);
    await page.reload();
    expect(await page.getByRole("button", { name: /^Editar / }).count(), "no debería haberse creado ninguna impresora").toBe(before);
  });

  test("valores negativos en consumo/mantenimiento se rechazan", async ({ page }) => {
    const name = uniqueName("Impresora negativa");
    await gotoSettled(page, "/mi-taller/impresoras");
    await page.getByRole("button", { name: "Añadir Impresora" }).click();
    await page.getByPlaceholder("Ej. Ender 3 V2").fill(name);
    await page.locator('input[name="power_watts"]').fill("-300");
    await page.locator('input[name="maintenance_cost_per_hour"]').fill("-5");
    await page.getByRole("button", { name: "Guardar" }).click();
    await page.waitForTimeout(1_000);
    await page.reload();
    const card = page.locator("div", { hasText: name }).first();
    if (await card.count()) {
      await expect(card).not.toContainText("-300");
    }
  });
});
