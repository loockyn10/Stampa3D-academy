/**
 * Pasos de escritura de seed-mi-taller.mjs que dependen de formularios más complejos (filamentos, categorías, productos y producción).
 * Cada paso usa solo la interfaz real, verifica el resultado releyendo la pantalla y se detiene si algo no coincide.
 */

import { production } from "./mi-taller-data.mjs";

export function makeSteps({ page, go, pageText, has, shot, stop, state }) {
  /** Campo (input/select) que sigue a una etiqueta de texto visible. */
  const after = (label) => page.locator(`xpath=//*[starts-with(normalize-space(text()),"${label}")]/following::*[self::input or self::select or self::textarea][1]`).last();

  return {
    async categories() {
      let created = 0;
      for (const { item, exists } of state.categories) {
        if (exists) continue;
        await go("/mi-taller/productos");
        await page.getByRole("button", { name: "Nueva categoría" }).first().click();
        await page.getByPlaceholder("Ej. Lámparas").fill(item);
        await page.getByRole("button", { name: "Crear categoría" }).click();
        await page.waitForTimeout(1500);
        await go("/mi-taller/productos");
        if (!has(await pageText(), item)) stop(`la categoría "${item}" no aparece después de crearla`);
        created++;
      }
      return `${created} creada(s)`;
    },

    async products() {
      let created = 0;
      const dryFill = process.env.DEMO_NO_SAVE === "1"; // rellena el primer producto, captura y NO guarda
      /** Abre un desplegable propio de la app y elige una opción por su texto. */
      const pick = async (button, optionText) => {
        await button.click();
        const option = page.getByRole("option", { name: new RegExp(optionText) }).first();
        if (await option.count()) await option.click();
        else await page.getByText(optionText, { exact: false }).last().click();
        await page.waitForTimeout(250);
      };
      for (const { item, exists } of state.products) {
        if (exists) continue;
        await go("/mi-taller/productos");
        await page.getByRole("button", { name: "Nuevo producto" }).first().click();
        await page.getByText("Nuevo Producto", { exact: true }).waitFor();
        await page.getByPlaceholder("Ej. Llavero personalizado").fill(item.name);
        await page.getByPlaceholder("Horas").fill(String(item.hours));
        await page.getByPlaceholder("Minutos").fill(String(item.minutes));
        await pick(page.getByRole("button", { name: "Sin categoría" }), item.category);
        await pick(page.locator('button:has-text("disponibles")').first(), item.material);
        await page.getByPlaceholder("Gramos").fill(String(item.grams));
        await pick(page.locator('xpath=//*[normalize-space(text())="Impresora"]/following::button[1]'), item.printer);
        const typeButton = page.locator('xpath=//*[normalize-space(text())="Tipo de producto"]/following::button[1]');
        if (!/minorista/i.test((await typeButton.textContent()) ?? "")) stop('el tipo de producto no es "Minorista"');
        await after("Costo Base").fill(String(item.baseCost));
        await after("Precio Venta").fill(String(item.salePrice));
        await shot(`product-${created}-form`);
        if (dryFill) {
          await shot("product-dryfill-bottom");
          stop("DEMO_NO_SAVE=1: se rellenó el formulario y NO se guardó (revisar la captura)");
        }
        await page.getByRole("button", { name: "Guardar" }).click();
        await page.waitForTimeout(2000);
        await go("/mi-taller/productos");
        if (!has(await pageText(), item.name)) stop(`el producto "${item.name}" no aparece después de guardar`);
        created++;
      }
      return `${created} creado(s)`;
    },

    async production() {
      if (state.finishedUnits !== 0) return `omitido (ya hay ${state.finishedUnits} unidades terminadas)`;
      const dryFill = process.env.DEMO_NO_SAVE === "1";
      let done = 0;
      for (const record of production) {
        await go("/mi-taller/inventario");
        await page.getByRole("button", { name: "Registrar producción" }).first().click();
        await page.getByRole("heading", { name: "Registrar producción" }).waitFor();
        await page.getByRole("button", { name: "Buscar producto o parte..." }).click();
        const option = page.getByRole("option", { name: new RegExp(record.product) }).first();
        if (await option.count()) await option.click();
        else await page.getByText(record.product, { exact: false }).last().click();
        await page.getByRole("button", { name: "Agregar", exact: true }).click();
        await page.waitForTimeout(500);
        await shot(`production-${done}-added`);
        // Cantidad de la línea agregada (por defecto 1): el campo numérico dentro del diálogo.
        const dialog = page.locator('xpath=//h3[normalize-space()="Registrar producción"]/ancestor::div[.//button[normalize-space()="Confirmar producción"]][1]');
        const qty = dialog.locator('input[type="number"]').first();
        if (!(await qty.count())) stop(`no apareció el campo de cantidad para "${record.product}"`);
        await qty.fill(String(record.units));
        await shot(`production-${done}-qty`);
        if (dryFill) stop("DEMO_NO_SAVE=1: se completó la producción y NO se confirmó (revisar la captura)");
        await page.getByRole("button", { name: "Confirmar producción" }).click();
        await page.waitForTimeout(2500);
        done++;
      }
      return `${done} registro(s) de producción confirmados`;
    },

    async filaments() {
      let created = 0;
      for (const { item, exists } of state.filaments) {
        if (exists) continue;
        await go("/mi-taller/filamentos");
        await page.getByRole("button", { name: "Nuevo filamento" }).first().click();
        await page.getByText("Nuevo Filamento", { exact: true }).waitFor();
        await after("Tipo").fill(item.type);
        await after("Marca").fill(item.brand);
        if (item.subtype) await after("Subtipo").fill(item.subtype);
        await after("Color").fill(item.color);
        await page.locator('input[type="color"]').fill(item.colorHex).catch(() => undefined);
        await after("Gramos Total").fill(String(item.total));
        await after("Gramos Restantes").fill(String(item.remaining));
        await after("Precio Compra").fill(String(item.price));
        await shot(`filament-${created}-form`);
        await page.getByRole("button", { name: "Guardar" }).click();
        await page.waitForTimeout(1800);
        await go("/mi-taller/filamentos");
        const text = await pageText();
        if (!(has(text, item.brand) && has(text, item.color))) stop(`el filamento "${item.name}" no aparece después de guardar`);
        created++;
      }
      return `${created} creado(s)`;
    },
  };
}
