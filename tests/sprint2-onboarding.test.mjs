// Sprint 2 — first experience: landing, sign-up (with and without email confirmation), email verification, login,
// password recovery, Free area, returnTo, onboarding and legal structure. Pure logic + source contracts; no network.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const cache = new Map();
const routes = loadTs("src/lib/auth/route-policy.ts", {}, cache);
const returnTo = loadTs("src/lib/auth/return-to.ts", {}, cache);
const errors = loadTs("src/lib/auth/auth-errors.ts", {}, cache);
const signup = loadTs("src/lib/auth/signup-outcome.ts", {}, cache);
const callback = loadTs("src/lib/auth/callback-failure.ts", {}, cache);
const policy = loadTs("src/lib/auth/access-policy.ts", {}, cache);
const onboarding = loadTs("src/lib/onboarding/profile-update.ts", {}, cache);
const legal = loadTs("src/lib/legal/registry.ts", {}, cache);
const seo = loadTs("src/lib/seo/site.ts", {}, cache);
const pending = loadTs("src/lib/auth/pending-verification.ts", {}, cache);

const src = {
  registro: readRepoFile("src/app/registro/page.tsx"),
  login: readRepoFile("src/app/login/page.tsx"),
  verify: readRepoFile("src/app/verificar-email/page.tsx"),
  recover: readRepoFile("src/app/recuperar-password/page.tsx"),
  update: readRepoFile("src/app/actualizar-password/page.tsx"),
  callback: readRepoFile("src/app/auth/callback/route.ts"),
  sinAcceso: readRepoFile("src/app/sin-acceso/sin-acceso-client.tsx"),
  sinAccesoPage: readRepoFile("src/app/sin-acceso/page.tsx"),
  onboarding: readRepoFile("src/app/onboarding/page.tsx"),
  middleware: readRepoFile("src/utils/supabase/middleware.ts"),
  nextConfig: readRepoFile("next.config.ts"),
  layout: readRepoFile("src/app/main-layout.tsx"),
};

/** Authenticated decision with sensible defaults. */
const auth = (pathname, overrides = {}) =>
  routes.authenticatedRoute({ pathname, search: "", returnToParam: null, hasAccess: false, needsOnboarding: false, ...overrides });

// ---------------------------------------------------------------------------------------------------------------
// 1. Landing / public entry
// ---------------------------------------------------------------------------------------------------------------

test("1. a visitor at / sees the landing; SEO files and legal pages are public; /landing-old is the previous landing", () => {
  assert.deepEqual(routes.anonymousRoute("/", ""), { redirect: "/landing" });
  for (const path of ["/landing", "/robots.txt", "/sitemap.xml", "/legal/terminos", "/calculadora", "/registro", "/login", "/verificar-email"]) {
    assert.equal(routes.anonymousRoute(path, ""), null, path);
  }
  assert.doesNotMatch(src.nextConfig, /source: "\/landing-old"/, "/landing-old ya no redirige: conserva la landing anterior");
  assert.match(src.nextConfig, /source: "\/landing-preview",\s*destination: "\/landing"/);
  assert.match(src.middleware, /anonymousRoute\(pathname, request\.nextUrl\.search\)/);

  const disallow = seo.ROBOTS_DISALLOW;
  for (const privatePath of ["/api/", "/admin", "/perfil", "/onboarding"]) assert.ok(disallow.includes(privatePath), privatePath);
  assert.ok(seo.PUBLIC_INDEXABLE_PATHS.includes("/landing"));
  assert.equal(seo.siteOrigin({ NEXT_PUBLIC_APP_URL: "https://universo.example/app" }), "https://universo.example");
  assert.equal(seo.siteOrigin({ NEXT_PUBLIC_APP_URL: "universo.example" }), "https://universo.example");
  assert.equal(seo.siteOrigin({}), "http://localhost:3000");
});

// ---------------------------------------------------------------------------------------------------------------
// 2–6. Sign-up, email confirmation, resend, expired link
// ---------------------------------------------------------------------------------------------------------------

test("2/4. sign-up WITHOUT email confirmation (Supabase returns a session): enters, the proxy decides the screen", () => {
  assert.deepEqual(signup.nextStepAfterSignup({ hasSession: true, returnTo: "/" }), { kind: "enter", to: "/" });
  assert.deepEqual(signup.nextStepAfterSignup({ hasSession: true, returnTo: "/calculadora" }), { kind: "enter", to: "/calculadora" });
  assert.match(src.registro, /nextStepAfterSignup\(\{ hasSession: Boolean\(signUpData\.session\), returnTo \}\)/);
  assert.doesNotMatch(src.registro, /setError\(signUpError\.message\)/, "no raw Supabase text");
});

test("3. sign-up WITH email confirmation (no session): neutral 'check your email' screen, email kept out of the URL", () => {
  assert.deepEqual(signup.nextStepAfterSignup({ hasSession: false, returnTo: "/" }), { kind: "verify_email", to: "/verificar-email" });
  assert.deepEqual(signup.nextStepAfterSignup({ hasSession: false, returnTo: "/cursos" }), {
    kind: "verify_email",
    to: "/verificar-email?returnTo=%2Fcursos",
  });
  assert.match(src.registro, /savePendingVerificationEmail\(email\)/);
  assert.doesNotMatch(src.registro, /verificar-email\?email=/, "the email never travels in the URL");
  assert.equal(pending.maskEmail("juan.perez@gmail.com"), "ju•••@gmail.com");
  assert.equal(pending.maskEmail("a@b.com"), "a•••@b.com");
  assert.equal(pending.emailConfirmationRedirect("https://x.example", "/cursos"), "https://x.example/auth/callback?next=%2Fcursos");
});

test("5. resend: official Supabase resend, cooldown, neutral success, rate limit translated", () => {
  assert.match(src.verify, /auth\.resend\(\{\s*type: "signup",/);
  assert.match(src.verify, /RESEND_COOLDOWN_SECONDS = 60/);
  assert.match(src.verify, /disabled=\{sending \|\| cooldown > 0\}/);
  assert.match(src.verify, /Si hay una cuenta pendiente de confirmar con ese email/);
  for (const error of [{ code: "over_email_send_rate_limit" }, { status: 429, message: "x" }, { message: "For security purposes, you can only request this after 37 seconds." }]) {
    const friendly = errors.friendlyAuthError(error, "resend");
    assert.equal(friendly.rateLimited, true, JSON.stringify(error));
    assert.doesNotMatch(friendly.message, /security purposes/);
  }
  // Loading / success / error states and the way back.
  assert.match(src.verify, /role=\{result\.ok \? "status" : "alert"\}/);
  assert.match(src.verify, /Ya confirmé: iniciar sesión/);
});

test("6. expired or cross-device confirmation link: clear message and a way to ask for a new one", () => {
  assert.equal(callback.callbackFailurePath("/"), "/login?error=enlace-invalido");
  assert.equal(callback.callbackFailurePath("/cursos"), "/login?error=enlace-invalido&returnTo=%2Fcursos");
  assert.equal(callback.callbackFailurePath("/actualizar-password"), "/recuperar-password?estado=enlace-invalido");
  assert.match(src.callback, /callbackFailurePath\(next\)/);
  assert.doesNotMatch(src.callback, /auth-callback-failed/);
  assert.ok(errors.AUTH_NOTICE_MESSAGES["enlace-invalido"].includes("iniciá sesión"));
  assert.match(src.login, /AUTH_NOTICE_MESSAGES\[searchParams\.get\("error"\)/, "only known codes are shown");
  assert.equal(errors.friendlyAuthError({ code: "otp_expired" }, "login").message, "El enlace venció o ya se usó. Pedí uno nuevo.");
});

// ---------------------------------------------------------------------------------------------------------------
// 7–8. Login and recovery
// ---------------------------------------------------------------------------------------------------------------

test("7. login: Spanish errors, unconfirmed email offers the resend, returns to the requested page", () => {
  assert.equal(errors.friendlyAuthError({ code: "invalid_credentials" }, "login").message, "El email o la contraseña no son correctos.");
  assert.equal(errors.friendlyAuthError({ message: "Invalid login credentials" }, "login").message, "El email o la contraseña no son correctos.");
  const unconfirmed = errors.friendlyAuthError({ message: "Email not confirmed" }, "login");
  assert.equal(unconfirmed.needsEmailConfirmation, true);
  assert.equal(errors.friendlyAuthError({ message: "Something new from Supabase" }, "login").message, "No pudimos iniciar sesión. Probá de nuevo en unos minutos.");
  assert.equal(errors.friendlyAuthError({ message: "Failed to fetch" }, "signup").message, "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.");
  assert.match(src.login, /friendlyAuthError\(signInError, "login"\)/);
  assert.match(src.login, /window\.location\.assign\(returnTo\)/);
  assert.doesNotMatch(src.login, /setError\(error\.message\)/);
});

test("8. password recovery: neutral answer, Spanish errors, expired link notice, continues into the app", () => {
  assert.match(src.recover, /Si hay una cuenta con ese email, te enviamos un enlace/);
  assert.match(src.recover, /friendlyAuthError\(resetError, "recovery"\)/);
  assert.match(src.recover, /estado"\) === "enlace-invalido"/);
  assert.doesNotMatch(src.recover, /setError\(resetError\.message\)/);
  assert.match(src.update, /friendlyAuthError\(updateError, "update_password"\)/);
  assert.equal(errors.friendlyAuthError({ code: "same_password" }, "update_password").message, "La nueva contraseña tiene que ser distinta de la anterior.");
});

// ---------------------------------------------------------------------------------------------------------------
// 9–14. Free / Premium / anonymous navigation and returnTo
// ---------------------------------------------------------------------------------------------------------------

test("9/10. a Free account uses the Calculator and the Profile without being sent to the paywall", () => {
  assert.equal(auth("/calculadora"), null);
  assert.equal(auth("/perfil"), null);
  assert.equal(auth("/api/calculator/catalog"), null);
  assert.equal(auth("/onboarding"), null);
});

test("11. a Free account asking for a Premium section lands on the access screen", () => {
  for (const path of ["/", "/cursos", "/stampy", "/mi-taller/productos", "/configuracion"]) {
    assert.deepEqual(auth(path), { redirect: "/sin-acceso" }, path);
  }
});

test("12. a Premium account reaches its sections", () => {
  for (const path of ["/", "/cursos", "/stampy", "/configuracion", "/perfil", "/calculadora"]) {
    assert.equal(auth(path, { hasAccess: true }), null, path);
  }
  assert.deepEqual(routes.adminRoute("/admin/usuarios", false), { redirect: "/" });
  assert.equal(routes.adminRoute("/admin/usuarios", true), null);
});

test("13. a visitor asking for a private page goes to login keeping the destination", () => {
  assert.deepEqual(routes.anonymousRoute("/cursos", ""), { redirect: "/login?returnTo=%2Fcursos" });
  assert.deepEqual(routes.anonymousRoute("/cursos/abc", "?clase=2"), { redirect: "/login?returnTo=%2Fcursos%2Fabc%3Fclase%3D2" });
  assert.deepEqual(routes.anonymousRoute("/perfil", ""), { redirect: "/login?returnTo=%2Fperfil" });
  assert.equal(routes.anonymousRoute("/api/mercadopago/membership", ""), null, "the payment APIs answer 401 themselves");
});

test("14. returnTo: only internal destinations, no loops; an already signed-in person is sent there", () => {
  const ok = { "/cursos": "/cursos", "/calculadora?from=signup": "/calculadora?from=signup", "/cursos#clase": "/cursos#clase" };
  for (const [input, expected] of Object.entries(ok)) assert.equal(returnTo.sanitizeReturnTo(input), expected, input);
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "javascript:alert(1)", "evil", "", null, "/login", "/login?returnTo=/x", "/registro", "/auth/callback?next=/x", "/verificar-email"]) {
    assert.equal(returnTo.sanitizeReturnTo(bad), "/", String(bad));
  }
  assert.equal(returnTo.sanitizeReturnTo("/%2F%2Fevil.example"), "/%2F%2Fevil.example", "stays on our origin");
  assert.equal(returnTo.loginPathFor("/", ""), "/login");

  assert.deepEqual(auth("/login", { returnToParam: "/cursos", hasAccess: true }), { redirect: "/cursos" });
  assert.deepEqual(auth("/login", { returnToParam: "/cursos" }), { redirect: "/cursos" }, "the next request applies permissions");
  assert.deepEqual(auth("/login", { returnToParam: "https://evil.example" }), { redirect: "/sin-acceso" });
  assert.deepEqual(auth("/registro", { hasAccess: true }), { redirect: "/" });
});

// ---------------------------------------------------------------------------------------------------------------
// 15–16. Onboarding (Free included) and profile update
// ---------------------------------------------------------------------------------------------------------------

test("15. Free accounts onboard too; it is skippable, keeps the destination and never traps APIs or access screens", () => {
  const free = policy.evaluateAccessPolicy({ authenticated: true, role: null, membershipStatus: null, membershipExpiresAt: null, onboardingCompleted: false, grants: [] });
  assert.equal(free.needsOnboarding, true);
  assert.equal(free.capabilities.accessPlatform, false, "onboarding never grants access");
  const anon = policy.evaluateAccessPolicy({ authenticated: false, role: null, membershipStatus: null, membershipExpiresAt: null, onboardingCompleted: false, grants: [] });
  assert.equal(anon.needsOnboarding, false);

  assert.deepEqual(auth("/", { needsOnboarding: true }), { redirect: "/onboarding" });
  assert.deepEqual(auth("/perfil", { needsOnboarding: true }), { redirect: "/onboarding?returnTo=%2Fperfil" });
  assert.deepEqual(auth("/cursos", { needsOnboarding: true, hasAccess: true }), { redirect: "/onboarding?returnTo=%2Fcursos" });
  for (const exempt of ["/onboarding", "/sin-acceso", "/pago/estado", "/salir", "/api/mercadopago/membership", "/api/calculator/catalog", "/landing", "/verificar-email"]) {
    assert.equal(routes.isOnboardingExempt(exempt), true, exempt);
  }
  // A profile that could not be read never forces the onboarding.
  assert.match(src.middleware, /needsOnboarding: !accessError && access\.needsOnboarding/);
  assert.match(src.onboarding, /Completar más tarde/);
  assert.match(src.onboarding, /window\.location\.replace\(returnTo\)/);
});

test("16. onboarding updates only the own row with non-privileged columns, no INSERT, no personal data in logs", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  assert.deepEqual(onboarding.buildOnboardingUpdate(null, now), {
    onboarding_completed: true,
    onboarding_completed_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  const full = onboarding.buildOnboardingUpdate(
    { displayName: "  Fede  ", printerBrand: "bambu_lab", printerModel: "A1 Mini", experienceLevel: "basic", mainGoal: "sell_products" },
    now,
  );
  assert.equal(full.display_name, "Fede");
  assert.equal(full.main_printer_model, "A1 Mini");
  for (const key of Object.keys(full)) assert.ok(onboarding.ONBOARDING_COLUMNS.includes(key), key);
  const privileged = ["role", "membership_status", "membership_expires_at", "membership_started_at", "member_level", "active_months", "email", "id"];
  for (const key of privileged) assert.equal(key in full, false, key);

  const partial = onboarding.buildOnboardingUpdate({ displayName: "", printerBrand: "hacker", printerModel: "", experienceLevel: "", mainGoal: "" }, now);
  assert.deepEqual(Object.keys(partial).sort(), ["onboarding_completed", "onboarding_completed_at", "updated_at"], "unknown values and blanks are not written");
  assert.equal(onboarding.buildOnboardingUpdate({ displayName: "", printerBrand: "none_yet", printerModel: "X", experienceLevel: "", mainGoal: "" }, now).main_printer_model, "");

  assert.doesNotMatch(src.onboarding, /console\.(log|error)/);
  assert.doesNotMatch(src.onboarding, /\.insert\(/);
  assert.match(src.onboarding, /\.update\(buildOnboardingUpdate\(/);
  assert.match(src.onboarding, /\.eq\("id", user\.id\)/);
  assert.doesNotMatch(src.onboarding, /phone|commercial_stage/, "no data that is not needed");
});

// ---------------------------------------------------------------------------------------------------------------
// /sin-acceso, brand, legal, mobile contracts
// ---------------------------------------------------------------------------------------------------------------

test("/sin-acceso distinguishes a visitor from a Free account and is not a dead end", () => {
  // Landing 5.6: the screen is the Premium activation (membership first); the free tools stay as support.
  assert.match(src.sinAcceso, /!isAuthenticated\s*\?\s*"Para activar Premium, entrá a tu cuenta"/);
  assert.match(src.sinAcceso, /"Activá tu membresía Premium"/);
  // A visitor keeps the intent to subscribe when signing in or registering.
  assert.match(src.sinAcceso, /premiumAuthHref\("login", returnPath\)/);
  assert.match(src.sinAcceso, /premiumAuthHref\("registro", returnPath\)/);
  assert.match(src.sinAcceso, /href="\/verificar-email"/);
  assert.match(src.sinAcceso, /calculatorAvailable && \(\s*<Link\s+href="\/calculadora"/);
  assert.match(src.sinAcceso, /href="\/perfil"/);
  assert.match(src.sinAcceso, /comparison\.rows\.filter\(\(row\) => row\.featured\)/);
  // "Cerrar sesión" / "Actualizar acceso" only exist for a signed-in account.
  const logoutIndex = src.sinAcceso.indexOf("Cerrar sesión");
  assert.ok(src.sinAcceso.lastIndexOf("{isAuthenticated && (", logoutIndex) > src.sinAcceso.indexOf('id="free-tools-title"'));
  // Free tools follow the real feature flags (resolved on the server).
  assert.match(src.sinAccesoPage, /resolveFeatureAccess\(flags, "calculadora", \{ isAdmin: false \}\)\.allowed/);
  // Checkout untouched.
  assert.match(src.sinAcceso, /fetch\("\/api\/mercadopago\/create-subscription"/);
});

test("brand: the access screens say Universo Stampa", () => {
  for (const [name, source] of Object.entries({ login: src.login, registro: src.registro, verify: src.verify, recover: src.recover, update: src.update, onboarding: src.onboarding })) {
    assert.match(source, /<AuthBrand/, name);
    assert.doesNotMatch(source, /Academia Stampa/, name);
  }
  assert.match(readRepoFile("src/app/layout.tsx"), /title: "Universo Stampa"/);
  assert.match(readRepoFile("src/components/auth/AuthBrand.tsx"), /Universo Stampa/);
});

test("legal: structure without invented text — nothing is published or linked until an approved text exists", () => {
  assert.deepEqual(legal.publishedLegalDocuments(), []);
  assert.equal(legal.isLegalDocumentPublished("terminos"), false);
  assert.deepEqual(legal.footerLegalLinks().map((link) => link.href), [null, null, null]);
  assert.deepEqual(legal.footerLegalLinks().map((link) => link.label), ["Términos y condiciones", "Política de privacidad", "Condiciones de la membresía"]);
  for (const id of ["terminos", "privacidad", "condiciones-membresia", "baja", "arrepentimiento"]) {
    assert.ok(legal.findLegalDocument(id), id);
    assert.equal(legal.legalText(id), null, `${id} has no text yet`);
  }
  const content = readRepoFile("src/content/legal/index.ts");
  assert.doesNotMatch(content, /:\s*"[^"]/, "no placeholder strings");
  assert.match(readRepoFile("src/app/legal/[slug]/page.tsx"), /if \(!doc \|\| !text\) notFound\(\)/);
  assert.match(src.registro, /isLegalDocumentPublished\("terminos"\)/, "acceptance text only when published");
});

test("17. mobile: access screens are single-column, full-height and touch-friendly", () => {
  for (const [name, source] of Object.entries({ verify: src.verify, onboarding: src.onboarding })) {
    assert.match(source, /min-h-dvh/, name);
    assert.match(source, /px-4/, name);
  }
  assert.match(src.onboarding, /min-h-11/, "44 px touch targets for the choices");
  assert.match(src.onboarding, /flex-col-reverse gap-3 border-t border-stampa-border pt-5 sm:flex-row/, "stacked buttons on phones");
  assert.match(src.layout, /pathname === "\/onboarding"/, "onboarding without app navigation");
});
