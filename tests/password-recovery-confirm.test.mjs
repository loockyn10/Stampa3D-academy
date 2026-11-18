// Recuperación de contraseña por token_hash: /auth/confirm → verifyOtp al pulsar el botón → /actualizar-password.
// Causa del incidente (landing): el Site URL de Supabase apuntaba a otro dominio y el redirect_to no estaba permitido, así que
// el enlace caía en «/?code=…» y el proxy manda a los visitantes de «/» a /landing. El enlace nuevo no usa redirect_to.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile } from "./helpers/load-ts.mjs";

const cache = new Map();
const link = loadTs("src/lib/auth/recovery-link.ts", {}, cache);
const routes = loadTs("src/lib/auth/route-policy.ts", {}, cache);
const params = (query) => new URLSearchParams(query);

test("parseRecoveryLink: solo acepta type=recovery con un token_hash de forma válida", () => {
  assert.deepEqual({ ...link.parseRecoveryLink(params("token_hash=abcDEF123_-xyz789&type=recovery")) }, { tokenHash: "abcDEF123_-xyz789" });
  assert.equal(link.parseRecoveryLink(params("token_hash=abcDEF123_-xyz789&type=signup")), null);
  assert.equal(link.parseRecoveryLink(params("token_hash=abcDEF123_-xyz789")), null);
  assert.equal(link.parseRecoveryLink(params("type=recovery")), null);
  assert.equal(link.parseRecoveryLink(params("token_hash=&type=recovery")), null);
  assert.equal(link.parseRecoveryLink(params("token_hash=corto&type=recovery")), null);
  assert.equal(link.parseRecoveryLink(params("token_hash=" + encodeURIComponent("<script>alert(1)</script>") + "&type=recovery")), null);
  assert.equal(link.parseRecoveryLink(params("token_hash=" + "a".repeat(300) + "&type=recovery")), null);
  assert.equal(link.parseRecoveryLink(null), null);
  assert.equal(link.RECOVERY_NEXT_PATH, "/actualizar-password");
});

test("/auth/confirm y /actualizar-password nunca terminan en /landing (visitante ni cuenta sin Premium)", () => {
  for (const pathname of ["/auth/confirm", "/actualizar-password", "/recuperar-password"]) {
    assert.equal(routes.isPublicPath(pathname), true, pathname);
    assert.equal(routes.anonymousRoute(pathname, "?token_hash=abcdefgh12345678&type=recovery"), null, `${pathname}: visitante`);
    assert.equal(routes.isOnboardingExempt(pathname), true, `${pathname}: sin onboarding forzado`);
    for (const hasAccess of [false, true]) {
      assert.equal(routes.authenticatedRoute({ pathname, search: "", returnToParam: null, hasAccess, needsOnboarding: true }), null, `${pathname}: sesión de recuperación (access=${hasAccess})`);
    }
  }
  // Lo que pasaba: un enlace que caía en «/» (con ?code=) iba a la landing y perdía el token.
  assert.deepEqual(routes.anonymousRoute("/", "?code=abc"), { redirect: "/landing" });
});

test("la página de confirmación no consume el token al cargar: solo al pulsar el botón (escáneres de correo)", () => {
  const client = readRepoFile("src/app/auth/confirm/confirm-recovery.tsx");
  const page = readRepoFile("src/app/auth/confirm/page.tsx");
  assert.equal((client.match(/verifyOtp\(/g) ?? []).length, 1);
  assert.doesNotMatch(client, /useEffect/, "ningún efecto canjea el token");
  assert.match(client, /const handleContinue = async \(\) =>[\s\S]*verifyOtp\(\{ type: "recovery", token_hash: link\.tokenHash \}\)/);
  assert.match(client, /onClick=\{handleContinue\}/);
  assert.match(client, /window\.location\.assign\(RECOVERY_NEXT_PATH\)/);
  assert.doesNotMatch(client, /console\./, "el token nunca se registra");
  assert.match(page, /referrer: "no-referrer"/);
  assert.match(page, /robots: \{ index: false/);
});

test("el enlace del correo de recuperación apunta a /auth/confirm en el dominio fijo y no depende del Site URL del panel", () => {
  const templates = loadTs("src/lib/email/templates.ts", {}, cache);
  assert.equal(templates.RECOVERY_ACTION_URL, "https://universo-stampa.com/auth/confirm?token_hash={{ .TokenHash }}&type=recovery");
  const reset = templates.AUTH_EMAIL_TEMPLATES.find((t) => t.id === "reset-password");
  assert.ok(reset.html.includes(templates.RECOVERY_ACTION_URL));
  assert.ok(!reset.html.includes("ConfirmationURL") && !reset.html.includes("SiteURL"));
});

test("/actualizar-password avisa al abrir si no hay sesión de recuperación y /recuperar-password sigue sin revelar cuentas", () => {
  const update = readRepoFile("src/app/actualizar-password/page.tsx");
  assert.match(update, /supabase\.auth\s*\.getUser\(\)/);
  assert.match(update, /updateUser\(\{\s*password: password,?\s*\}\)/);
  assert.match(update, /signOut\(\{ scope: "others" \}\)/);
  const recover = readRepoFile("src/app/recuperar-password/page.tsx");
  assert.match(recover, /Si hay una cuenta con ese email/);
});
