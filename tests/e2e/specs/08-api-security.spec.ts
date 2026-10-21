import { test, expect } from "../support/fixtures";
import { describeAsRole } from "../support/fixtures";

/**
 * Sondeos NO destructivos de la superficie HTTP. Solo se envían requests que deben ser rechazadas ANTES de
 * tocar datos. No se envían webhooks ni checkouts (insertarían filas en la base real).
 */
const NIL_UUID = "00000000-0000-4000-8000-000000000000";
const BLOCKED = [301, 302, 303, 307, 308, 400, 401, 403, 404, 405];

function isRedirectToLogin(location: string | undefined) {
  return !!location && /\/login(\?|$)/.test(location);
}

test.describe("[anonymous] la API privada no entrega datos sin sesión", () => {
  for (const [method, path, body] of [
    ["POST", "/api/stl/download", { variantId: NIL_UUID }],
    ["POST", "/api/stl/preview", { variantId: NIL_UUID }],
    ["POST", "/api/admin/membership/update-price", { new_price: 1 }],
    ["GET", "/api/business/mercadopago/connect", undefined],
    ["POST", "/api/business/mercadopago/disconnect", {}],
  ] as const) {
    test(`${method} ${path} → bloqueado (nunca 200)`, async ({ request }) => {
      const response = await request.fetch(path, { method, data: body, maxRedirects: 0 });
      expect(BLOCKED, `${method} ${path} devolvió ${response.status()}`).toContain(response.status());
      if ([301, 302, 303, 307, 308].includes(response.status())) {
        expect(isRedirectToLogin(response.headers()["location"]), "debe redirigir a /login, no a otra parte").toBe(true);
      }
      expect(await response.text()).not.toMatch(/signedUrl|token=|service_role/i);
    });
  }

  test("QA-012: una API JSON consumida sin sesión recibe 401, no un 307 hacia una página HTML", async ({ request }) => {
    const response = await request.post("/api/stl/download", { data: { variantId: NIL_UUID }, maxRedirects: 0 });
    // La ruta implementa su propio 401, pero el middleware la intercepta antes: un fetch() del cliente termina
    // siguiendo el redirect y parseando HTML de /login como JSON.
    test.fail(response.status() === 307, "QA-012: middleware responde 307 a /login para endpoints /api/*");
    expect(response.status()).toBe(401);
  });

  test("las rutas de pago públicas por diseño exigen sesión por su cuenta (401)", async ({ request }) => {
    for (const path of ["/api/mercadopago/create-subscription", "/api/mercadopago/sync-subscription"]) {
      // create-subscription valida primero el idempotency_key (400); con uno válido llega al chequeo de sesión.
      const response = await request.post(path, { data: { idempotency_key: "11111111-1111-4111-8111-111111111111" }, maxRedirects: 0 });
      expect(response.status(), path).toBe(401);
    }
  });

  test("/api/calculator/selections: cuerpo inválido 400; cuerpo válido sin sesión 401; nunca escribe", async ({ request }) => {
    const invalid = await request.post("/api/calculator/selections", { data: { kind: "x", templateId: "x" } });
    expect(invalid.status()).toBe(400);
    const valid = await request.post("/api/calculator/selections", { data: { kind: "printer", templateId: NIL_UUID } });
    expect(valid.status()).toBe(401);
  });

  test("/api/calculator/preferences: PUT sin sesión 401 y GET no existe (405), sin fuga de datos", async ({ request }) => {
    const put = await request.put("/api/calculator/preferences", { data: { onboardingStatus: "skipped" } });
    expect(put.status()).toBe(401);
    const get = await request.get("/api/calculator/preferences");
    expect([404, 405]).toContain(get.status());
  });

  test("/api/calculator/catalog anónimo devuelve DTO mínimo sin campos internos", async ({ request }) => {
    const response = await request.get("/api/calculator/catalog");
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(/user_id|supplier|purchase_cost|service_role|created_by|owner/i);
  });

  test("cron de expiración exige CRON_SECRET (sin header y con header incorrecto)", async ({ request }) => {
    expect((await request.get("/api/business/orders/expire", { maxRedirects: 0 })).status()).toBe(401);
    const wrong = await request.get("/api/business/orders/expire", { headers: { authorization: "Bearer no-es-el-secreto" }, maxRedirects: 0 });
    expect(wrong.status()).toBe(401);
  });

  test("callback de auth con code inválido redirige a /login con error y no a un host externo", async ({ request }) => {
    const response = await request.get("/auth/callback?code=codigo-invalido&next=//evil.example/robo", { maxRedirects: 0 });
    expect([302, 307, 308]).toContain(response.status());
    const location = response.headers()["location"] ?? "";
    expect(location).toMatch(/\/login\?error=auth-callback-failed/);
    expect(location).not.toContain("evil.example");
  });

  test("callback de auth sin code no explota (3xx a /login)", async ({ request }) => {
    const response = await request.get("/auth/callback", { maxRedirects: 0 });
    expect([302, 307, 308]).toContain(response.status());
  });

  test("QA-013: cabeceras de seguridad básicas presentes (CSP/frame, nosniff, referrer-policy)", async ({ request }) => {
    const headers = (await request.get("/login")).headers();
    const missing = [
      !(headers["x-frame-options"] || /frame-ancestors/.test(headers["content-security-policy"] ?? "")) && "anti-clickjacking (X-Frame-Options / CSP frame-ancestors)",
      !headers["x-content-type-options"] && "X-Content-Type-Options: nosniff",
      !headers["referrer-policy"] && "Referrer-Policy",
    ].filter(Boolean);
    test.fail(missing.length > 0, "QA-013: next.config.ts no define headers de seguridad");
    expect(missing).toEqual([]);
  });

  test("no se filtran secretos ni mapas de código en el HTML público", async ({ request }) => {
    const html = await (await request.get("/login")).text();
    expect(html).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|MERCADO_PAGO_ACCESS_TOKEN|sk-[A-Za-z0-9]{20,}/);
  });
});

describeAsRole("free", "Free: la API premium sigue cerrada aunque haya sesión", () => {
  test("POST /api/stl/download y /preview nunca devuelven una URL firmada", async ({ request }) => {
    for (const path of ["/api/stl/download", "/api/stl/preview"]) {
      const response = await request.post(path, { data: { variantId: NIL_UUID }, maxRedirects: 0 });
      expect(BLOCKED, `${path} → ${response.status()}`).toContain(response.status());
      expect(await response.text()).not.toMatch(/signedUrl|token=/i);
    }
  });

  test("/api/admin/membership/update-price rechaza a Free", async ({ request }) => {
    const response = await request.post("/api/admin/membership/update-price", { data: { new_price: 1 }, maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401, 403]).toContain(response.status());
  });
});

for (const role of ["beta", "paid"] as const) {
  describeAsRole(role, "no-admin: no puede usar endpoints de administración", () => {
    test("POST /api/admin/membership/update-price → 3xx/403", async ({ request }) => {
      const response = await request.post("/api/admin/membership/update-price", { data: { new_price: 1 }, maxRedirects: 0 });
      expect([301, 302, 303, 307, 308, 401, 403]).toContain(response.status());
    });

    test("variante inexistente en /api/stl/preview → 404 sin filtrar paths internos", async ({ request }) => {
      const response = await request.post("/api/stl/preview", { data: { variantId: NIL_UUID } });
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toMatch(/stl-files|storage\/v1|supabase\.co/);
    });

    test("variantId malformado no produce 500 ni error de Postgres", async ({ request }) => {
      for (const variantId of ["no-uuid", "' or 1=1 --", "../../etc/passwd", 123, null, { $ne: 1 }]) {
        const response = await request.post("/api/stl/preview", { data: { variantId } });
        expect(response.status(), JSON.stringify(variantId)).toBeLessThan(500);
        expect(await response.text()).not.toMatch(/invalid input syntax|PGRST|postgres/i);
      }
    });
  });
}
