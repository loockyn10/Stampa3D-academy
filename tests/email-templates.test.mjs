// Plantillas de correo de Universo Stampa: variables oficiales de Supabase intactas, compatibilidad (sin comentarios ni
// scripts, imágenes por URL pública absoluta), archivos generados sincronizados con el código y aviso de Pioneros seguro.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const T = loadTs("src/lib/email/templates.ts");
const L = loadTs("src/lib/email/layout.ts");
const root = process.cwd();
const sharp = createRequire(import.meta.url)("sharp");

const actionsOf = (html) => [...html.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]);

test("hay 5 plantillas de Supabase con asunto, destino y archivos generados idénticos al código", () => {
  assert.equal(T.AUTH_EMAIL_TEMPLATES.length, 5);
  for (const tpl of T.AUTH_EMAIL_TEMPLATES) {
    assert.ok(tpl.subject.length > 10 && tpl.subject.length < 90, `${tpl.id}: asunto de largo razonable`);
    assert.equal(readRepoFile(`email-templates/supabase/${tpl.file}`).replace(/\r\n/g, "\n"), tpl.html, `${tpl.file} desactualizado: node scripts/build-email-templates.mjs`);
    assert.equal(readRepoFile(`email-templates/supabase/${tpl.file.replace(".html", ".subject.txt")}`).trim(), tpl.subject);
  }
  // Prioridad: confirmación y recuperación primero.
  const first = T.AUTH_EMAIL_TEMPLATES.filter((t) => t.priority === 1).map((t) => t.id).sort();
  assert.deepEqual(first, ["confirm-signup", "reset-password"]);
});

test("el enlace de acción es siempre {{ .ConfirmationURL }} (nunca una URL armada a mano) y solo hay variables oficiales", () => {
  const official = new Set(T.SUPABASE_TEMPLATE_VARIABLES);
  for (const tpl of T.AUTH_EMAIL_TEMPLATES) {
    for (const required of tpl.requiredVariables) assert.ok(tpl.html.includes(required), `${tpl.id} conserva ${required}`);
    for (const action of actionsOf(tpl.html)) assert.ok(official.has(action), `${tpl.id}: variable no oficial ${action}`);
    assert.doesNotMatch(tpl.html, /\/auth\/v1\/verify|\{\{\s*\.Data/i, `${tpl.id}: no arma URLs de Supabase ni usa metadata de usuario`);
    // token_hash solo en la recuperación (flujo sin PKCE hacia /auth/confirm); el resto sigue con ConfirmationURL.
    if (tpl.id !== "reset-password") assert.doesNotMatch(tpl.html, /token_hash|\/auth\/confirm/i, `${tpl.id}: sin token_hash`);
  }
  for (const id of ["confirm-signup", "change-email", "invite"]) {
    const tpl = T.AUTH_EMAIL_TEMPLATES.find((t) => t.id === id);
    assert.match(tpl.html, /<a href="\{\{ \.ConfirmationURL \}\}" target="_blank" class="btn"/, `${id}: el botón apunta a ConfirmationURL`);
  }
  // El aviso de contraseña modificada no lleva enlace de confirmación: solo manda a /recuperar-password del sitio.
  const changed = T.AUTH_EMAIL_TEMPLATES.find((t) => t.id === "password-changed");
  assert.ok(changed.html.includes('href="{{ .SiteURL }}/recuperar-password"'));
  assert.ok(!changed.html.includes("ConfirmationURL"));
  assert.ok(fs.existsSync(path.join(root, "src/app/recuperar-password/page.tsx")), "la ruta de destino existe en la app");
});

test("compatibilidad: sin comentarios HTML, scripts ni recursos externos distintos del logo oficial; viewport y ajuste móvil", () => {
  const all = [...T.AUTH_EMAIL_TEMPLATES.map((t) => t.html), readRepoFile("email-templates/backend/06-aviso-fin-promocion-pioneros.html")];
  for (const html of all) {
    assert.doesNotMatch(html, /<!--/, "los comentarios (también los condicionales) pueden ser eliminados por el motor de plantillas");
    assert.doesNotMatch(html, /<script|javascript:|<link|@import|url\(/i);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /@media only screen and \(max-width: 620px\)/);
    assert.match(html, /<html lang="es"/);
    const images = [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(images, [L.EMAIL_BRAND.logoUrl], "una sola imagen: el logotipo oficial");
    assert.match(images[0], /^https:\/\/universo-stampa\.com\/brand\/universo-logotipo\.png$/);
    assert.match(html, /<img[^>]*\salt="Universo Stampa"/);
    // Botón (si hay): contraste legible, texto oscuro sobre naranja.
    if (html.includes('class="btn"')) assert.match(html, /background-color:#ff780a[^>]*>\s*<a [^>]*color:#171717/);
  }
});

test("el logo del correo es el PNG oficial que ya sirve la app (público, con transparencia y proporción correcta)", async () => {
  const file = path.join(root, "public/brand/universo-logotipo.png");
  assert.ok(fs.existsSync(file));
  const meta = await sharp(file).metadata();
  assert.deepEqual([meta.width, meta.height, meta.hasAlpha], [1200, 403, true]);
  // La proxy de la app excluye .png: sin sesión se sirve igual.
  assert.match(readRepoFile("src/proxy.ts"), /svg\|png\|jpg/);
  assert.equal(Math.round((L.EMAIL_BRAND.logoWidth * 403) / 1200), L.EMAIL_BRAND.logoHeight);
  // Los SVG oficiales no se tocaron: siguen siendo los de design/brand.
  for (const f of ["design/brand/universo-stampa-isotipo.svg", "design/brand/universo-stampa-logotipo.svg"]) assert.ok(fs.existsSync(path.join(root, f)));
});

test("aviso de Pioneros: el HTML branded conserva las afirmaciones del texto, escapa valores y el archivo de referencia está sincronizado", () => {
  const N = loadTs("src/lib/mercadopago/price-notice.ts");
  const mail = N.buildPriceChangeNotice({ promoPrice: 9900, postPrice: 19900, currency: "ARS", changeDate: new Date("2027-07-15T12:00:00.000Z"), appUrl: "https://universo-stampa.com" });
  assert.equal(mail.subject, "Tu precio promocional de Universo Stampa cambia el 15 de julio de 2027");
  for (const part of ["$9.900", "$19.900", "15 de julio de 2027", "cancelar", "https://universo-stampa.com/configuracion", "Mercado Pago", "no tenés que hacer nada"]) {
    assert.ok(mail.html.includes(part), `html menciona ${part}`);
  }
  // Sin appUrl no hay botón ni enlace roto.
  const noUrl = N.buildPriceChangeNotice({ promoPrice: 9900, postPrice: 19900, currency: "ARS", changeDate: new Date("2027-07-15T12:00:00.000Z"), appUrl: null });
  assert.doesNotMatch(noUrl.html, /class="btn"|href="null"/);
  // Escapado: ningún valor del backend puede inyectar HTML.
  const hostile = T.renderPriceChangeNoticeHtml({ promoPrice: "<script>1</script>", postPrice: '"><img src=x>', date: "<b>x</b>", manageUrl: 'https://x.test/"><script>' });
  assert.doesNotMatch(hostile, /<script|<img src=x|<b>x/);
  assert.equal(
    readRepoFile("email-templates/backend/06-aviso-fin-promocion-pioneros.html").replace(/\r\n/g, "\n"),
    T.renderPriceChangeNoticeHtml({ promoPrice: "{{precioPromo}}", postPrice: "{{precioPosterior}}", date: "{{fecha}}", manageUrl: "{{urlMembresia}}" }),
  );
});

test("sigue habiendo un solo proveedor de correo: nada de SMTP/SDK nuevos; el aviso sale por la integración Resend existente", () => {
  const pkg = JSON.parse(readRepoFile("package.json"));
  for (const dep of ["resend", "nodemailer", "@sendgrid/mail", "postmark", "mailgun.js", "@react-email/components"]) {
    assert.ok(!pkg.dependencies?.[dep] && !pkg.devDependencies?.[dep], `no se agregó ${dep}`);
  }
  const notice = readRepoFile("src/lib/mercadopago/price-notice.ts");
  assert.match(notice, /https:\/\/api\.resend\.com\/emails/);
  assert.ok(!readRepoFile("src/lib/email/layout.ts").includes("fetch("));
});

test("recuperación de contraseña: el botón va a /auth/confirm con token_hash en el dominio fijo de producción (no depende del Site URL de Supabase)", () => {
  const tpl = T.AUTH_EMAIL_TEMPLATES.find((t) => t.id === "reset-password");
  const url = "https://universo-stampa.com/auth/confirm?token_hash={{ .TokenHash }}&type=recovery";
  assert.equal(T.RECOVERY_ACTION_URL, url);
  assert.match(tpl.html, /<a href="https:\/\/universo-stampa\.com\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}&type=recovery" target="_blank" class="btn"/);
  assert.ok(!tpl.html.includes("ConfirmationURL"), "ya no usa el enlace de verificación con redirect_to");
  assert.ok(!tpl.html.includes("{{ .SiteURL }}"), "no depende del Site URL del panel");
  assert.ok(fs.existsSync(path.join(root, "src/app/auth/confirm/page.tsx")), "la ruta de destino existe en la app");
});
