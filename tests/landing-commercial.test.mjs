// Landing 5.5 — secciones comerciales de /landing-preview: precio leído de forma segura, contenido verificado contra la política de acceso
// real, CTA y ausencia de promesas no aprobadas (cancelación, descuentos, herramientas deshabilitadas o beta).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const price = loadTs("src/components/landing-hero/commercial/membership-price.ts");
const content = loadTs("src/components/landing-hero/commercial/commercial-content.ts");
const routes = loadTs("src/lib/auth/route-policy.ts");

const commercialDir = path.join(process.cwd(), "src/components/landing-hero/commercial");
const commercialSources = () => fs.readdirSync(commercialDir).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => [f, read(`src/components/landing-hero/commercial/${f}`)]);

/** Cliente de Supabase falso que registra qué se pidió. */
function fakeClient(result, { throws = false } = {}) {
  const calls = { table: null, columns: null, filter: null };
  return {
    calls,
    client: {
      from(table) {
        calls.table = table;
        return {
          select(columns) {
            calls.columns = columns;
            return {
              eq(column, value) {
                calls.filter = [column, value];
                return { maybeSingle: async () => { if (throws) throw new Error("red caída"); return result; } };
              },
            };
          },
        };
      },
    },
  };
}

test("el precio sale de membership_settings pidiendo SOLO monthly_price y currency", async () => {
  const { client, calls } = fakeClient({ data: { monthly_price: "15000", currency: "ars" }, error: null });
  const result = await price.readPublicMembershipPrice(client);
  assert.deepEqual(result, { amount: 15000, currency: "ARS" });
  assert.equal(calls.table, "membership_settings");
  assert.equal(calls.columns, "monthly_price, currency");
  assert.deepEqual(calls.filter, ["id", "default"]);
});

test("si la lectura falla o el dato es inválido no hay precio: estado provisional, nunca un valor de respaldo", async () => {
  const bad = [
    { data: null, error: { message: "permission denied" } },
    { data: null, error: null },
    { data: { monthly_price: null, currency: "ARS" }, error: null },
    { data: { monthly_price: "0", currency: "ARS" }, error: null },
    { data: { monthly_price: "-5", currency: "ARS" }, error: null },
    { data: { monthly_price: "abc", currency: "ARS" }, error: null },
    { data: { monthly_price: "1000", currency: "PESOS" }, error: null },
  ];
  for (const result of bad) assert.equal(await price.readPublicMembershipPrice(fakeClient(result).client), null);
  assert.equal(await price.readPublicMembershipPrice(fakeClient(null, { throws: true }).client), null);
});

test("el precio se formatea en es-AR y la moneda por defecto es ARS", async () => {
  const text = price.formatMembershipPrice({ amount: 15000, currency: "ARS" });
  assert.match(text, /15\.000/);
  assert.match(price.formatMembershipPrice({ amount: 1999.5, currency: "ARS" }), /1\.999,50/);
  const { client } = fakeClient({ data: { monthly_price: 100 }, error: null });
  assert.equal((await price.readPublicMembershipPrice(client)).currency, "ARS");
});

test("la clave de servicio vive solo en un módulo server-only y ningún componente de cliente lo importa", () => {
  const loader = read("src/components/landing-hero/commercial/load-membership-price.ts");
  assert.match(loader, /import "server-only"/);
  assert.match(loader, /SUPABASE_SERVICE_ROLE_KEY/);
  for (const [file, source] of commercialSources()) {
    if (file === "load-membership-price.ts") continue;
    assert.doesNotMatch(source, /SERVICE_ROLE/, `${file} no debe tocar la clave de servicio`);
    if (/^"use client"/.test(source)) assert.doesNotMatch(source, /load-membership-price/, `${file} (cliente) no puede importar el loader`);
  }
  // Solo la sección servidor lo usa, y la página se regenera (ISR) en lugar de leer en cada visita.
  assert.match(read("src/components/landing-hero/commercial/CommercialSections.tsx"), /loadPublicMembershipPrice\(\)/);
  assert.match(read("src/app/landing-preview/page.tsx"), /export const revalidate = \d+/);
});

test("no hay precios, cifras ni valores de respaldo escritos a mano en el contenido ni en los componentes", () => {
  for (const [file, source] of commercialSources()) {
    if (file === "membership-price.ts") continue;
    assert.doesNotMatch(source, /\$\s?\d/, `${file}: precio hardcodeado`);
    assert.doesNotMatch(source, /\b(15000|15\.000|19900|19\.900)\b/, `${file}: valor de respaldo antiguo`);
  }
});

test("CTA: «Comenzar gratis» va a /registro y «Probar la Calculadora» a /calculadora, y ambas son rutas reales y públicas", () => {
  assert.deepEqual({ ...content.commercialCtas.primary }, { label: "Comenzar gratis", href: "/registro" });
  assert.deepEqual({ ...content.commercialCtas.secondary }, { label: "Probar la Calculadora", href: "/calculadora" });
  for (const href of ["/registro", "/calculadora", "/login", "/explorar-modelos"]) assert.equal(routes.isPublicPath(href), true, `${href} debe ser pública`);
  // Ningún CTA promete activar Premium al registrarse.
  const joined = JSON.stringify(content);
  assert.doesNotMatch(joined, /Activar membres|Contratar ahora|Suscribite/i);
  assert.match(content.finalCta.micro, /no activa ninguna membresía/i);
  assert.match(content.comparison.lead, /no activa ninguna membresía/i);
});

test("la comparación Free/Premium coincide con la política de acceso real (rutas libres y públicas)", () => {
  const routeOf = {
    Calculadora: "/calculadora",
    "Explorar Modelos": "/explorar-modelos",
    "Tu perfil": "/perfil",
    "Mi Taller": "/mi-taller",
    Academia: "/academia",
    "Stampy IA": "/stampy",
    "Librería STL": "/libreria-stl",
    "Redes y Canales": "/canales",
  };
  for (const row of content.comparison.rows) {
    const route = routeOf[row.name];
    assert.ok(route, `fila sin ruta de verificación: ${row.name}`);
    const freeAccess = routes.isFreeAccountPath(route) || routes.isPublicPath(route);
    assert.equal(Boolean(row.free), freeAccess, `${row.name}: la columna gratuita no coincide con route-policy`);
    assert.ok(row.premium.length > 0);
  }
  assert.equal(routes.isFreeAccountPath("/redes"), false);
});

test("no se promociona nada deshabilitado, en beta ni sin aprobar (Stampa Maker, Mi Negocio, presupuestos, tienda, sorteos, Beta, descuentos, cancelación)", () => {
  const text = JSON.stringify({ journey: content.journey, comparison: content.comparison, pricing: content.pricing, faq: content.faq, finalCta: content.finalCta });
  for (const term of [/Stampa Maker/i, /Mi Negocio/i, /presupuesto/i, /tienda/i, /sorteo/i, /beta/i, /descuento/i, /cancel/i, /reembols/i, /arrepent/i, /prueba gratuita|trial|\bgratis por\b/i, /garant/i]) {
    assert.doesNotMatch(text, term, `el contenido comercial no debe mencionar ${term}`);
  }
});

test("estructura: la página compone las secciones sin tocar el Hero y el footer usa los enlaces reales y marca lo legal pendiente", () => {
  const page = read("src/app/landing-preview/page.tsx");
  assert.match(page, /<UniversoHero>\s*<CommercialSections \/>\s*<\/UniversoHero>/);
  assert.match(page, /index: false/);
  const hero = read("src/components/landing-hero/UniversoHero.tsx");
  assert.match(hero, /\{children\}/);
  const footer = read("src/components/landing-hero/commercial/PreviewFooter.tsx");
  assert.match(footer, /loadPublicCommunityLinks/);
  assert.match(footer, /footerLegalLinks/);
  assert.match(footer, /legalPending/);
  // El contenido no inventa documentos legales.
  assert.doesNotMatch(read("src/components/landing-hero/commercial/commercial-content.ts"), /Lorem|términos y condiciones de uso/i);
});

test("accesibilidad: acordeón nativo, tabla con encabezados y movimiento reducido", () => {
  assert.match(read("src/components/landing-hero/commercial/CommercialFaq.tsx"), /<details/);
  assert.match(read("src/components/landing-hero/commercial/CommercialFaq.tsx"), /<summary>/);
  const table = read("src/components/landing-hero/commercial/PlanComparison.tsx");
  assert.match(table, /<caption/);
  assert.match(table, /scope="col"/);
  assert.match(table, /scope="row"/);
  const css = read("src/components/landing-hero/commercial/Commercial.module.css");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(read("src/components/landing-hero/commercial/use-scroll-progress.ts"), /prefers-reduced-motion: reduce/);
  // Cada pregunta tiene respuesta y no hay preguntas repetidas.
  const questions = content.faq.items.map((item) => item.question);
  assert.equal(new Set(questions).size, questions.length);
  assert.ok(content.faq.items.every((item) => item.answer.length > 20));
});
