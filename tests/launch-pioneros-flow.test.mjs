// Sprint «registro inteligente, checkout Premium y cupos reales» (2026-11-15, D054). Recorridos Free y Premium, abandono
// del pago y ciclo de vida de los cupos con dobles en memoria de Mercado Pago y Supabase: sin red ni cobros. El
// comportamiento de la base (cupos, concurrencia, idempotencia) está en tests/discount-first-payment-db.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { NOW, USER_A, addMonthsIso, reconcile, sync, world } from "./helpers/membership-fakes.mjs";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const routes = loadTs("src/lib/auth/route-policy.ts");
const policy = loadTs("src/lib/auth/access-policy.ts");
const callback = loadTs("src/lib/auth/callback-failure.ts");
const pending = loadTs("src/lib/auth/pending-verification.ts");
const errors = loadTs("src/lib/auth/auth-errors.ts");
const { isPremiumIntent, premiumAuthHref } = loadTs("src/lib/auth/premium-intent.ts");

const PRE = "2c9380848f5e2a6a018f6a0000000001";
const REF = "stampa_checkout_00000000000040008000000000000001";
const future = new Date(Date.now() + 30 * 86_400_000).toISOString();

const auth = (pathname, overrides = {}) =>
  routes.authenticatedRoute({ pathname, search: "", returnToParam: null, hasAccess: false, needsOnboarding: false, ...overrides });
const access = (fields) =>
  policy.evaluateAccessPolicy({ authenticated: true, role: null, membershipStatus: null, membershipExpiresAt: null, onboardingCompleted: false, grants: [], ...fields });

function freeUserWithCheckout() {
  const w = world();
  w.store.addProfile(USER_A);
  w.store.addPendingSubscription(USER_A, PRE, REF);
  w.mp.addPreapproval(PRE, { external_reference: REF, status: "pending" });
  return w;
}
const authorize = (w) => {
  const raw = w.mp.preapprovals.get(PRE);
  raw.status = "authorized";
  raw.next_payment_date = addMonthsIso(NOW.toISOString(), 1, 0);
};
const paidHooks = (w) => w.store.sideEffects.filter(([kind]) => kind === "paid").length;

// ---------------------------------------------------------------------------------------------------------------
// Parte 1 — Free
// ---------------------------------------------------------------------------------------------------------------

test("Free: registro sin intención Premium → confirmación → entra al área gratuita, sin checkout ni onboarding", () => {
  // «Crear cuenta gratuita» no lleva returnTo: la confirmación vuelve a "/".
  const { emailConfirmationRedirect } = pending;
  assert.equal(emailConfirmationRedirect("https://u.test", "/"), "https://u.test/auth/callback?next=%2F");
  const free = access({});
  assert.equal(free.capabilities.accessPlatform, false);
  assert.equal(free.needsOnboarding, false, "sin onboarding para Free");
  assert.deepEqual(auth("/", { needsOnboarding: free.needsOnboarding }), { redirect: routes.FREE_HOME_PATH });
  assert.equal(routes.FREE_HOME_PATH, "/calculadora");
  // Login sin destino de una cuenta Free: área gratuita, nunca /sin-acceso.
  assert.deepEqual(auth("/login"), { redirect: "/calculadora" });
  // Y usa sus herramientas sin redirecciones.
  for (const path of ["/calculadora", "/perfil"]) assert.equal(auth(path), null, path);
});

test("Free: una sección Premium muestra su aviso («Desbloquear con Premium»); el checkout solo si la persona lo pide", () => {
  assert.deepEqual(auth("/stampy"), { redirect: "/sin-acceso?feature=stampy" });
  assert.deepEqual(auth("/cursos/x"), { redirect: "/sin-acceso?feature=academia" });
  assert.deepEqual(auth("/libreria-stl"), { redirect: "/sin-acceso?feature=stl" });
  const client = readRepoFile("src/app/sin-acceso/sin-acceso-client.tsx");
  assert.match(client, /const noticeMode = lockedFeature !== null && !checkoutRequested;/);
  assert.match(client, /const showCheckout = canActivate && !noticeMode;/);
  assert.match(client, /onClick=\{\(\) => setCheckoutRequested\(true\)\}[\s\S]*?Desbloquear con Premium/);
  assert.match(client, /href=\{FREE_HOME_PATH\}[\s\S]*?Seguir con mi cuenta gratuita/);
  assert.match(client, /\{showCheckout && \(\s*<section\s+aria-labelledby="premium-title"/);
  // Sin modales ni redirecciones automáticas al pago.
  assert.doesNotMatch(client, /useEffect\([^)]*create-subscription|window\.confirm|alert\(/);
});

test("Free: el enlace abierto en otro navegador confirma el correo y lleva a /login con el email precargado de forma segura", () => {
  assert.equal(callback.callbackFailurePath("/", "confirmed_elsewhere"), "/login?estado=email-confirmado");
  assert.match(errors.AUTH_SUCCESS_NOTICES["email-confirmado"], /Tu correo está confirmado/);
  // Recordado solo en este navegador, nunca en la URL; vence y se olvida al iniciar sesión.
  const store = new Map();
  globalThis.window = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) } };
  try {
    const t0 = 1_000_000_000_000;
    pending.rememberSignupEmail(" ana@correo.test ", t0);
    assert.equal(pending.readRememberedSignupEmail(t0 + 1000), "ana@correo.test");
    assert.equal(pending.readRememberedSignupEmail(t0 + pending.REMEMBER_SIGNUP_EMAIL_MS + 1), null, "vence");
    pending.forgetSignupEmail();
    assert.equal(pending.readRememberedSignupEmail(t0), null);
    pending.rememberSignupEmail("no-es-un-email", t0);
    assert.equal(pending.readRememberedSignupEmail(t0), null);
  } finally {
    delete globalThis.window;
  }
  const login = readRepoFile("src/app/login/page.tsx");
  assert.match(login, /readRememberedSignupEmail\(\)/);
  assert.match(login, /setEmail\(\(current\) => current \|\| remembered\)/);
  assert.match(login, /forgetSignupEmail\(\);\s*window\.location\.assign\(returnTo\)/);
  assert.doesNotMatch(login, /searchParams\.get\("email"\)/, "el email nunca sale de la URL");
  assert.match(readRepoFile("src/app/registro/page.tsx"), /rememberSignupEmail\(email\)/);
});

// ---------------------------------------------------------------------------------------------------------------
// Parte 2 — Premium
// ---------------------------------------------------------------------------------------------------------------

test("Premium: la intención viaja en el enlace del correo y sobrevive a otra pestaña / dispositivo, login y redirecciones", () => {
  const href = premiumAuthHref("registro");
  assert.equal(href, "/registro?returnTo=%2Fsin-acceso");
  // Misma sesión: el callback vuelve a /sin-acceso (exento de onboarding) y no pide la contraseña otra vez.
  assert.equal(pending.emailConfirmationRedirect("https://u.test", "/sin-acceso"), "https://u.test/auth/callback?next=%2Fsin-acceso");
  assert.equal(routes.isOnboardingExempt("/sin-acceso"), true);
  assert.equal(auth("/sin-acceso"), null);
  // Otro navegador: login con la intención conservada; después del login, /sin-acceso.
  const failure = callback.callbackFailurePath("/sin-acceso", "confirmed_elsewhere");
  assert.equal(failure, "/login?estado=email-confirmado&returnTo=%2Fsin-acceso");
  assert.equal(isPremiumIntent(new URL(failure, "https://u.test").searchParams.get("returnTo")), true);
  assert.deepEqual(auth("/login", { returnToParam: "/sin-acceso" }), { redirect: "/sin-acceso" });
  // Enlace vencido: reenvío conservando la intención.
  assert.equal(callback.callbackFailurePath("/sin-acceso", "link_expired"), "/verificar-email?estado=enlace-vencido&returnTo=%2Fsin-acceso");
  // Nunca una redirección abierta.
  assert.deepEqual(auth("/login", { returnToParam: "https://evil.example/sin-acceso" }), { redirect: "/calculadora" });
  // La suscripción solo se crea con una sesión verificada (nunca para una identidad no autenticada o sin confirmar).
  const route = readRepoFile("src/app/api/mercadopago/create-subscription/route.ts");
  assert.match(route, /if \(userError \|\| !user\) \{\s*return response\(\{ error: "Unauthorized" \}, 401\);/);
});

test("Premium: tras el pago aprobado, onboarding una sola vez y luego la plataforma", () => {
  const paid = access({ membershipStatus: "active", membershipExpiresAt: future });
  assert.equal(paid.capabilities.accessPlatform, true);
  assert.equal(paid.needsOnboarding, true);
  assert.deepEqual(auth("/", { hasAccess: true, needsOnboarding: true }), { redirect: "/onboarding" });
  const done = access({ membershipStatus: "active", membershipExpiresAt: future, onboardingCompleted: true });
  assert.equal(done.needsOnboarding, false);
  assert.equal(auth("/", { hasAccess: true, needsOnboarding: false }), null);
  // /pago/estado manda a "/" al activarse: el proxy decide onboarding o plataforma.
  assert.match(readRepoFile("src/app/pago/estado/page.tsx"), /if \(outcome\.data\.active\) \{\s*timer\.current = window\.setTimeout\(\(\) => router\.push\("\/"\)/);
});

// ---------------------------------------------------------------------------------------------------------------
// Parte 3 — abandono, rechazo, pendiente
// ---------------------------------------------------------------------------------------------------------------

test("abandono del checkout: la cuenta sigue Free, sin Premium, y /pago/estado ofrece reintentar o seguir gratis", async () => {
  const w = freeUserWithCheckout();
  const { summary } = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(summary.hasAccess, false);
  assert.equal(summary.state, "pending");
  assert.equal(paidHooks(w), 0);
  const page = readRepoFile("src/app/pago/estado/page.tsx");
  assert.match(page, /checkoutNotCompleted =\s*waitingForPayment && !chargeUnverified && !stillAutoChecking && result\?\.membership\?\.subscription_status === "pending"/);
  assert.match(page, /No se completó el pago/);
  assert.match(page, /no se cobró nada\. Tu cuenta gratuita sigue/);
  assert.match(page, /Volver a intentar el pago/);
  assert.match(page, /Seguir con mi cuenta gratuita/);
});

test("pago rechazado o pendiente: sin Premium y sin consumir el cupo; aprobado: Premium y cupo consumido; renovación sin otro uso", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  w.mp.addInvoice("7001", PRE, { paymentStatus: "rejected", status: "recycling", debitDate: NOW.toISOString() });
  let result = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(result.summary.hasAccess, false);
  assert.equal(paidHooks(w), 0, "rechazado: no se confirma el uso");
  assert.ok(w.store.sideEffects.some(([kind]) => kind === "authorized"), "la autorización sola no consume (solo fundadores)");

  w.mp.addInvoice("7002", PRE, { paymentStatus: "pending", status: "scheduled", debitDate: NOW.toISOString() });
  result = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(result.summary.hasAccess, false);
  assert.equal(paidHooks(w), 0, "pendiente: tampoco");

  w.mp.addInvoice("7003", PRE, { paymentStatus: "approved", debitDate: NOW.toISOString() });
  result = await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(result.summary.hasAccess, true);
  assert.equal(paidHooks(w), 1);
  // Webhook duplicado / tardío y renovación: el hook se repite y la base lo confirma una sola vez (already_confirmed).
  await sync.syncUserMembership(USER_A, w.deps);
  assert.ok(paidHooks(w) >= 2);
  const store = readRepoFile("src/lib/mercadopago/membership-store.ts");
  assert.match(store, /async onFirstPaymentApproved[\s\S]*?confirmDiscountReservation\(this\.admin, input\.preapprovalId\)/);
});

test("cancelada antes del primer pago: libera la reserva (hook de cancelación) sin confirmar el uso", async () => {
  const w = freeUserWithCheckout();
  authorize(w);
  await sync.syncUserMembership(USER_A, w.deps);
  w.mp.preapprovals.get(PRE).status = "cancelled";
  await sync.syncUserMembership(USER_A, w.deps);
  assert.equal(paidHooks(w), 0);
  assert.ok(w.store.sideEffects.some(([kind]) => kind === "cancelled"));
});

// ---------------------------------------------------------------------------------------------------------------
// Parte 4 — conciliación de checkouts con descuento abandonados
// ---------------------------------------------------------------------------------------------------------------

function withStale(w, items) {
  w.store.listStaleDiscountCheckouts = async () => items;
  return w;
}

test("conciliación: un checkout con descuento todavía pendiente en Mercado Pago se cancela y libera su cupo", async () => {
  const w = withStale(freeUserWithCheckout(), [{ userId: USER_A, preapprovalId: PRE }]);
  const report = await reconcile.releaseAbandonedDiscountCheckouts({}, w.deps);
  assert.deepEqual(report, { examined: 1, cancelled: 1, notPending: 0, failures: 0 });
  assert.ok(w.mp.calls.includes(`cancelPreapproval:${PRE}`));
  assert.ok(w.store.sideEffects.some(([kind, id]) => kind === "cancelled" && id === PRE), "el circuito normal libera la reserva");
  assert.equal(w.store.subscriptions[0].status, "cancelled");
});

test("conciliación: si Mercado Pago ya lo autorizó, NUNCA se cancela (todavía puede cobrar)", async () => {
  const w = withStale(freeUserWithCheckout(), [{ userId: USER_A, preapprovalId: PRE }]);
  authorize(w);
  const report = await reconcile.releaseAbandonedDiscountCheckouts({}, w.deps);
  assert.deepEqual(report, { examined: 1, cancelled: 0, notPending: 1, failures: 0 });
  assert.ok(!w.mp.calls.includes(`cancelPreapproval:${PRE}`));
});

test("conciliación: un error de Mercado Pago se informa sin cancelar ni interrumpir; el umbral mínimo es 1 h", async () => {
  const w = withStale(freeUserWithCheckout(), [{ userId: USER_A, preapprovalId: "otro-preapproval" }]);
  const report = await reconcile.releaseAbandonedDiscountCheckouts({}, w.deps);
  assert.equal(report.failures, 1);
  assert.equal(report.cancelled, 0);
  let asked = null;
  w.store.listStaleDiscountCheckouts = async (input) => {
    asked = input;
    return [];
  };
  await reconcile.releaseAbandonedDiscountCheckouts({ olderThanMinutes: 5 }, w.deps);
  assert.equal(asked.olderThanMinutes, 60);
  assert.equal(reconcile.ABANDONED_DISCOUNT_CHECKOUT_MINUTES, 48 * 60);
  const route = readRepoFile("src/app/api/mercadopago/reconcile/route.ts");
  assert.match(route, /abandonedCheckouts = await releaseAbandonedDiscountCheckouts\(/);
  assert.match(route, /\[abandoned discount checkouts\] falló/);
});

test("admin: cupos pagados / reservados / disponibles desde una ruta solo-admin de lectura", () => {
  const route = readRepoFile("src/app/api/admin/discount-seats/route.ts");
  assert.match(route, /const gate = await requireAdminServiceClient\(\);\s*if \(!gate\.admin\) return gate\.response;/);
  assert.match(route, /rpc\("discount_code_seat_summary"\)/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  const page = readRepoFile("src/app/admin/codigos/page.tsx");
  assert.match(page, /fetch\("\/api\/admin\/discount-seats"/);
  assert.match(page, /pagados<\/span> · \{seats\[c\.id\]\.reserved\} reservados/);
  assert.match(page, /disponibles/);
  assert.match(page, /sobre el límite \(revisar\)/);
});
