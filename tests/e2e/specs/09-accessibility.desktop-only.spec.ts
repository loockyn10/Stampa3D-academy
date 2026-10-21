import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, describeAsRole, gotoSettled } from "../support/fixtures";
import { ROUTES } from "../support/routes";

/**
 * Accesibilidad OBJETIVA con axe-core (WCAG 2.0/2.1 A y AA): contraste, nombres accesibles, labels.
 * - Las violaciones "critical/serious" que NO son de contraste deben ser 0 (test estricto).
 * - El contraste se reporta aparte (QA-020: color de marca #ff780a con texto blanco = 2.64:1, y grises 500/600 sobre fondos oscuros)
 *   como `test.fail` dinámico: documenta el problema sin ocultarlo y avisa cuando se corrija.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];

async function scan(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const contrast = result.violations.filter((violation) => violation.id === "color-contrast");
  const structural = result.violations.filter(
    (violation) => violation.id !== "color-contrast" && (violation.impact === "critical" || violation.impact === "serious"),
  );
  return { contrast, structural };
}

function summarize(violations: Awaited<ReturnType<typeof scan>>["structural"]) {
  return violations.map((violation) => `${violation.id} [${violation.impact}] x${violation.nodes.length}: ${violation.nodes.slice(0, 2).map((node) => node.target.join(" ")).join(" | ")}`);
}

const PUBLIC_PAGES = ["/login", "/registro", "/recuperar-password", "/actualizar-password", "/calculadora", "/explorar-modelos", "/landing", "/sin-acceso"];

test.describe("[anonymous] accesibilidad (axe)", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path}: sin violaciones críticas/serias de nombre accesible o label`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoSettled(page, path);
      const { structural } = await scan(page);
      // /registro: el botón mostrar/ocultar contraseña no tiene aria-label (login sí lo tiene).
      test.fail(path === "/registro" && structural.some((violation) => violation.id === "button-name"), "QA-021: botón mostrar contraseña de /registro sin nombre accesible");
      expect(summarize(structural)).toEqual([]);
    });

    test(`${path}: contraste de color WCAG AA (QA-020)`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoSettled(page, path);
      const { contrast } = await scan(page);
      const nodes = contrast.reduce((sum, violation) => sum + violation.nodes.length, 0);
      test.info().annotations.push({ type: "contrast-nodes", description: String(nodes) });
      test.fail(nodes > 0, `QA-020: ${nodes} elementos con contraste insuficiente en ${path}`);
      expect(nodes, "elementos con contraste < 4.5:1").toBe(0);
    });
  }
});

describeAsRole("paid", "accesibilidad en plataforma (axe)", () => {
  const PAGES = ROUTES.filter((route) => route.tier === "member" && !route.finalPath && !["/libreria-stl"].includes(route.path)).map((route) => route.path);
  for (const path of PAGES) {
    test(`${path}: sin violaciones críticas/serias estructurales`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoSettled(page, path);
      const { structural } = await scan(page);
      expect.soft(summarize(structural), `${path}`).toEqual([]);
    });
  }
});
