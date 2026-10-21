import { test, expect, describeAsRole, gotoSettled } from "../support/fixtures";
import { auditLayout } from "../support/ui-audit";
import { MOBILE_WIDTHS, DESKTOP_WIDTHS, VIEWPORT_HEIGHT } from "../support/viewports";
import type { Role } from "../support/env";

/**
 * Responsive: se recorre cada ancho pedido (320–430 y 1280/1440). El proyecto "desktop" cambia el viewport;
 * el archivo se llama *.desktop-only para no repetirse en el proyecto mobile.
 */
const ALL_WIDTHS = [...MOBILE_WIDTHS, ...DESKTOP_WIDTHS];

const PUBLIC_PAGES = ["/login", "/registro", "/recuperar-password", "/actualizar-password", "/calculadora", "/explorar-modelos", "/landing", "/sin-acceso"];

test.describe("[anonymous] responsive de páginas públicas", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path}: sin overflow horizontal ni controles fuera de pantalla (320–1440)`, async ({ page }) => {
      const problems: string[] = [];
      for (const width of ALL_WIDTHS) {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
        await gotoSettled(page, path);
        const audit = await auditLayout(page);
        if (audit.overflow > 1) problems.push(`${width}px: overflow ${audit.overflow}px → ${audit.overflowOffenders.join(", ")}`);
        if (audit.offscreenControls.length) problems.push(`${width}px: controles fuera de pantalla → ${audit.offscreenControls.join(", ")}`);
      }
      expect(problems, "problemas de layout por ancho").toEqual([]);
    });
  }

  test("/calculadora: inputs numéricos y botones usables en mobile (objetivo: >=24px de área, 16px de fuente)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: VIEWPORT_HEIGHT });
    await gotoSettled(page, "/calculadora");
    const audit = await auditLayout(page);
    expect.soft(audit.tinyTargets, "áreas táctiles < 24px").toEqual([]);
    // Un input < 16px hace que iOS Safari haga zoom al enfocar y deje la página desplazada.
    test.fail(audit.smallFontInputs.length > 0, "QA-011: inputs de la calculadora con fuente < 16px (zoom-on-focus en iOS)");
    expect(audit.smallFontInputs, "inputs con font-size < 16px").toEqual([]);
  });

  test("/login y /registro: inputs con fuente >= 16px en mobile (sin zoom-on-focus)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: VIEWPORT_HEIGHT });
    for (const path of ["/login", "/registro"]) {
      await gotoSettled(page, path);
      const audit = await auditLayout(page);
      expect(audit.smallFontInputs, `${path}: inputs < 16px`).toEqual([]);
    }
  });
});

const MEMBER_PAGES = [
  "/", "/stampy", "/academia", "/mi-taller", "/mi-taller/impresoras", "/mi-taller/filamentos", "/mi-taller/productos", "/mi-taller/inventario",
  "/mi-negocio", "/mi-negocio/catalogo", "/mi-negocio/venta-rapida", "/mi-negocio/ventas", "/mi-negocio/clientes",
  "/mi-negocio/reposicion", "/mi-negocio/metricas", "/mi-negocio/pedidos", "/mi-negocio/tienda", "/presupuestos",
  "/libreria-stl", "/stampa-maker", "/sorteos", "/perfil", "/configuracion",
];

for (const role of ["paid", "beta"] as Role[]) {
  describeAsRole(role, "responsive de módulos de plataforma", () => {
    for (const path of MEMBER_PAGES) {
      test(`${path}: sin overflow horizontal ni controles fuera de pantalla (320–430, 1280)`, async ({ page }) => {
        const problems: string[] = [];
        for (const width of [320, 360, 390, 430, 1280]) {
          await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
          await gotoSettled(page, path);
          const audit = await auditLayout(page);
          if (audit.overflow > 1) problems.push(`${width}px: overflow ${audit.overflow}px → ${audit.overflowOffenders.join(", ")}`);
          if (audit.offscreenControls.length) problems.push(`${width}px: fuera de pantalla → ${audit.offscreenControls.join(", ")}`);
        }
        expect(problems).toEqual([]);
      });
    }
  });
}

describeAsRole("free", "responsive Free", () => {
  for (const path of ["/calculadora", "/sin-acceso", "/perfil", "/explorar-modelos"]) {
    test(`${path}: sin overflow (320–430, 1280)`, async ({ page }) => {
      const problems: string[] = [];
      for (const width of [320, 360, 390, 430, 1280]) {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
        await gotoSettled(page, path);
        const audit = await auditLayout(page);
        if (audit.overflow > 1) problems.push(`${width}px: overflow ${audit.overflow}px → ${audit.overflowOffenders.join(", ")}`);
        if (audit.offscreenControls.length) problems.push(`${width}px: fuera de pantalla → ${audit.offscreenControls.join(", ")}`);
      }
      expect(problems).toEqual([]);
    });
  }
});

describeAsRole("admin", "responsive Admin (el Admin declara soporte mobile?)", () => {
  for (const path of ["/admin", "/admin/usuarios", "/admin/cursos", "/admin/stl/modelos", "/admin/stl/categorias", "/admin/stampy", "/admin/codigos"]) {
    test(`${path}: layout a 390 y 1280`, async ({ page }) => {
      const problems: string[] = [];
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
        await gotoSettled(page, path);
        const audit = await auditLayout(page);
        if (audit.overflow > 1) problems.push(`${width}px: overflow ${audit.overflow}px → ${audit.overflowOffenders.join(", ")}`);
      }
      expect(problems).toEqual([]);
    });
  }
});
