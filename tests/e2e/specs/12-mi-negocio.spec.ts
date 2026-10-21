import type { Page } from "@playwright/test";
import { test, expect, describeAsRole, describeMutating, gotoSettled } from "../support/fixtures";
import { uniqueName } from "../support/env";

/** es-AR formatea ARS como "$ 1.000,00" (con espacio de no separación): se tolera cualquier espacio. */
const peso = (amount: string) => new RegExp(String.raw`\$\s?` + amount.replace(/\./g, String.raw`\.`));

const BAD_NUMBERS = /\bNaN\b|\bInfinity\b|\$\s?NaN|undefined/;

function catalogCard(page: Page, name: string) {
  return page.locator("div.overflow-hidden.p-4", { has: page.getByRole("heading", { name }) }).last();
}

async function createResaleItem(page: Page, name: string, values: { cost?: string; price: string; stock: string }) {
  await gotoSettled(page, "/mi-negocio/catalogo");
  await page.getByRole("button", { name: "De reventa" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre", { exact: true }).fill(name);
  await dialog.getByLabel("Categoría").fill("QA E2E");
  await dialog.getByLabel("Costo de compra").fill(values.cost ?? "100");
  await dialog.getByLabel("Precio de venta").fill(values.price);
  await dialog.getByLabel("Stock inicial").fill(values.stock);
  await dialog.getByRole("button", { name: "Guardar producto" }).click();
  await expect(catalogCard(page, name)).toBeVisible();
}

async function archiveItem(page: Page, name: string) {
  await gotoSettled(page, "/mi-negocio/catalogo");
  const card = catalogCard(page, name);
  if ((await card.count()) === 0) return;
  await card.getByRole("button", { name: "Eliminar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(page.getByText("Producto archivado")).toBeVisible();
}

for (const role of ["paid", "beta"] as const) {
  describeAsRole(role, "Mi Negocio (solo lectura)", () => {
    test("hub de Mi Negocio enlaza a todos los módulos", async ({ page }) => {
      await gotoSettled(page, "/mi-negocio");
      await expect(page.getByRole("heading", { name: "Mi Negocio" }).first()).toBeVisible();
      for (const href of ["/mi-negocio/catalogo", "/mi-negocio/venta-rapida", "/mi-negocio/ventas", "/mi-negocio/clientes", "/mi-negocio/reposicion", "/mi-negocio/metricas", "/mi-negocio/tienda"]) {
        await expect(page.locator(`a[href="${href}"]`).first(), href).toBeVisible();
      }
    });

    test("Catálogo: buscador, filtros Activos/Archivados/Todos y estados vacíos", async ({ page }) => {
      await gotoSettled(page, "/mi-negocio/catalogo");
      await page.getByPlaceholder("Buscar por producto, marca, categoría, SKU o código").fill("zzzz-no-existe-qa");
      await expect(page.locator("body")).not.toContainText(BAD_NUMBERS);
      const tabs = page.getByRole("tablist", { name: "Estado del catálogo" });
      for (const name of [/Archivados/, /Todos/, /Activos/]) {
        await tabs.getByRole("tab", { name }).click();
        await expect(tabs.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
      }
    });

    test("Venta rápida: carrito vacío no permite confirmar y el buscador no revienta con caracteres especiales", async ({ page }) => {
      await gotoSettled(page, "/mi-negocio/venta-rapida");
      await expect(page.getByRole("button", { name: "Confirmar venta" })).toBeDisabled();
      const search = page.getByPlaceholder("Producto, SKU o código");
      for (const text of ["%", "_", "' or 1=1 --", "<img src=x onerror=alert(1)>", "a".repeat(300), "   "]) {
        await search.fill(text);
        await expect(page.getByText(/Application error/)).toHaveCount(0);
      }
      await expect(page.locator("img[src='x']")).toHaveCount(0);
    });

    test("Venta rápida: sin cliente + 'Cuenta corriente' exige cliente y bloquea la confirmación", async ({ page }) => {
      await gotoSettled(page, "/mi-negocio/venta-rapida");
      await page.getByRole("button", { name: "Cuenta corriente" }).click();
      await expect(page.getByRole("button", { name: "Confirmar venta" })).toBeDisabled();
    });

    test("Clientes: búsqueda sin resultados muestra estado vacío entendible", async ({ page }) => {
      await gotoSettled(page, "/mi-negocio/clientes");
      await page.getByPlaceholder("Nombre, teléfono o email").fill("zzzz-no-existe-qa");
      await expect(page.getByRole("heading", { name: /No encontramos clientes|Todavía no cargaste clientes/ })).toBeVisible({ timeout: 10_000 });
    });

    test("Ventas: listado o estado vacío, sin NaN ni fechas inválidas", async ({ page }) => {
      await gotoSettled(page, "/mi-negocio/ventas");
      await expect(page.getByRole("heading", { name: "Ventas" }).first()).toBeVisible();
      const text = await page.locator("main").innerText();
      expect(text).not.toMatch(BAD_NUMBERS);
      expect(text).not.toMatch(/Invalid Date/);
    });

    test("Métricas: semana/mes sin NaN/Infinity y con montos coherentes", async ({ page }) => {
      await gotoSettled(page, "/mi-negocio/metricas");
      await expect(page.getByRole("heading", { name: "Métricas" }).first()).toBeVisible();
      for (const label of [/Mes/, /Semana/]) {
        const toggle = page.getByRole("button", { name: label }).first();
        if (await toggle.count()) await toggle.click();
        await expect(page.getByText(/Facturación/).first()).toBeVisible();
        const text = await page.locator("main").innerText();
        expect(text, `métricas (${label})`).not.toMatch(BAD_NUMBERS);
        expect(text).not.toMatch(/Invalid Date|-\$\s?0,00/);
      }
    });

    test("Ticket: id inexistente o malformado muestra un error entendible, sin datos ni trazas", async ({ page }) => {
      for (const id of ["00000000-0000-4000-8000-000000000000", "no-es-un-uuid"]) {
        await gotoSettled(page, `/mi-negocio/ticket/${id}`);
        const text = await page.locator("body").innerText();
        expect(text, id).not.toMatch(/invalid input syntax|PGRST|stack|TypeError/i);
        await expect(page.getByText(/Application error/)).toHaveCount(0);
      }
    });

    test("Reposición y Mi Tienda cargan sin errores y sin NaN", async ({ page }) => {
      for (const path of ["/mi-negocio/reposicion", "/mi-negocio/tienda", "/mi-negocio/pedidos"]) {
        await gotoSettled(page, path);
        expect(await page.locator("main").innerText(), path).not.toMatch(BAD_NUMBERS);
      }
    });
  });
}

describeMutating("paid", "Mi Negocio: ciclo reventa → venta → anulación (stock e idempotencia)", () => {
  test("vender descuenta stock, anular lo restaura una sola vez y no borra historia", async ({ page }) => {
    const name = uniqueName("Reventa venta");
    await createResaleItem(page, name, { price: "500", stock: "5" });
    await expect(catalogCard(page, name)).toContainText("5 u.");

    // Venta rápida: 2 unidades en efectivo
    await gotoSettled(page, "/mi-negocio/venta-rapida");
    await page.getByPlaceholder("Producto, SKU o código").fill(name);
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.locator("button:has(.lucide-plus)").last().click();
    await expect(page.getByText(peso("1.000,00")).first()).toBeVisible();
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    const toast = page.getByText(/Venta N\.º \d+ registrada/);
    await expect(toast).toBeVisible();
    const saleNumber = /N\.º (\d+)/.exec(await toast.innerText())?.[1];
    expect(saleNumber).toBeTruthy();

    await gotoSettled(page, "/mi-negocio/catalogo");
    await expect(catalogCard(page, name)).toContainText("3 u.");

    // Anulación
    await gotoSettled(page, "/mi-negocio/ventas");
    await page.getByRole("button", { name: new RegExp(`N\\.º ${saleNumber}\\b`) }).first().click();
    await page.getByRole("button", { name: "Eliminar venta" }).click();
    await page.getByRole("dialog").filter({ hasText: "¿Eliminar esta venta?" }).getByRole("button", { name: "Eliminar venta" }).click();
    await expect(page.getByText(/Se restauraron 2 unidades/)).toBeVisible();

    await gotoSettled(page, "/mi-negocio/catalogo");
    await expect(catalogCard(page, name)).toContainText("5 u.");

    // Historia preservada: la venta sigue en el listado, marcada como anulada, y no se puede anular dos veces.
    await gotoSettled(page, "/mi-negocio/ventas");
    await page.getByRole("button", { name: new RegExp(`N\\.º ${saleNumber}\\b`) }).first().click();
    await expect(page.getByText(/Anulada/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Venta ya eliminada" })).toBeDisabled();

    await archiveItem(page, name);
  });

  test("no se puede vender más que el stock total (límite del carrito y revalidación)", async ({ page }) => {
    const name = uniqueName("Reventa limite");
    await createResaleItem(page, name, { price: "100", stock: "2" });
    await gotoSettled(page, "/mi-negocio/venta-rapida");
    await page.getByPlaceholder("Producto, SKU o código").fill(name);
    await page.getByRole("button", { name: new RegExp(name) }).click();
    const plus = page.locator("button:has(.lucide-plus)").last();
    await plus.click();
    await expect(plus).toBeDisabled();
    await archiveItem(page, name);
  });

  test("producto sin stock no aparece para vender (y el usuario recibe una explicación)", async ({ page }) => {
    const name = uniqueName("Reventa sin stock");
    await createResaleItem(page, name, { price: "100", stock: "0" });
    await gotoSettled(page, "/mi-negocio/venta-rapida");
    await page.getByPlaceholder("Producto, SKU o código").fill(name);
    // QA-015 (código): `available` filtra stock>0; el mensaje no distingue "sin stock" de "no existe".
    const explanation = page.getByText(/sin stock|agotado/i);
    test.fail((await explanation.count()) === 0, "QA-015: un producto sin stock se muestra como 'No encontramos productos disponibles'");
    await expect(explanation.first()).toBeVisible();
    await archiveItem(page, name);
  });

  test("doble clic en 'Confirmar venta' registra una sola venta (idempotencia)", async ({ page }) => {
    const name = uniqueName("Reventa doble");
    await createResaleItem(page, name, { price: "300", stock: "5" });
    await gotoSettled(page, "/mi-negocio/venta-rapida");
    await page.getByPlaceholder("Producto, SKU o código").fill(name);
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: "Confirmar venta" }).dblclick();
    await expect(page.getByText(/Venta N\.º \d+ registrada/).first()).toBeVisible();
    await gotoSettled(page, "/mi-negocio/catalogo");
    await expect(catalogCard(page, name)).toContainText("4 u.");
    // limpieza: anular y archivar
    await gotoSettled(page, "/mi-negocio/ventas");
    await page.locator("button", { hasText: name }).first().click();
    await page.getByRole("button", { name: "Eliminar venta" }).click();
    await page.getByRole("dialog").filter({ hasText: "¿Eliminar esta venta?" }).getByRole("button", { name: "Eliminar venta" }).click();
    await archiveItem(page, name);
  });

  test("catálogo: archivar y reactivar conserva el mismo registro; formulario valida precios negativos", async ({ page }) => {
    const name = uniqueName("Reventa archivo");
    await createResaleItem(page, name, { price: "250", stock: "1" });
    await archiveItem(page, name);
    const tabs = page.getByRole("tablist", { name: "Estado del catálogo" });
    await tabs.getByRole("tab", { name: /Archivados/ }).click();
    await catalogCard(page, name).getByRole("button", { name: "Reactivar" }).click();
    await expect(page.getByText(/Producto reactivado/)).toBeVisible();
    await tabs.getByRole("tab", { name: /Activos/ }).click();
    await expect(catalogCard(page, name)).toHaveCount(1);

    await page.getByRole("button", { name: "De reventa" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre", { exact: true }).fill(uniqueName("Reventa negativa"));
    await dialog.getByLabel("Precio de venta").fill("-50");
    await dialog.getByLabel("Stock inicial").fill("-3");
    await dialog.getByRole("button", { name: "Guardar producto" }).click();
    await expect(page.getByText(/Producto de reventa agregado/)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await archiveItem(page, name);
  });
});

describeMutating("paid", "Mi Negocio: clientes y cuenta corriente", () => {
  test("venta a cuenta corriente → saldo → cobro parcial → cobro excedido rechazado → anulación revierte deuda", async ({ page }) => {
    const itemName = uniqueName("Reventa deuda");
    const clientName = uniqueName("Cliente");
    await createResaleItem(page, itemName, { price: "1000", stock: "3" });

    await gotoSettled(page, "/mi-negocio/venta-rapida");
    await page.getByPlaceholder("Producto, SKU o código").fill(itemName);
    await page.getByRole("button", { name: new RegExp(itemName) }).click();
    await page.getByRole("button", { name: "Cuenta corriente" }).click();
    await expect(page.getByRole("button", { name: "Confirmar venta" })).toBeDisabled();

    await page.getByRole("button", { name: "Nuevo cliente" }).click();
    const quick = page.getByRole("dialog").filter({ hasText: "Nuevo cliente" });
    await quick.getByLabel("Nombre *").fill(clientName);
    await quick.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(/Cliente .* creado/)).toBeVisible();
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    const toast = page.getByText(/Venta N\.º \d+ registrada/);
    await expect(toast).toBeVisible();
    const saleNumber = /N\.º (\d+)/.exec(await toast.innerText())?.[1];

    await gotoSettled(page, "/mi-negocio/clientes");
    await page.getByPlaceholder("Nombre, teléfono o email").fill(clientName);
    await page.getByRole("button", { name: new RegExp(clientName) }).click();
    const detail = page.getByRole("dialog").filter({ hasText: clientName });
    await expect(detail.getByText(peso("1.000,00")).first()).toBeVisible();
    await expect(detail.getByText("Venta a cuenta corriente")).toBeVisible();

    await detail.getByRole("button", { name: "Registrar cobro" }).click();
    const payment = page.getByRole("dialog").filter({ hasText: new RegExp(String.raw`Saldo pendiente: \$\s?1\.000,00`) });
    await payment.getByLabel("Monto").fill("400");
    await payment.getByRole("button", { name: "Registrar", exact: true }).click();
    await expect(page.getByText("Cobro registrado.")).toBeVisible();
    await expect(detail.getByText(peso("600,00")).first()).toBeVisible();

    // Sobrepago: el backend debe rechazar (no ajustar en silencio)
    await detail.getByRole("button", { name: "Registrar cobro" }).click();
    const overpay = page.getByRole("dialog").filter({ hasText: new RegExp(String.raw`Saldo pendiente: \$\s?600,00`) });
    await overpay.getByLabel("Monto").fill("9999");
    await overpay.getByRole("button", { name: "Registrar", exact: true }).click();
    await expect(page.getByText(/Cobro registrado/)).toHaveCount(0);
    await expect(page.getByRole("alert").or(page.locator("[role=status]")).first()).toBeVisible();
    await overpay.getByRole("button", { name: "Cancelar" }).click();

    // Anular la venta revierte lo pendiente con un movimiento compensatorio (no borra el original)
    await page.keyboard.press("Escape");
    await gotoSettled(page, "/mi-negocio/ventas");
    await page.getByRole("button", { name: new RegExp(`N\\.º ${saleNumber}\\b`) }).first().click();
    await page.getByRole("button", { name: "Eliminar venta" }).click();
    await page.getByRole("dialog").filter({ hasText: "¿Eliminar esta venta?" }).getByRole("button", { name: "Eliminar venta" }).click();
    await expect(page.getByText(/Venta eliminada/)).toBeVisible();

    await gotoSettled(page, "/mi-negocio/clientes");
    await page.getByPlaceholder("Nombre, teléfono o email").fill(clientName);
    await page.getByRole("button", { name: new RegExp(clientName) }).click();
    const after = page.getByRole("dialog").filter({ hasText: clientName });
    await expect(after.getByText("Reverso por anulación")).toBeVisible();
    await expect(after.getByText("Venta a cuenta corriente")).toBeVisible();

    await page.keyboard.press("Escape");
    await archiveItem(page, itemName);
  });

  test("cliente: nombre obligatorio y edición persiste", async ({ page }) => {
    await gotoSettled(page, "/mi-negocio/venta-rapida");
    await page.getByRole("button", { name: "Nuevo cliente" }).click();
    const quick = page.getByRole("dialog").filter({ hasText: "Nuevo cliente" });
    await quick.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("El nombre del cliente es obligatorio.")).toBeVisible();
    await quick.getByLabel("Nombre *").fill("   ");
    await quick.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("El nombre del cliente es obligatorio.")).toBeVisible();
  });
});
