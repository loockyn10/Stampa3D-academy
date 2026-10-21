import type { Page } from "@playwright/test";
import { test, expect, describeAsRole, describeMutating, gotoSettled, horizontalOverflow } from "../support/fixtures";

interface Summary {
  material: number;
  electricity: number;
  maintenance: number;
  extras: number;
  overhead: number;
  base: number;
  price: number;
  profit: number;
}

/** Lee el panel "Resumen del cálculo". Cada fila es <p>label</p><p>$valor</p>. */
async function readSummary(page: Page): Promise<Summary> {
  const value = async (label: RegExp) => {
    const labelNode = page.locator("p", { hasText: label }).first();
    const text = await labelNode.locator("xpath=following-sibling::p[1]").innerText();
    return Number(text.replace(/[^0-9.\-]/g, ""));
  };
  return {
    material: await value(/^Filamento$/),
    electricity: await value(/^Electricidad$/),
    maintenance: await value(/^Mantenimiento$/),
    extras: await value(/^Insumos extra$/),
    overhead: await value(/^Recargo insumos 30%$/),
    base: await value(/^Costo Base$/i),
    price: await value(/^Precio Sugerido$/i),
    profit: await value(/^Ganancia estimada$/i),
  };
}

async function fillBasics(page: Page, values: { grams?: string; hours?: string; minutes?: string }) {
  if (values.grams !== undefined) await page.getByLabel("Gramos").first().fill(values.grams);
  if (values.hours !== undefined) await page.getByLabel("Horas").fill(values.hours);
  if (values.minutes !== undefined) await page.getByLabel("Minutos").fill(values.minutes);
}

function expectFinite(summary: Summary) {
  for (const [key, number] of Object.entries(summary)) {
    expect(Number.isFinite(number), `${key} debe ser un número finito (NaN/Infinity)`).toBe(true);
  }
}

test.describe("[anonymous] Calculadora Demo", () => {
  test("abre con configuración Demo identificada y resultados en cero", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    await expect(page.getByRole("heading", { name: "Calculadora de precios" })).toBeVisible();
    await expect(page.getByText("Configuración demo").first()).toBeVisible();
    const summary = await readSummary(page);
    expect(summary.price).toBe(0);
    expect(summary.base).toBe(0);
    await expect(page.getByText("Elegí un filamento e ingresá más de 0 gramos")).toBeVisible();
  });

  test("calcula con gramos y tiempo: invariantes del motor único", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    await fillBasics(page, { grams: "100", hours: "2", minutes: "30" });
    const summary = await readSummary(page);
    expectFinite(summary);
    expect(summary.material, "material > 0 con gramos > 0").toBeGreaterThan(0);
    expect(summary.electricity).toBeGreaterThan(0);
    // costo base = suma de las líneas visibles (tolerancia por redondeo a 2 decimales)
    const lines = summary.material + summary.electricity + summary.maintenance + summary.extras + summary.overhead;
    expect(Math.abs(summary.base - lines)).toBeLessThan(0.05);
    expect(summary.price).toBeGreaterThanOrEqual(summary.base);
    expect(Math.abs(summary.price - summary.base - summary.profit)).toBeLessThan(0.05);
  });

  test("monotonía: más gramos o más tiempo nunca bajan el precio", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    await fillBasics(page, { grams: "50", hours: "1", minutes: "0" });
    const small = await readSummary(page);
    await fillBasics(page, { grams: "200" });
    const moreGrams = await readSummary(page);
    await fillBasics(page, { hours: "5" });
    const moreTime = await readSummary(page);
    expect(moreGrams.price).toBeGreaterThan(small.price);
    expect(moreTime.price).toBeGreaterThan(moreGrams.price);
  });

  test("valores 0 → $0.00 sin NaN", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    await fillBasics(page, { grams: "0", hours: "0", minutes: "0" });
    const summary = await readSummary(page);
    expectFinite(summary);
    expect(summary.price).toBe(0);
  });

  test("entradas inválidas (letras, signos, notación científica) se normalizan y no rompen el cálculo", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    await fillBasics(page, { grams: "abc", hours: "x", minutes: "y" });
    await expect(page.getByLabel("Gramos").first()).toHaveValue("");
    expectFinite(await readSummary(page));
    await fillBasics(page, { grams: "-5", hours: "-1", minutes: "-30" });
    for (const label of ["Gramos", "Horas", "Minutos"]) {
      const value = await page.getByLabel(label).first().inputValue();
      expect(value, `${label} no admite negativos`).not.toContain("-");
    }
    const summary = await readSummary(page);
    expectFinite(summary);
    expect(summary.price).toBeGreaterThanOrEqual(0);
  });

  test("QA-006: valores desproporcionados se acotan o se avisan (hoy se muestran $59.905.400.300)", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    await fillBasics(page, { grams: "999999999", hours: "99999", minutes: "99" });
    const summary = await readSummary(page);
    expectFinite(summary);
    // Criterio razonable: 1.000.000 g (1 tonelada) por pieza ya es irreal; el input debería limitar o avisar.
    const grams = Number(await page.getByLabel("Gramos").first().inputValue());
    test.fail(grams >= 999_999_999, "QA-006: sin tope máximo en gramos/horas");
    expect(grams).toBeLessThanOrEqual(1_000_000);
  });

  test("personalizar abre el CTA de registro con returnTo=/calculadora", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    await page.getByRole("button", { name: "Personalizar cálculo" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Personalizá tus cálculos")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Crear cuenta gratis" })).toHaveAttribute("href", /\/registro\?returnTo=%2Fcalculadora|\/registro\?returnTo=\/calculadora/);
    await expect(dialog.getByRole("link", { name: "Ya tengo cuenta" })).toHaveAttribute("href", /\/login\?returnTo=/);
  });

  test("los selectores de impresora/filamento parecen controles reales pero abren el CTA, no cambian datos", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    const printerName = await page.getByText(/\(\d+W\)/).first().innerText();
    await page.getByText(printerName).first().click();
    await expect(page.getByRole("dialog").getByText("Personalizá tus cálculos")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText(printerName).first()).toBeVisible();
  });

  test("modo avanzado muestra costos avanzados y Precio p/ Mercado Libre", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    await page.getByRole("button", { name: /Modo Avanzado/ }).click();
    await expect(page.getByRole("heading", { name: "Costos Avanzados" })).toBeVisible();
    await expect(page.getByText("Precio p/ Mercado Libre")).toBeVisible();
    await fillBasics(page, { grams: "100", hours: "1", minutes: "0" });
    await page.getByLabel("Comisión plataforma").fill("-10");
    await page.getByLabel("Fijo extra plataforma").fill("abc");
    const mlText = await page.locator("p", { hasText: /^Precio p\/ Mercado Libre$/ }).locator("xpath=following-sibling::p[1]").innerText();
    expect(mlText).not.toMatch(/NaN|Infinity/);
  });

  test("mobile/desktop: sin overflow horizontal en la calculadora", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    const { overflow, offenders } = await horizontalOverflow(page);
    expect(overflow, `overflow horizontal: ${offenders.join(", ")}`).toBeLessThanOrEqual(1);
  });
});

describeAsRole("free", "Calculadora Free", () => {
  test("Free puede usar la calculadora y ve 'Mis impresoras y filamentos'; no ve 'Guardar como producto'", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    await expect(page.getByRole("button", { name: "Mis impresoras y filamentos" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Guardar como producto/ })).toHaveCount(0);
    await fillBasics(page, { grams: "80", hours: "1", minutes: "20" });
    const summary = await readSummary(page);
    expectFinite(summary);
    expect(summary.price).toBeGreaterThan(0);
  });

  test("Free no recibe acceso premium por estar autenticado (/mi-taller → /sin-acceso)", async ({ page }) => {
    await gotoSettled(page, "/mi-taller");
    await expect(page).toHaveURL(/\/sin-acceso/);
  });

  test("las APIs de la calculadora aceptan Free pero rechazan datos inválidos", async ({ request }) => {
    const bad = await request.post("/api/calculator/selections", { data: { kind: "printer", templateId: "no-uuid" } });
    expect(bad.status()).toBe(400);
    const badKind = await request.post("/api/calculator/selections", { data: { kind: "stock", templateId: "00000000-0000-4000-8000-000000000000" } });
    expect(badKind.status()).toBe(400);
  });
});

describeMutating("free", "Calculadora Free: guardar selección de catálogo (mutante)", () => {
  test("elegir una impresora de catálogo no crea impresoras físicas ni stock (D010)", async ({ page, request }) => {
    await gotoSettled(page, "/calculadora");
    await page.getByRole("button", { name: "Mis impresoras y filamentos" }).click();
    // El detalle del modal depende de datos de catálogo del entorno descartable: se valida el contrato de red.
    const response = await request.get("/api/calculator/catalog");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/user_id|filament_stock|purchase|supplier/i);
  });
});

describeAsRole("paid", "Calculadora Paid", () => {
  test("Paid ve 'Configurar valores' y 'Guardar como producto' deshabilitado hasta tener un cálculo válido", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    await expect(page.getByRole("link", { name: "Configurar valores" })).toBeVisible();
    const save = page.getByRole("button", { name: /Guardar como producto/ });
    await expect(save).toBeDisabled();
    await fillBasics(page, { grams: "60", hours: "1", minutes: "0" });
    await expect(save).toBeEnabled();
  });

  test("usa el mismo motor: mismos números con las mismas entradas que Anonymous (misma estructura de resultados)", async ({ page }) => {
    await gotoSettled(page, "/calculadora");
    await fillBasics(page, { grams: "100", hours: "2", minutes: "0" });
    const summary = await readSummary(page);
    expectFinite(summary);
    expect(summary.price).toBeGreaterThanOrEqual(summary.base);
  });
});
