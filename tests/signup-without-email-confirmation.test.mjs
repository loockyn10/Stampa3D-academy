// Registro sin confirmación de email (D055): con «Confirm email» apagado en Supabase, signUp devuelve la sesión y la
// persona entra directo. Free → área gratuita; «Quiero Premium» → checkout → pago aprobado → onboarding → Premium.
// Cubre la cadena registro → proxy → política de acceso con los módulos reales (puros) y el cableado de las pantallas.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const signup = loadTs("src/lib/auth/signup-outcome.ts");
const routes = loadTs("src/lib/auth/route-policy.ts");
const policy = loadTs("src/lib/auth/access-policy.ts");
const destination = loadTs("src/lib/auth/access-destination.ts");
const errors = loadTs("src/lib/auth/auth-errors.ts");
const intent = loadTs("src/lib/auth/premium-intent.ts");
const returnTo = loadTs("src/lib/auth/return-to.ts");

const NOW = new Date("2026-11-15T12:00:00Z");
const access = (overrides = {}) =>
  policy.evaluateAccessPolicy(
    { authenticated: true, role: "member", membershipStatus: null, membershipExpiresAt: null, onboardingCompleted: false, grants: [], ...overrides },
    NOW,
  );

/** One proxy pass for an authenticated person, exactly as src/utils/supabase/middleware.ts feeds route-policy. */
function proxyPass(pathname, evaluation, search = "") {
  const params = new URLSearchParams(search);
  return routes.authenticatedRoute({
    pathname,
    search,
    returnToParam: params.get("returnTo"),
    hasAccess: evaluation.capabilities.accessPlatform,
    needsOnboarding: evaluation.needsOnboarding,
  });
}

/** Follows proxy redirects until a page renders (or a loop is detected). */
function landsOn(path, evaluation) {
  let current = path;
  for (let hops = 0; hops < 5; hops += 1) {
    const url = new URL(current, "https://stampa.local");
    const decision = proxyPass(url.pathname, evaluation, url.search);
    if (!decision) return current;
    current = decision.redirect;
  }
  throw new Error(`redirect loop from ${path}`);
}

const registro = read("src/app/registro/page.tsx");

// ── Cuenta Free ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("Free: signUp con sesión entra directo (sin verificación) y termina en el área gratuita, nunca en el checkout", () => {
  const next = signup.nextStepAfterSignup({ hasSession: true, returnTo: "/" });
  assert.deepEqual({ ...next }, { kind: "enter", to: "/" });

  const free = access();
  assert.equal(free.capabilities.accessPlatform, false);
  assert.equal(free.capabilities.personalizeCalculator, true, "la sesión Free ya personaliza la Calculadora");
  assert.equal(free.needsOnboarding, false, "Free no pasa por el onboarding Premium");

  const page = landsOn(next.to, free);
  assert.equal(page, routes.FREE_HOME_PATH);
  assert.notEqual(page, routes.NO_ACCESS_PATH);
  assert.doesNotMatch(page, /verificar-email|onboarding|sin-acceso/);
});

test("Free: las herramientas gratuitas abren sin aviso Premium; una sección Premium muestra su aviso (no el checkout directo)", () => {
  const free = access();
  for (const path of ["/calculadora", "/perfil"]) assert.equal(proxyPass(path, free), null, path);
  assert.deepEqual({ ...proxyPass("/stampy", free) }, { redirect: "/sin-acceso?feature=stampy" });
  assert.deepEqual({ ...proxyPass("/academia", free) }, { redirect: "/sin-acceso?feature=academia" });
});

test("Free: volver a /registro o /login con sesión no pide un segundo login", () => {
  const free = access();
  assert.deepEqual({ ...proxyPass("/registro", free) }, { redirect: "/calculadora" });
  assert.deepEqual({ ...proxyPass("/login", free) }, { redirect: "/calculadora" });
});

// ── Cuenta Premium ───────────────────────────────────────────────────────────────────────────────────────────────────

test("Premium: la intención sobrevive al alta con sesión y abre el checkout sin segundo login", () => {
  const premiumReturn = returnTo.sanitizeReturnTo("/sin-acceso");
  assert.equal(intent.isPremiumIntent(premiumReturn), true);
  const next = signup.nextStepAfterSignup({ hasSession: true, returnTo: premiumReturn });
  assert.deepEqual({ ...next }, { kind: "enter", to: "/sin-acceso" });
  // La cuenta recién creada es Free hasta el pago: el proxy deja ver el checkout, sin onboarding ni redirección.
  assert.equal(landsOn(next.to, access()), "/sin-acceso");
  // Con sesión, /registro?returnTo=/sin-acceso vuelve al checkout (no a la calculadora ni a /login).
  assert.deepEqual({ ...proxyPass("/registro", access(), "?returnTo=%2Fsin-acceso") }, { redirect: "/sin-acceso" });
});

test("Premium: pago aprobado → onboarding una sola vez → plataforma Premium", () => {
  const paid = access({ membershipStatus: "active", membershipExpiresAt: "2026-12-15T12:00:00Z" });
  assert.equal(paid.capabilities.accessPlatform, true);
  assert.equal(paid.needsOnboarding, true);
  assert.equal(destination.resolvePostAccessDestination({ authenticated: true, ...paid }), "/onboarding");
  assert.equal(landsOn("/", paid), "/onboarding");

  const onboarded = access({ membershipStatus: "active", membershipExpiresAt: "2026-12-15T12:00:00Z", onboardingCompleted: true });
  assert.equal(destination.resolvePostAccessDestination({ authenticated: true, ...onboarded }), "/");
  assert.equal(landsOn("/", onboarded), "/");
  assert.equal(landsOn("/stampy", onboarded), "/stampy");
});

test("Premium: pago rechazado o abandonado → la cuenta sigue Free, sin onboarding, y puede reintentar", () => {
  for (const membershipStatus of [null, "pending", "inactive", "rejected", "cancelled", "past_due"]) {
    const notPaid = access({ membershipStatus });
    assert.equal(notPaid.capabilities.accessPlatform, false, String(membershipStatus));
    assert.equal(notPaid.needsOnboarding, false, String(membershipStatus));
    assert.equal(destination.resolvePostAccessDestination({ authenticated: true, ...notPaid }), null);
    assert.equal(landsOn("/", notPaid), "/calculadora");
    assert.equal(landsOn("/sin-acceso", notPaid), "/sin-acceso", "el checkout sigue disponible para reintentar");
    assert.equal(landsOn("/pago/estado", notPaid), "/pago/estado");
  }
  // Una membresía vencida tampoco da acceso.
  assert.equal(access({ membershipStatus: "active", membershipExpiresAt: "2026-11-01T00:00:00Z" }).capabilities.accessPlatform, false);
});

// ── Seguridad ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("sin sesión válida no se entra a nada protegido (sesión inválida = visitante)", () => {
  assert.deepEqual({ ...routes.anonymousRoute("/", "") }, { redirect: "/landing" });
  assert.deepEqual({ ...routes.anonymousRoute("/stampy", "") }, { redirect: "/login?returnTo=%2Fstampy" });
  assert.deepEqual({ ...routes.anonymousRoute("/onboarding", "") }, { redirect: "/login?returnTo=%2Fonboarding" });
  assert.deepEqual({ ...routes.anonymousRoute("/perfil", "") }, { redirect: "/login?returnTo=%2Fperfil" });
  const anonymous = policy.evaluateAccessPolicy(
    { authenticated: false, role: "admin", membershipStatus: "active", membershipExpiresAt: null, onboardingCompleted: false, grants: [{ grantType: "beta_tester", status: "active", expiresAt: null }] },
    NOW,
  );
  assert.equal(anonymous.capabilities.accessPlatform, false);
  assert.equal(anonymous.capabilities.accessAdmin, false);
});

test("autenticado ≠ pago: una cuenta recién creada nunca obtiene Premium ni admin", () => {
  const fresh = access();
  assert.equal(fresh.capabilities.accessPlatform, false);
  assert.equal(fresh.capabilities.accessAdmin, false);
  assert.equal(fresh.capabilities.useStampy, false);
  assert.deepEqual({ ...routes.adminRoute("/admin", fresh.capabilities.accessAdmin) }, { redirect: "/" });
});

test("registro con email existente: mensaje propio y neutral, nunca el texto de Supabase", () => {
  // Con «Confirm email» apagado Supabase responde 422 user_already_exists (antes devolvía un usuario sin sesión).
  for (const error of [
    { code: "user_already_exists", status: 422, message: "User already registered" },
    { code: "email_exists", status: 422, message: "Email address already exists" },
    { status: 400, message: "User already registered" },
  ]) {
    const friendly = errors.friendlyAuthError(error, "signup");
    assert.match(friendly.message, /iniciá sesión o recuperá tu contraseña/);
    assert.doesNotMatch(friendly.message, /already|registered/i);
  }
});

test("errores de Supabase en el alta: límites, contraseña débil, red y desconocidos tienen texto propio", () => {
  assert.equal(errors.friendlyAuthError({ status: 429, message: "Request rate limit reached" }, "signup").rateLimited, true);
  assert.match(errors.friendlyAuthError({ code: "weak_password" }, "signup").message, /débil/);
  assert.match(errors.friendlyAuthError({ code: "signup_disabled" }, "signup").message, /no está disponible/);
  assert.match(errors.friendlyAuthError({ message: "Failed to fetch" }, "signup").message, /conexión/);
  assert.equal(errors.friendlyAuthError({ code: "unexpected_failure", message: "db error xyz" }, "signup").message, "No pudimos crear tu cuenta. Probá de nuevo en unos minutos.");
});

test("registro: navegación completa tras signUp (cookies de sesión llegan al proxy) y sin doble envío", () => {
  assert.match(registro, /const enter = \(to: string\) => \{\s*navigating = true;\s*window\.location\.assign\(to\);/);
  assert.match(registro, /if \(!navigating\) setIsLoading\(false\);/);
  assert.doesNotMatch(registro, /router\.(push|replace)\(/, "router.push no garantiza que el servidor vea la sesión nueva");
  assert.doesNotMatch(registro, /useRouter/);
  // Todas las salidas exitosas pasan por enter(); no quedan window.location.assign sueltos en el alta.
  const fromHandler = registro.slice(registro.indexOf("const handleRegister"));
  const handler = fromHandler.slice(0, fromHandler.search(/\n\s*return \(\r?\n/));
  assert.ok(handler.length > 200, "handler encontrado");
  assert.equal((handler.match(/window\.location\.assign\(/g) ?? []).length, 1);
});

test("registro: el flujo normal no pasa por /verificar-email; ese camino solo existe si Supabase no devuelve sesión", () => {
  const verifyBranch = registro.slice(registro.indexOf('if (next.kind === "verify_email")'), registro.indexOf("if (!normalizedBetaCode && normalizedCode)"));
  assert.match(verifyBranch, /rememberSignupEmail\(email\);/);
  assert.match(verifyBranch, /savePendingVerificationEmail\(email\);/);
  // Fuera de esa rama no se recuerda el email ni se guarda nada de la verificación.
  const outside = registro.replace(verifyBranch, "");
  assert.doesNotMatch(outside, /rememberSignupEmail\(|savePendingVerificationEmail\(/);
});

test("registro: nunca guarda contraseñas, tokens ni códigos en localStorage/sessionStorage ni en la URL", () => {
  assert.doesNotMatch(registro, /localStorage|sessionStorage/);
  assert.doesNotMatch(registro, /stampa_pending_(promo|referral)_code/);
  assert.doesNotMatch(registro, /[?&](password|token|access_token|refresh_token)=/i);
  assert.doesNotMatch(registro, /assign\([^)]*password/);
  const pending = read("src/lib/auth/pending-verification.ts");
  for (const call of pending.match(/setItem\([^;]*\);/g) ?? []) assert.doesNotMatch(call, /password|token/i, call);
});

test("registro: formulario simple (nombre, email, contraseña), Beta y referidos ocultos, aviso de Mercado Pago visible", () => {
  const flags = loadTs("src/lib/registration/public-signup.ts");
  assert.equal(flags.BETA_CODE_PUBLIC_ENTRY, false);
  assert.equal(flags.REFERRAL_PROGRAM_PUBLIC, false);
  for (const id of ['id="name"', 'id="email-address"', 'id="password"']) assert.ok(registro.includes(id), id);
  assert.match(registro, /data-testid="email-mp-hint"/);
  assert.doesNotMatch(registro, /Dialog|Modal/);
  assert.doesNotMatch(registro, /confirm(á|a) tu (correo|email)|revis(á|a) tu correo/i);
});

test("recuperación de contraseña: mismo origen (PKCE) y, al cambiarla, se revocan las otras sesiones", () => {
  const recover = read("src/app/recuperar-password/page.tsx");
  assert.match(recover, /resetPasswordForEmail\(email\.trim\(\), \{\s*redirectTo: redirectToUrl,/);
  const update = read("src/app/actualizar-password/page.tsx");
  const updateCall = update.indexOf("supabase.auth.updateUser(");
  const revoke = update.indexOf('supabase.auth.signOut({ scope: "others" })');
  const success = update.indexOf('setSuccessMsg("Contraseña actualizada');
  assert.ok(updateCall > 0 && revoke > updateCall && success > revoke, "revoca después de actualizar y antes de confirmar");
  // Solo las OTRAS sesiones: la de quien recuperó la contraseña sigue activa (no se pide un segundo login).
  assert.doesNotMatch(update, /signOut\(\)/);
  assert.doesNotMatch(update, /scope: "global"/);
});

test("persistencia de sesión y cookies: el proxy refresca con getUser (validado por Supabase) y conserva cookies en cada redirección", () => {
  const mw = read("src/utils/supabase/middleware.ts");
  assert.match(mw, /await supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(mw, /auth\.getSession\(\)/, "getSession no valida el JWT en el servidor");
  assert.match(mw, /supabaseResponse\.cookies\.getAll\(\)\.forEach\(\(cookie\) => \{\s*response\.cookies\.set\(cookie\.name, cookie\.value/);
  const client = read("src/utils/supabase/client.ts");
  assert.match(client, /createBrowserClient/, "el cliente del navegador guarda la sesión en cookies (SSR), no en localStorage");
});

test("ningún permiso ni asociación de pago depende de que el email esté verificado", () => {
  const userAccess = read("src/lib/auth/user-access.ts");
  assert.doesNotMatch(userAccess, /email_confirmed_at|confirmed_at/);
  // El dueño de un pago sale del checkout attempt (external_reference → user_id), nunca del correo del pagador.
  const sync = read("src/lib/mercadopago/membership-sync.ts");
  assert.match(sync, /Never trusts `external_reference` as a user id/);
  assert.match(sync, /findCheckoutAttemptByExternalReference/);
  const create = read("src/app/api/mercadopago/create-subscription/route.ts");
  assert.match(create, /supabase\.auth\.getUser\(\)/);
  assert.match(create, /return response\(\{ error: "Unauthorized" \}, 401\)/);
});
