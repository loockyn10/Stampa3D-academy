// Landing 5.6 — recorrido de contratación Premium: la intención («Quiero Premium» → returnTo=/sin-acceso) sobrevive al alta, a la
// confirmación de email, al login y al proxy, sin cobros automáticos ni cambios en Mercado Pago, precios o permisos.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const intent = loadTs("src/lib/auth/premium-intent.ts");
const returnTo = loadTs("src/lib/auth/return-to.ts");
const routes = loadTs("src/lib/auth/route-policy.ts");
const signup = loadTs("src/lib/auth/signup-outcome.ts");
const pending = loadTs("src/lib/auth/pending-verification.ts");
const failure = loadTs("src/lib/auth/callback-failure.ts");
const destination = loadTs("src/lib/auth/access-destination.ts");
const content = loadTs("src/components/landing-hero/commercial/commercial-content.ts");

const PREMIUM = "/sin-acceso";
const authed = (overrides) => ({ pathname: "/", search: "", returnToParam: null, hasAccess: false, needsOnboarding: false, ...overrides });

test("la intención Premium se reconoce solo para el destino /sin-acceso", () => {
  assert.equal(intent.PREMIUM_RETURN_TO, PREMIUM);
  assert.equal(intent.isPremiumIntent("/sin-acceso"), true);
  assert.equal(intent.isPremiumIntent("/sin-acceso?feature=stampy"), true);
  for (const other of ["/", "/calculadora", "/mi-taller", "//sin-acceso", "https://evil.test/sin-acceso", "", null, undefined, "/sin-accesorio"]) {
    assert.equal(intent.isPremiumIntent(other), false, String(other));
  }
  assert.equal(intent.premiumAuthHref("registro"), "/registro?returnTo=%2Fsin-acceso");
  assert.equal(intent.premiumAuthHref("login"), "/login?returnTo=%2Fsin-acceso");
});

test("los CTA Premium de la landing usan el mismo destino que reconoce el registro", () => {
  assert.equal(content.commercialCtas.primary.href, intent.premiumAuthHref("registro"));
  assert.equal(content.commercialCtas.login.href, intent.premiumAuthHref("login"));
  assert.equal(content.PREMIUM_RETURN_TO, intent.PREMIUM_RETURN_TO);
  // /sin-acceso sobrevive a la sanitización de returnTo (no es una pantalla de autenticación).
  assert.equal(returnTo.sanitizeReturnTo(PREMIUM), PREMIUM);
  assert.equal(returnTo.sanitizeReturnTo("/sin-acceso?feature=stampy"), "/sin-acceso?feature=stampy");
});

test("registro contextual: encabezado Premium solo con returnTo=/sin-acceso; el registro gratuito conserva sus textos", () => {
  const page = read("src/app/registro/page.tsx");
  assert.match(page, /const premiumIntent = isPremiumIntent\(returnTo\)/);
  assert.match(page, /Estás a un paso de Universo Premium/);
  assert.match(page, /Creá tu cuenta para continuar con la activación de tu membresía\./);
  assert.match(page, /Crear tu cuenta gratis/);
  assert.match(page, /Usá la Calculadora y armá tu perfil sin pagar/);
  // El encabezado es lo único que depende de la intención: el alta, la confirmación y los códigos no cambian.
  assert.equal(page.match(/premiumIntent/g).length, 2, "premiumIntent solo se declara y se usa en el encabezado");
  assert.match(page, /emailRedirectTo: emailConfirmationRedirect\(window\.location\.origin, returnTo\)/);
  assert.match(page, /nextStepAfterSignup\(\{ hasSession: Boolean\(signUpData\.session\), returnTo \}\)/);
  assert.match(page, /window\.location\.assign\(destination\)/);
  assert.match(page, /href=\{`\/login\?returnTo=\$\{encodeURIComponent\(returnTo\)\}`\}/);
  // Registrarse no inicia ningún cobro.
  assert.doesNotMatch(page, /mercadopago|create-subscription|init_point/i);
});

test("recorrido 1: usuario nuevo con sesión inmediata entra directo a /sin-acceso, sin pasar por el onboarding", () => {
  assert.deepEqual({ ...signup.nextStepAfterSignup({ hasSession: true, returnTo: PREMIUM }) }, { kind: "enter", to: PREMIUM });
  // El proxy no desvía /sin-acceso al onboarding aunque falte completarlo: se completa después de activar (resolvePostAccessDestination).
  assert.equal(routes.isOnboardingExempt(PREMIUM), true);
  assert.equal(routes.authenticatedRoute(authed({ pathname: PREMIUM, hasAccess: false, needsOnboarding: true })), null);
  assert.equal(destination.resolvePostAccessDestination({ authenticated: true, capabilities: { accessPlatform: true }, needsOnboarding: true }), "/onboarding");
});

test("recorrido 2: si hay que confirmar el email, la intención viaja por la pantalla de verificación, el enlace del email y los casos de falla", () => {
  assert.deepEqual({ ...signup.nextStepAfterSignup({ hasSession: false, returnTo: PREMIUM }) }, { kind: "verify_email", to: "/verificar-email?returnTo=%2Fsin-acceso" });
  assert.equal(pending.emailConfirmationRedirect("https://app.test", PREMIUM), "https://app.test/auth/callback?next=%2Fsin-acceso");
  // El callback usa `next` sanitizado y lleva a /sin-acceso.
  const callback = read("src/app/auth/callback/route.ts");
  assert.match(callback, /sanitizeReturnTo\(searchParams\.get\('next'\)\)/);
  assert.match(callback, /NextResponse\.redirect\(new URL\(next, origin\)\)/);
  // Enlace vencido o abierto en otro navegador: va al login conservando el destino.
  assert.equal(failure.callbackFailurePath(PREMIUM), "/login?error=enlace-invalido&returnTo=%2Fsin-acceso");

  const verify = read("src/app/verificar-email/page.tsx");
  assert.match(verify, /const loginHref = returnTo === "\/" \? "\/login" : `\/login\?returnTo=\$\{encodeURIComponent\(returnTo\)\}`/);
  // Antes «Registrarme con otro email» perdía el destino: ahora lo conserva.
  assert.match(verify, /const registerHref = returnTo === "\/" \? "\/registro" : `\/registro\?returnTo=\$\{encodeURIComponent\(returnTo\)\}`/);
  assert.match(verify, /href=\{registerHref\}/);
  assert.doesNotMatch(verify, /href="\/registro"/);
  assert.match(verify, /emailConfirmationRedirect\(window\.location\.origin, returnTo\)/, "el reenvío conserva el destino");
  assert.match(verify, /Al confirmarlo seguís con la activación de tu membresía\./);
});

test("recorrido 3: quien ya tiene cuenta inicia sesión y vuelve a /sin-acceso (login, error de enlace y cuenta sin confirmar)", () => {
  const login = read("src/app/login/page.tsx");
  assert.match(login, /window\.location\.assign\(returnTo\)/);
  assert.match(login, /const verifyHref = returnTo === "\/" \? "\/verificar-email" : `\/verificar-email\?returnTo=/);
  assert.match(login, /href=\{`\/registro\?returnTo=\$\{encodeURIComponent\(returnTo\)\}`\}/);
  assert.match(login, /Iniciá sesión para continuar con la activación de tu membresía Premium\./);
  assert.match(login, /Accedé a tu cuenta de Universo Stampa\./);
  assert.equal(routes.isPublicPath("/login"), true);
  assert.equal(routes.isPublicPath("/registro"), true);
  assert.equal(routes.isPublicPath("/verificar-email"), true);
  // Un visitante sin sesión que toca «Quiero Premium» o «Ya tengo cuenta» no es redirigido a otro lado.
  assert.equal(routes.anonymousRoute("/registro", "?returnTo=%2Fsin-acceso"), null);
  assert.equal(routes.anonymousRoute("/login", "?returnTo=%2Fsin-acceso"), null);
  assert.equal(routes.anonymousRoute(PREMIUM, ""), null);
});

test("recorrido 4: usuario autenticado sin Premium que toca «Quiero Premium» llega a /sin-acceso; un miembro sigue su camino normal", () => {
  for (const pathname of ["/registro", "/login"]) {
    const decision = routes.authenticatedRoute(authed({ pathname, search: "?returnTo=%2Fsin-acceso", returnToParam: PREMIUM, hasAccess: false, needsOnboarding: true }));
    assert.deepEqual({ ...decision }, { redirect: PREMIUM }, `${pathname} con cuenta Free`);
  }
  // Un miembro con acceso que vuelve a tocar el botón: /sin-acceso lo reenvía a la app (nunca vuelve a cobrar).
  const member = routes.authenticatedRoute(authed({ pathname: "/registro", returnToParam: PREMIUM, hasAccess: true }));
  assert.deepEqual({ ...member }, { redirect: PREMIUM });
  assert.equal(destination.resolvePostAccessDestination({ authenticated: true, capabilities: { accessPlatform: true }, needsOnboarding: false }), "/");
  assert.match(read("src/app/sin-acceso/page.tsx"), /if \(destination\) redirect\(destination\)/);
  // Sin returnTo el comportamiento anterior no cambia.
  assert.deepEqual({ ...routes.authenticatedRoute(authed({ pathname: "/registro", hasAccess: false })) }, { redirect: PREMIUM });
  assert.deepEqual({ ...routes.authenticatedRoute(authed({ pathname: "/registro", hasAccess: true })) }, { redirect: "/" });
});

test("/sin-acceso: la membresía es protagonista (precio vigente, beneficios reales) y las herramientas gratuitas quedan como apoyo", () => {
  const client = read("src/app/sin-acceso/sin-acceso-client.tsx");
  assert.match(client, /Activá tu membresía Premium/);
  assert.match(client, /Desbloqueá \$\{lockedFeature\.title\} con Premium/);
  assert.doesNotMatch(client, /Tu cuenta gratuita/);
  assert.doesNotMatch(client, /Gratis con tu cuenta/);
  assert.doesNotMatch(client, /membershipOffer/, "ya no usa la lista antigua (mencionaba presupuestos)");
  // Beneficios: los mismos datos verificados de la landing, sin inventar nada.
  assert.match(client, /comparison\.rows\.filter\(\(row\) => row\.featured\)/);
  const benefits = content.comparison.rows.filter((row) => row.featured).map((row) => `${row.name} ${row.premium}`).join(" ");
  assert.doesNotMatch(benefits, /presupuesto|Mi Negocio|Stampa Maker|tienda|sorteo|beta|descuento|cancel/i);
  // Precio vigente: sigue saliendo de membership_settings (sin cifras escritas a mano), con su estado provisional.
  assert.match(client, /\.from\("membership_settings"\)/);
  assert.doesNotMatch(client, /\b(9\.900|19\.900|19900|9900)\b/);
  assert.match(client, /El precio se confirma en Mercado Pago antes de pagar\./);
  // Herramientas gratuitas: se conservan, después de la membresía.
  const premiumAt = client.indexOf('id="premium-title"');
  const freeAt = client.indexOf('id="free-tools-title"');
  assert.ok(premiumAt > -1 && freeAt > premiumAt, "la membresía va antes que las herramientas gratuitas");
  assert.match(client, /href="\/calculadora"/);
  assert.match(client, /href="\/perfil"/);
  assert.match(client, /calculatorAvailable &&/);
  // Sin sesión: «Crear mi cuenta» e «Iniciar sesión» conservan la intención.
  assert.match(client, /premiumAuthHref\("registro", returnPath\)/);
  assert.match(client, /premiumAuthHref\("login", returnPath\)/);
});

test("/sin-acceso no genera contrataciones automáticas ni cambia el checkout", () => {
  const client = read("src/app/sin-acceso/sin-acceso-client.tsx");
  // Solo el botón (y «Empezar un pago nuevo») llaman al checkout: ninguna carga de página, efecto o redirección lo dispara.
  assert.equal(client.match(/handleCreateSubscription/g).length, 3, "definición + dos botones");
  assert.match(client, /onClick=\{handleCreateSubscription\}/);
  assert.match(client, /onClick=\{\(event\) => handleCreateSubscription\(event, true\)\}/);
  assert.equal(client.match(/fetch\("\/api\/mercadopago\/create-subscription"/g).length, 1);
  assert.match(client, /Activar membresía/);
  assert.match(client, /idempotency_key: idempotencyKey/);
  // El canje de códigos y «Actualizar acceso» siguen disponibles.
  assert.match(client, /<BetaCodeRedeemCard/);
  assert.match(client, /Actualizar acceso/);
});

test("no se anuncia la promoción de lanzamiento ni se tocan precios en ninguna pantalla del recorrido", () => {
  for (const file of ["src/app/registro/page.tsx", "src/app/login/page.tsx", "src/app/verificar-email/page.tsx", "src/app/sin-acceso/sin-acceso-client.tsx", "src/lib/auth/premium-intent.ts"]) {
    assert.doesNotMatch(read(file), /primeros 50|50 primeros|promoci[oó]n de lanzamiento|\b9\.900\b|oferta de lanzamiento/i, file);
  }
});
