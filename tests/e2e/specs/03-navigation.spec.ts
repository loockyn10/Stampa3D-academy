import { test, expect, describeAsRole, gotoSettled, currentPath } from "../support/fixtures";
import type { Page } from "@playwright/test";

const NIL_UUID = "00000000-0000-4000-8000-000000000000";
const RAW_BACKEND_ERROR = /invalid input syntax|violates|PGRST\d+|relation ".*" does not exist|stack trace|TypeError|undefined is not/i;

async function expectNoRawErrors(page: Page) {
  const text = await page.locator("body").innerText();
  expect(text, "la página no debe exponer errores crudos del backend").not.toMatch(RAW_BACKEND_ERROR);
  await expect(page.getByText(/Application error|Internal Server Error|This page couldn.t load/i)).toHaveCount(0);
}

test.describe("[anonymous] navegación pública", () => {
  test("Explorar Modelos ↔ Calculadora ↔ Login por el header, y el botón atrás funciona", async ({ page }) => {
    await gotoSettled(page, "/explorar-modelos");
    await page.locator('a[href="/calculadora"]:visible').first().click();
    await expect(page).toHaveURL(/\/calculadora/);
    await page.getByRole("link", { name: /Explorar Modelos/ }).and(page.locator(":visible")).first().click();
    await expect(page).toHaveURL(/\/explorar-modelos/);
    await page.goBack();
    await expect(page).toHaveURL(/\/calculadora/);
  });

  test("refresh directo en rutas públicas conserva la ruta y el contenido", async ({ page }) => {
    for (const path of ["/calculadora", "/explorar-modelos", "/login", "/registro", "/landing"]) {
      await gotoSettled(page, path);
      await page.reload({ waitUntil: "domcontentloaded" });
      expect(currentPath(page).split("?")[0]).toBe(path);
      await expect(page.locator("body")).not.toBeEmpty();
    }
  });

  test("QA-002: un 404 en una ruta pública no renderiza el shell de miembros ni rompe la hidratación", async ({ page }) => {
    // /tienda está declarada pública en el middleware pero no tiene página: devuelve 404.
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto("/tienda", { waitUntil: "networkidle" });
    expect(response?.status()).toBe(404);
    const shellVisible = await page.getByText("Mi perfil").count();
    const hydrationErrors = errors.filter((message) => /#418|#423|hydrat/i.test(message));
    test.fail(shellVisible > 0 || hydrationErrors.length > 0, "QA-002: el 404 muestra el shell de miembro a anónimos + React #418");
    expect(shellVisible, "el shell de miembros no debería verse sin sesión").toBe(0);
    expect(hydrationErrors).toEqual([]);
  });

  test("QA-008: una tienda inexistente responde 404 real (hoy 200 con UI de 404)", async ({ page }) => {
    const response = await page.goto("/tienda/zzz-no-existe-qa", { waitUntil: "networkidle" });
    await expect(page.getByText(/could not be found|no encontr/i).first()).toBeVisible();
    test.fail(response?.status() === 200, "QA-008: soft-404 (status 200 con contenido de 'not found')");
    expect(response?.status()).toBe(404);
  });

  test("ruta inexistente protegida redirige a /login (default-deny) sin crashear", async ({ page }) => {
    await gotoSettled(page, "/ruta/que/no/existe");
    await expect(page).toHaveURL(/\/login/);
  });
});

describeAsRole("free", "navegación Free", () => {
  test("desktop: sidebar muestra Calculadora y Explorar; módulos premium bloqueados llevan a /sin-acceso", async ({ page, isMobile }) => {
    test.skip(isMobile, "solo desktop");
    await gotoSettled(page, "/calculadora");
    const aside = page.locator("aside");
    await expect(aside.getByRole("link", { name: "Calculadora" })).toBeVisible();
    await expect(aside.getByRole("link", { name: "Explorar Modelos" })).toBeVisible();
    for (const [name, feature] of [["Mi Taller", "taller"], ["Mi Negocio", "negocio"], ["Academia", "academia"], ["Stampy IA", "stampy"]] as const) {
      await expect(aside.getByRole("link", { name })).toHaveAttribute("href", `/sin-acceso?feature=${feature}`);
    }
    await aside.getByRole("link", { name: "Mi Taller" }).click();
    await expect(page).toHaveURL(/\/sin-acceso\?feature=taller/);
    await expect(page.getByRole("heading", { name: /Desbloqueá/ })).toBeVisible();
  });

  test("mobile: barra inferior de 5 ítems con módulos bloqueados", async ({ page, isMobile }) => {
    test.skip(!isMobile, "solo mobile");
    await gotoSettled(page, "/calculadora");
    const nav = page.getByRole("navigation", { name: "Navegación principal" });
    await expect(nav.getByRole("link")).toHaveCount(5);
    await nav.getByRole("link", { name: /Taller/ }).click();
    await expect(page).toHaveURL(/\/sin-acceso\?feature=taller/);
  });
});

for (const role of ["beta", "paid", "admin"] as const) {
  describeAsRole(role, "navegación con acceso completo", () => {
    test("desktop: cada ítem del sidebar navega a su destino sin errores", async ({ page, isMobile }) => {
      test.skip(isMobile, "solo desktop");
      await gotoSettled(page, "/");
      const items: Array<[string, RegExp]> = [
        ["Stampy IA", /\/stampy/],
        ["Calculadora", /\/calculadora/],
        ["Stampa Maker", /\/stampa-maker/],
        ["Sorteos", /\/sorteos/],
        ["Librería STL", /\/libreria-stl/],
        ["Explorar Modelos", /\/explorar-modelos/],
        ["Academia", /\/academia/],
        ["Mi Taller", /\/mi-taller/],
        ["Mi Negocio", /\/mi-negocio/],
        ["Redes", /\/redes/],
        ["Canales", /\/canales/],
        ["Mi perfil", /\/perfil/],
        ["Configuración", /\/configuracion/],
      ];
      for (const [name, url] of items) {
        await page.locator("aside").getByRole("link", { name, exact: true }).click();
        await expect(page, name).toHaveURL(url);
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        await expectNoRawErrors(page);
      }
    });

    test("mobile: barra inferior (4 destinos + herramientas)", async ({ page, isMobile }) => {
      test.skip(!isMobile, "solo mobile");
      await gotoSettled(page, "/");
      const nav = page.getByRole("navigation", { name: "Navegación principal" });
      for (const [name, url] of [["Academia", /\/academia/], ["Taller", /\/mi-taller/], ["Negocio", /\/mi-negocio/], ["Inicio", /\/$/]] as const) {
        await nav.getByRole("link", { name }).click();
        await expect(page, name).toHaveURL(url);
      }
    });

    test("mobile: el menú radial muestra TODAS las herramientas dentro del viewport (QA-010)", async ({ page, isMobile }) => {
      test.skip(!isMobile, "solo mobile");
      await gotoSettled(page, "/");
      await page.getByRole("button", { name: "Abrir herramientas" }).click();
      const menu = page.getByRole("menu", { name: "Herramientas secundarias" });
      const items = menu.getByRole("menuitem");
      const count = await items.count();
      expect(count).toBe(7);
      const viewport = page.viewportSize()!;
      const outOfView: string[] = [];
      const boxes: Array<{ name: string; x: number; y: number }> = [];
      for (let index = 0; index < count; index += 1) {
        const item = items.nth(index);
        const name = (await item.getAttribute("aria-label")) ?? `item-${index}`;
        const box = await item.boundingBox();
        if (!box || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width) outOfView.push(name);
        else boxes.push({ name, x: Math.round(box.x), y: Math.round(box.y) });
      }
      // Dos ítems en la misma posición = uno quedó sin ángulo (7 ítems, 6 ángulos en mobile-radial-menu.tsx).
      const positions = boxes.map((b) => `${b.x},${b.y}`);
      const overlapping = positions.length !== new Set(positions).size;
      test.fail(outOfView.length > 0 || overlapping, "QA-010: 7 herramientas y 6 ángulos: Configuración queda sin posición");
      expect(outOfView, "ítems fuera del viewport").toEqual([]);
      expect(overlapping, "ítems superpuestos").toBe(false);
    });
  });
}

describeAsRole("paid", "parámetros inválidos y enlaces profundos", () => {
  const INVALID_ROUTES = [
    `/cursos/${NIL_UUID}`,
    "/cursos/no-es-un-uuid",
    "/libreria-stl/grupo-que-no-existe",
    "/libreria-stl/grupo-que-no-existe/modelo-que-no-existe",
    "/mi-negocio/ticket/no-es-un-uuid",
    `/mi-negocio/ticket/${NIL_UUID}`,
    "/mi-taller/ruta-inexistente",
    "/mi-negocio/?q=%3Cscript%3Ealert(1)%3C/script%3E",
  ];

  for (const path of INVALID_ROUTES) {
    test(`${path} → estado vacío/404 entendible, sin 5xx ni errores crudos`, async ({ page, monitor }) => {
      monitor.expectHttp({ status: [400, 404, 406] });
      const response = await gotoSettled(page, path);
      expect(response?.status(), "no debe ser un 5xx").toBeLessThan(500);
      await expectNoRawErrors(page);
      await expect(page.locator("body")).not.toBeEmpty();
    });
  }

  test("enlace profundo + refresh conserva la ruta autenticada", async ({ page }) => {
    for (const path of ["/mi-negocio/ventas", "/mi-taller/filamentos", "/libreria-stl", "/academia"]) {
      await gotoSettled(page, path);
      await page.reload({ waitUntil: "domcontentloaded" });
      expect(currentPath(page).split("?")[0]).toBe(path);
    }
  });
});
