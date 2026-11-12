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
const returnTarget = loadTs("src/lib/auth/return-to.ts");

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
  assert.match(read("src/app/landing/page.tsx"), /export const revalidate = \d+/);
});

test("no hay precios, cifras ni valores de respaldo escritos a mano en el contenido ni en los componentes", () => {
  for (const [file, source] of commercialSources()) {
    if (file === "membership-price.ts") continue;
    assert.doesNotMatch(source, /\$\s?\d/, `${file}: precio hardcodeado`);
    assert.doesNotMatch(source, /\b(15000|15\.000|19900|19\.900)\b/, `${file}: valor de respaldo antiguo`);
  }
});

test("CTA: «Quiero Premium» es el principal y conserva la intención de contratar con el returnTo existente, sin prometer un checkout directo", () => {
  const { primary, secondary, free, login, flowNote } = content.commercialCtas;
  assert.equal(primary.label, "Quiero Premium");
  assert.equal(secondary.label, "Probar la Calculadora");
  assert.equal(secondary.href, "/calculadora");
  assert.deepEqual({ ...free }, { label: "Crear cuenta gratuita", href: "/registro" });

  // La intención viaja en `returnTo` (mecanismo real de registro/login): se acepta tal cual y apunta a la pantalla de contratación.
  const registerUrl = new URL(primary.href, "https://stampa.local");
  assert.equal(registerUrl.pathname, "/registro");
  const returnTo = registerUrl.searchParams.get("returnTo");
  assert.equal(returnTo, content.PREMIUM_RETURN_TO);
  assert.equal(returnTo, "/sin-acceso");
  assert.equal(returnTarget.sanitizeReturnTo(returnTo), "/sin-acceso", "returnTo debe sobrevivir a sanitizeReturnTo");
  const loginUrl = new URL(login.href, "https://stampa.local");
  assert.equal(loginUrl.pathname, "/login");
  assert.equal(loginUrl.searchParams.get("returnTo"), "/sin-acceso");

  // /sin-acceso es la pantalla real donde se activa la membresía; las rutas de acceso al flujo son públicas.
  for (const href of ["/registro", "/login", "/sin-acceso", "/calculadora", "/explorar-modelos"]) assert.equal(routes.isPublicPath(href), true, `${href} debe ser pública`);
  assert.match(read("src/app/sin-acceso/sin-acceso-client.tsx"), /Activar membresía/);
  assert.match(read("src/app/registro/page.tsx"), /sanitizeReturnTo\(searchParams\.get\("returnTo"\)\)/);
  assert.match(read("src/app/login/page.tsx"), /sanitizeReturnTo\(searchParams\.get\("returnTo"\)\)/);

  // El botón no promete un pago inmediato: aclara que primero va la cuenta, y «Crear cuenta» solo no activa Premium.
  assert.match(flowNote, /Primero creás tu cuenta/);
  assert.match(flowNote, /Mercado Pago/);
  assert.doesNotMatch(JSON.stringify(content.commercialCtas), /Activar membres|Contratar ahora|Pagar ahora|Suscribite/i);
  assert.ok(content.faq.items.some((item) => /no activa Premium/i.test(item.answer)), "la FAQ aclara que crear la cuenta no activa Premium");
});

test("enfoque comercial: Premium manda y la cuenta gratuita es secundaria (sin los mensajes anteriores)", () => {
  const text = JSON.stringify({ ctas: content.commercialCtas, journey: content.journey, comparison: content.comparison, pricing: content.pricing, faq: content.faq, finalCta: content.finalCta, footer: content.footerContent });
  for (const term of [/Comenzar gratis/i, /Premium es opcional/i, /Empezá gratis/i, /primero creás tu cuenta gratuita/i, /opcional/i, /no activa ninguna membres/i]) {
    assert.doesNotMatch(text, term, `texto retirado: ${term}`);
  }
  // Ningún botón principal es el de la cuenta gratuita; «gratis/gratuita» no se repite como slogan.
  const heroSections = JSON.stringify({ title: content.comparison.title, lead: content.comparison.lead, final: content.finalCta });
  assert.doesNotMatch(heroSections, /gratis|gratuit/i);
  assert.ok((text.match(/gratis|gratuit/gi) ?? []).length <= 12, "demasiadas menciones a lo gratuito");
  // Los componentes usan el CTA principal en la banda de precio, el bloque móvil y el cierre.
  for (const file of ["PlanComparison.tsx", "FinalCta.tsx"]) assert.match(read(`src/components/landing-hero/commercial/${file}`), /commercialCtas\.primary/);
  assert.equal(content.footerContent.tools[0].label, "Quiero Premium");
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
  const page = read("src/app/landing/page.tsx");
  assert.match(page, /<UniversoHero>\s*<CommercialSections \/>\s*<\/UniversoHero>/);
  assert.doesNotMatch(page, /index: false/, "la landing definitiva es indexable");
  const hero = read("src/components/landing-hero/UniversoHero.tsx");
  assert.match(hero, /\{children\}/);
  const footer = read("src/components/landing-hero/commercial/PreviewFooter.tsx");
  assert.match(footer, /loadPublicCommunityLinks/);
  assert.match(footer, /footerLegalLinks/);
  assert.match(footer, /legalPending/);
  // El contenido no inventa documentos legales.
  assert.doesNotMatch(read("src/components/landing-hero/commercial/commercial-content.ts"), /Lorem|términos y condiciones de uso/i);
});

test("comparación móvil: dos bloques con Premium primero y protagonista, y la tabla semántica solo en escritorio", () => {
  const component = read("src/components/landing-hero/commercial/PlanComparison.tsx");
  const premium = component.indexOf("styles.planPremium");
  const free = component.indexOf("styles.planFree");
  const table = component.indexOf("<table");
  assert.ok(premium > -1 && free > premium, "el bloque Premium va antes que el gratuito");
  assert.ok(free < table, "los bloques móviles preceden a la tabla en el DOM");
  // El bloque Premium trae el precio real, el botón principal y los beneficios; el gratuito, la alternativa.
  const premiumBlock = component.slice(premium, free);
  assert.match(premiumBlock, /formatMembershipPrice\(price\)/);
  assert.match(premiumBlock, /commercialCtas\.primary/);
  assert.match(premiumBlock, /featured/);
  const freeBlock = component.slice(free, table);
  assert.match(freeBlock, /commercialCtas\.secondary/);
  assert.match(freeBlock, /commercialCtas\.free/);

  const css = read("src/components/landing-hero/commercial/Commercial.module.css");
  assert.match(css, /\.mobilePlans \{\s*display: none;/, "los bloques móviles están ocultos por defecto");
  const mobile = css.slice(css.indexOf("@media (max-width: 719px)"));
  assert.match(mobile, /\.tableWrap,\s*\.priceBand \{\s*display: none;/, "en móvil no hay tabla comprimida ni banda de precio duplicada");
  assert.match(mobile, /\.mobilePlans \{\s*display: grid;/);
  // La tabla ya no se «desarma» en móvil con data-label.
  assert.doesNotMatch(css, /attr\(data-label\)/);

  // Los beneficios del bloque Premium salen de los mismos datos que la tabla (sin textos nuevos) y no inventan nada.
  const featured = content.comparison.rows.filter((row) => row.featured).map((row) => row.name);
  assert.deepEqual(featured, ["Calculadora", "Explorar Modelos", "Mi Taller", "Academia", "Stampy IA", "Librería STL", "Redes y Canales"]);
  assert.equal(content.comparison.rows.find((row) => row.name === "Tu perfil").featured, false);
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
