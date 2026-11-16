// Sprint integral de prelanzamiento (2026-11-15): alta pública simplificada, código de descuento visible, correo
// (enfriamiento y mensajes) y salvaguardas de Pioneros. Todo con dobles: sin Supabase, Mercado Pago ni Resend reales.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const signup = loadTs("src/lib/registration/public-signup.ts");
const errors = loadTs("src/lib/auth/auth-errors.ts");
const cooldown = loadTs("src/lib/auth/email-cooldown.ts");

const registro = readRepoFile("src/app/registro/page.tsx");
const perfil = readRepoFile("src/app/perfil/page.tsx");
const sinAcceso = readRepoFile("src/app/sin-acceso/sin-acceso-client.tsx");
const actions = readRepoFile("src/app/sin-acceso/actions.ts");
const route = readRepoFile("src/app/api/mercadopago/create-subscription/route.ts");
const recover = readRepoFile("src/app/recuperar-password/page.tsx");
const update = readRepoFile("src/app/actualizar-password/page.tsx");
const verify = readRepoFile("src/app/verificar-email/page.tsx");
const callback = readRepoFile("src/app/auth/callback/route.ts");

// ---------------------------------------------------------------------------------------------------------------
// Etapa 1 — registro
// ---------------------------------------------------------------------------------------------------------------

test("registro: los campos Beta y de referido no se muestran mientras sus programas no son públicos", () => {
  assert.equal(signup.REFERRAL_PROGRAM_PUBLIC, false);
  assert.equal(signup.BETA_CODE_PUBLIC_ENTRY, false);
  // Los campos existen detrás del interruptor (infraestructura conservada), nunca sin él.
  const refField = registro.indexOf('id="ref-code"');
  const betaField = registro.indexOf('id="beta-code"');
  assert.ok(registro.lastIndexOf("{REFERRAL_PROGRAM_PUBLIC && (", refField) > 0);
  assert.ok(registro.lastIndexOf("{BETA_CODE_PUBLIC_ENTRY && (", betaField) > registro.lastIndexOf("{REFERRAL_PROGRAM_PUBLIC && (", betaField));
  // Ningún campo obligatorio relacionado con códigos: el alta solo exige nombre, email y contraseña.
  assert.doesNotMatch(registro, /id="(ref|beta)-code"[^>]*\brequired\b/);
  const requiredIds = [...registro.matchAll(/id="([\w-]+)"[^>]*\brequired\b/g)].map((m) => m[1]).sort();
  assert.deepEqual(requiredIds, ["email-address", "name", "password"]);
});

test("registro: sin código, el alta no espera ni canjea nada (cuenta Free y destino pedido)", () => {
  // El canje silencioso solo corre cuando llega un código por enlace (?ref= / ?invite=); sin código va directo al destino.
  assert.match(registro, /useState\(\(\) => \(searchParams\.get\("ref"\) \|\| searchParams\.get\("invite"\) \|\| ""\)/);
  assert.match(registro, /if \(!normalizedBetaCode && normalizedCode\)/);
  assert.match(registro, /if \(normalizedBetaCode\)/);
  assert.match(registro, /enter\(destination\)/);
  // El callback legado sigue procesando los enlaces de invitación de /admin/codigos.
  assert.match(callback, /resolveRegistrationCode\(submittedCode, supabaseAdmin\)/);
});

test("registro: aviso persistente sobre el correo de Mercado Pago junto al email, sin alert ni modal", () => {
  assert.match(signup.MERCADO_PAGO_EMAIL_RECOMMENDATION, /mismo correo que utilizás en Mercado Pago/);
  assert.match(signup.MERCADO_PAGO_EMAIL_ALTERNATIVE, /vas a poder indicarlo al activar Premium/);
  const emailInput = registro.indexOf('id="email-address"');
  const hint = registro.indexOf('id="email-mp-hint"');
  const passwordInput = registro.indexOf('id="password"');
  assert.ok(emailInput > 0 && hint > emailInput && hint < passwordInput, "el aviso va entre el email y la contraseña");
  assert.match(registro, /aria-describedby="email-mp-hint"/);
  assert.doesNotMatch(registro, /\balert\(|onFocus=/);
  // Es una recomendación: la dependencia real es el payer_email de la suscripción, con alternativa en /sin-acceso.
  assert.match(route, /payerEmail: body\.payerEmail \?\? user\.email/);
  // El campo «Correo de Mercado Pago» está siempre visible en el checkout (ya no vive dentro de un desplegable).
  assert.match(sinAcceso, /Correo de Mercado Pago/);
});

test("perfil: la tarjeta del código de referido solo aparece con el programa activo", () => {
  assert.match(perfil, /const showReferralCard = REFERRAL_PROGRAM_PUBLIC && Boolean\(referralCode\);/);
  assert.match(perfil, /\{showReferralCard && \(/);
  assert.doesNotMatch(perfil, /\{referralCode && \(/);
  // El canje de un código de acceso sigue disponible desde Perfil.
  assert.match(perfil, /<BetaCodeRedeemCard redirectTo="\/perfil" \/>/);
});

// ---------------------------------------------------------------------------------------------------------------
// Etapa 2 — código de descuento visible
// ---------------------------------------------------------------------------------------------------------------

function renderField(props) {
  const { DiscountCodeField } = loadTs("src/components/membership/DiscountCodeField.tsx", {
    "@/app/sin-acceso/actions": { previewDiscountCodeAction: async () => ({ ok: false }) },
  });
  return renderToStaticMarkup(createElement(DiscountCodeField, { applied: null, onApplied: () => {}, ...props }));
}

test("checkout: el campo de código de descuento está visible sin desplegables, con etiqueta y placeholder", () => {
  const html = renderField({});
  assert.match(html, /<label for="discount-code"[^>]*>.*Código de descuento<\/label>/s);
  assert.match(html, /<input[^>]*id="discount-code"/);
  assert.match(html, /placeholder="Ingresá tu código promocional"/);
  assert.match(html, />Aplicar</);
  assert.doesNotMatch(html, /Tengo un código de descuento/);
  assert.doesNotMatch(readRepoFile("src/components/membership/DiscountCodeField.tsx"), /setOpen|Tengo un código/);
});

test("checkout: un código aplicado muestra el precio promocional frente al regular y se puede quitar", () => {
  const html = renderField({
    applied: { code: "PIONEROS", preview: { ok: true, status: "ok", message: "Código aplicado.", baseAmount: 19900, finalAmount: 9900, discountAmount: 10000 } },
  });
  assert.match(html, /PIONEROS/);
  assert.match(html, /Pagás \$\s?9\.900 por mes en lugar de \$\s?19\.900/);
  assert.match(html, /aria-label="Quitar código de descuento"/);
});

test("checkout: inválido, vencido y agotado se informan con mensajes claros (sin texto técnico)", () => {
  const { DISCOUNT_MESSAGES } = loadTs("src/lib/discounts/discount-codes.ts");
  assert.equal(DISCOUNT_MESSAGES.expired, "Este código venció.");
  assert.equal(DISCOUNT_MESSAGES.exhausted, "Este código ya alcanzó el límite de usos.");
  assert.equal(DISCOUNT_MESSAGES.invalid, "Código inválido.");
  for (const message of Object.values(DISCOUNT_MESSAGES)) assert.doesNotMatch(message, /rpc|sql|null|undefined|error:/i);
});

test("checkout: condiciones de la promoción con precio, duración y precio posterior; aceptación obligatoria", () => {
  const terms = sinAcceso.slice(sinAcceso.indexOf('data-testid="promo-terms"'), sinAcceso.indexOf("Activar membresía"));
  assert.match(terms, /Promoción especial/);
  assert.match(terms, /Precio promocional[\s\S]*formatMoney\(discountedPrice\)\} por mes/);
  assert.match(terms, /Duración[\s\S]*\{promo\.promoCycles\} períodos mensuales de facturación/);
  assert.match(terms, /Después[\s\S]*formatMoney\(promo\.postPrice\)\} por mes, desde el período \{promo\.promoCycles \+ 1\}/);
  assert.match(terms, /type="checkbox"/);
  assert.match(sinAcceso, /disabled=\{loading \|\| checkingEmail \|\| promoBlocked\}/);
  assert.match(sinAcceso, /Para continuar, aceptá las condiciones de la promoción\./);
  assert.match(sinAcceso, /Precio regular <span className="line-through">/);
  // El precio nunca está escrito en la pantalla: lo decide el servidor.
  assert.doesNotMatch(sinAcceso, /\b9\.900\b|\b19\.900\b|9900|19900/);
});

test("checkout: el canje de invitaciones no se mezcla con el descuento; el aviso de activación es genérico", () => {
  assert.match(sinAcceso, /\{canActivate && BETA_CODE_PUBLIC_ENTRY && \(\s*<BetaCodeRedeemCard/);
  assert.match(sinAcceso, />Acceso activado</);
});

test("vista previa: una promoción por períodos no se ofrece si las agendas están apagadas (como el checkout)", () => {
  assert.match(actions, /if \(terms && !priceSchedulesEnabled\(\)\) return toDiscountPreview\(discountFailure\("unsupported"\)\);/);
  assert.match(route, /Esta promoción todavía no está disponible\. No se cobró nada\./);
  // Sin reservar: la vista previa sigue siendo un dry run.
  assert.match(actions, /dryRun: true/);
});

// ---------------------------------------------------------------------------------------------------------------
// Etapa 3 — correos de autenticación
// ---------------------------------------------------------------------------------------------------------------

function memoryStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test("enfriamiento de correos: sobrevive a la recarga (por pestaña), vence solo y no acepta plazos absurdos", () => {
  const store = memoryStore();
  const now = 1_000_000;
  assert.equal(cooldown.remainingEmailCooldown("signup_resend", now, store), 0);
  assert.equal(cooldown.startEmailCooldown("signup_resend", 60, now, store), 60);
  assert.equal(cooldown.remainingEmailCooldown("signup_resend", now + 15_000, store), 45);
  assert.equal(cooldown.remainingEmailCooldown("password_recovery", now + 15_000, store), 0, "cada acción tiene su espera");
  assert.equal(cooldown.remainingEmailCooldown("signup_resend", now + 61_000, store), 0);
  assert.equal(cooldown.startEmailCooldown("signup_resend", 99_999, now, store), 300, "tope de 5 minutos");
  store.setItem("stampa_email_cooldown_signup_resend", String(now + 86_400_000));
  assert.equal(cooldown.remainingEmailCooldown("signup_resend", now, store), 0, "un plazo manipulado se ignora");
  assert.equal(cooldown.remainingEmailCooldown("signup_resend", now, null), 0, "sin storage no bloquea");
  assert.equal(cooldown.formatCooldown(45), "45 s");
  assert.equal(cooldown.formatCooldown(240), "4 min");
});

test("límites de Supabase: espera por dirección exacta, límite global con espera larga, nada de texto de Supabase", () => {
  const perAddress = errors.friendlyAuthError({ code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 37 seconds." }, "resend");
  assert.equal(perAddress.rateLimited, true);
  assert.equal(perAddress.retryAfterSeconds, 37);
  assert.match(perAddress.message, /37 s/);
  const global = errors.friendlyAuthError({ code: "over_email_send_rate_limit", message: "email rate limit exceeded" }, "recovery");
  assert.equal(global.retryAfterSeconds, 300);
  assert.match(global.message, /no podemos enviar más correos/);
  const legacyGlobal = errors.friendlyAuthError({ status: 429, message: "Email rate limit exceeded" }, "signup");
  assert.equal(legacyGlobal.retryAfterSeconds, 300);
  for (const friendly of [perAddress, global, legacyGlobal]) assert.doesNotMatch(friendly.message, /security purposes|rate limit/i);
});

test("enlace de recuperación vencido: /actualizar-password lo explica y ofrece pedir uno nuevo", () => {
  const missing = errors.friendlyAuthError({ name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 }, "update_password");
  assert.equal(missing.linkExpired, true);
  assert.match(missing.message, /venció o ya se usó/);
  assert.equal(errors.friendlyAuthError({ code: "session_not_found" }, "update_password").linkExpired, true);
  assert.match(update, /setLinkExpired\(Boolean\(friendly\.linkExpired\)\)/);
  assert.match(update, /href="\/recuperar-password"[^>]*>\s*Pedir un enlace nuevo/);
});

test("recuperación y reenvío: misma pestaña y origen, espera entre envíos y respuesta neutra", () => {
  // Mismo origen que la solicitud (PKCE): nunca una URL armada con NEXT_PUBLIC_APP_URL.
  assert.match(recover, /redirectToUrl = `\$\{window\.location\.origin\}\/auth\/callback\?next=\/actualizar-password`/);
  assert.doesNotMatch(recover, /process\.env\.NEXT_PUBLIC_APP_URL \|\|/);
  assert.match(recover, /startEmailCooldown\("password_recovery"/);
  assert.match(recover, /remainingEmailCooldown\("password_recovery"\)/);
  assert.match(recover, /disabled=\{isLoading \|\| cooldown > 0\}/);
  assert.match(recover, /Si hay una cuenta con ese email, te enviamos un enlace/);
  assert.match(verify, /startEmailCooldown\("signup_resend"/);
  assert.match(verify, /remainingEmailCooldown\("signup_resend"\)/);
  // Colores del tema (modo claro y oscuro), no fondos claros fijos.
  for (const source of [recover, update]) assert.doesNotMatch(source, /bg-(green|red)-50\b/);
});

// ---------------------------------------------------------------------------------------------------------------
// Etapa 5 — salvaguardas de Pioneros que el sprint no debe alterar
// ---------------------------------------------------------------------------------------------------------------

test("Pioneros: el cambio automático de importe sigue apagado por defecto y Resend queda solo del lado servidor", () => {
  const { priceStepUpEnabled } = loadTs("src/lib/mercadopago/price-schedule-store.ts");
  assert.equal(priceStepUpEnabled({}), false);
  assert.equal(priceStepUpEnabled({ PRICE_SCHEDULES_ENABLED: "true" }), false, "vender Pioneros no enciende el cambio de importe");
  assert.equal(priceStepUpEnabled({ PRICE_SCHEDULES_ENABLED: "true", PRICE_STEP_UP_ENABLED: "1" }), false);
  const example = readRepoFile(".env.example");
  assert.match(example, /^PRICE_STEP_UP_ENABLED=false$/m);
  assert.match(example, /^RESEND_API_KEY=$/m);
  assert.match(example, /^PRICE_NOTICE_FROM=$/m);
  assert.match(example, /^PRICE_ALERT_EMAIL=$/m);
  assert.doesNotMatch(example, /NEXT_PUBLIC_[A-Z_]*RESEND/);
  const server = readRepoFile("src/lib/mercadopago/price-schedule-server.ts");
  assert.match(server, /^import "server-only";/);
});
