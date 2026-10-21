import { test, expect, describeAsRole, gotoSettled, currentPath } from "../support/fixtures";
import { ROUTES, expectedOutcome } from "../support/routes";
import type { ActorRole, Role } from "../support/env";

/**
 * Matriz de acceso: para cada ruta y cada rol, ¿se ve o redirige donde dice middleware.ts?
 * Regla central: authenticated != paid. Free (y Beta vencida/revocada) no ven NADA de plataforma.
 */
function registerRouteTests(actor: ActorRole) {
  for (const route of ROUTES) {
    const outcome = expectedOutcome(actor, route);
    const title =
      outcome.kind === "renders" ? `${route.path} → se muestra` : `${route.path} → redirige a ${outcome.label}`;

    test(title, async ({ page, monitor }) => {
      // Un redirect hacia /login o /sin-acceso es esperado y no genera 4xx; el resto sí cuenta como hallazgo.
      const response = await gotoSettled(page, route.path);
      const finalPath = currentPath(page);
      expect(response?.status(), `status final de ${route.path}`).toBeLessThan(400);

      if (outcome.kind === "redirect") {
        expect(finalPath, `${actor} en ${route.path}`).toMatch(outcome.toPath);
        // El contenido interno del módulo NO debe haberse renderizado antes de redirigir.
        return;
      }

      expect(finalPath.split("?")[0], `${actor} no debería ser redirigido desde ${route.path}`).toBe(route.finalPath ?? route.path);
      await expect(page.getByText(/Application error|Internal Server Error|This page couldn.t load/i)).toHaveCount(0);
      if (route.marker) await expect(page.getByText(route.marker).first()).toBeVisible();
      void monitor;
    });
  }
}

test.describe("[anonymous] matriz de acceso", () => registerRouteTests("anonymous"));

for (const role of ["free", "beta", "paid", "admin", "betaExpired", "betaRevoked"] as Role[]) {
  describeAsRole(role, "matriz de acceso", () => registerRouteTests(role));
}

test.describe("[anonymous] rutas privadas con returnTo", () => {
  test("/mi-negocio/ventas → /login (el destino original se pierde: ver QA-007)", async ({ page }) => {
    await gotoSettled(page, "/mi-negocio/ventas");
    await expect(page).toHaveURL(/\/login/);
    // Esperado por producto: conservar el destino. Hoy el middleware redirige a "/login" sin returnTo.
    test.fail(!new URL(page.url()).searchParams.get("returnTo"), "QA-007: middleware no preserva returnTo");
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/mi-negocio/ventas");
  });
});

describeAsRole("free", "Free no recibe UI interna de módulos premium", () => {
  for (const path of ["/mi-taller", "/mi-negocio", "/academia", "/stampy"]) {
    test(`${path} no expone contenido interno`, async ({ page }) => {
      await gotoSettled(page, path);
      await expect(page).toHaveURL(/\/sin-acceso/);
      await expect(page.getByText(/Mi Taller|Mi Negocio/).filter({ hasText: /Impresoras|Filamentos|Catálogo|Venta rápida/ })).toHaveCount(0);
    });
  }

  test("API premium con sesión Free no entrega datos (stl/download, stl/preview)", async ({ request }) => {
    for (const endpoint of ["/api/stl/download", "/api/stl/preview"]) {
      const response = await request.post(endpoint, { data: { variantId: "00000000-0000-4000-8000-000000000000" }, maxRedirects: 0 });
      // Middleware redirige a /sin-acceso (3xx) o la ruta responde 401/403: nunca 200 con URL firmada.
      expect([301, 302, 303, 307, 308, 401, 403], `${endpoint} → ${response.status()}`).toContain(response.status());
    }
  });
});
