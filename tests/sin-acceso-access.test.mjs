import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function load(relativePath, deps = {}) {
  const filename = path.join(root, relativePath);
  const { outputText } = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const m = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (r) => { if (r in deps) return deps[r]; throw new Error(`Unexpected dependency: ${r}`); },
    m,
    m.exports,
  );
  return m.exports;
}

const policy = load("src/lib/auth/access-policy.ts");
const { resolvePostAccessDestination } = load("src/lib/auth/access-destination.ts");

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

function destination(overrides = {}) {
  const input = {
    authenticated: true, role: null, membershipStatus: null, membershipExpiresAt: null,
    onboardingCompleted: true, grants: [], ...overrides,
  };
  const evaluation = policy.evaluateAccessPolicy(input);
  return resolvePostAccessDestination({ authenticated: input.authenticated, ...evaluation });
}

const grant = (status, expiresAt = null) => [{ grantType: "beta_tester", status, expiresAt }];

test("Free user stays on /sin-acceso", () => assert.equal(destination(), null));
test("paid member is redirected", () =>
  assert.equal(destination({ membershipStatus: "active", membershipExpiresAt: future }), "/"));
test("active Beta grant is redirected", () => assert.equal(destination({ grants: grant("active", future) }), "/"));
test("expired Beta grant stays", () => assert.equal(destination({ grants: grant("active", past) }), null));
test("revoked Beta grant stays", () => assert.equal(destination({ grants: grant("revoked") }), null));
test("anonymous user never gets a destination", () => assert.equal(destination({ authenticated: false, grants: grant("active") }), null));
test("pending onboarding goes to /onboarding, completed goes to the app", () => {
  assert.equal(destination({ grants: grant("active"), onboardingCompleted: false }), "/onboarding");
  assert.equal(destination({ grants: grant("active"), onboardingCompleted: true }), "/");
});

test("page resolves access server-side with the canonical resolver and redirects", () => {
  const page = read("src/app/sin-acceso/page.tsx");
  assert.match(page, /getCurrentUserAccess/);
  assert.match(page, /resolvePostAccessDestination/);
  assert.match(page, /redirect\(destination\)/);
  assert.match(page, /force-dynamic/);
});

test("refresh action re-queries the canonical resolver on the server", () => {
  const action = read("src/app/sin-acceso/actions.ts");
  assert.match(action, /^"use server"/);
  assert.match(action, /getCurrentUserAccess/);
  assert.match(action, /resolvePostAccessDestination/);
});

test("Actualizar acceso revalidates on the server instead of reloading; redeem continues without relogin", () => {
  const client = read("src/app/sin-acceso/sin-acceso-client.tsx");
  assert.doesNotMatch(client, /location\.reload/);
  assert.match(client, /refreshAccessAction\(\)/);
  assert.match(client, /router\.replace\(result\.destination\)/);
  assert.match(client, /Tu acceso todavía no está activo\./);
  assert.match(client, /onRedeemed=\{handleBetaRedeemed\}/);
  assert.match(client, /Acceso Beta activado/);
  assert.doesNotMatch(client, /alert\(|confirm\(/);
});

test("main layout re-resolves access on navigation (no stale snapshot after redeem)", () => {
  assert.match(read("src/app/main-layout.tsx"), /\}, \[supabase, pathname\]\);/);
});

test("sin-acceso page uses theme tokens, no hardcoded light backgrounds", () => {
  const client = read("src/app/sin-acceso/sin-acceso-client.tsx");
  assert.match(client, /bg-stampa-bg/);
  assert.doesNotMatch(client, /#F7F7F9|bg-white(?![\w/])|bg-(orange|red)-(50|100)(?![\d/])/i);
});
