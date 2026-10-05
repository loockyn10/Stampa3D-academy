import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (request) => { throw new Error(`Unexpected dependency: ${request}`); },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const beta = loadTypeScriptModule("src/lib/beta-access/code.ts");
const accessPolicy = loadTypeScriptModule("src/lib/auth/access-policy.ts");
const migration = read("supabase/migrations/20261005120000_beta_access_codes.sql");
const action = read("src/app/beta-access/actions.ts");
const registro = read("src/app/registro/page.tsx");
const perfil = read("src/app/perfil/page.tsx");
const sinAcceso = read("src/app/sin-acceso/sin-acceso-client.tsx");
const callback = read("src/app/auth/callback/route.ts");
const middleware = read("src/utils/supabase/middleware.ts");

function policyInput(overrides = {}) {
  return {
    authenticated: true,
    role: null,
    membershipStatus: null,
    membershipExpiresAt: null,
    onboardingCompleted: true,
    grants: [],
    ...overrides,
  };
}

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
const betaGrant = (overrides = {}) => ({ grantType: "beta_tester", status: "active", expiresAt: future, ...overrides });

// ---------------------------------------------------------------------------
// Code normalization / DTO (frontend never sees hashes or raw RPC payloads)
// ---------------------------------------------------------------------------

test("code normalization: trim, case, inner whitespace and typographic dashes", () => {
  assert.equal(beta.normalizeBetaAccessCode("  universo-beta-7k3q9x \n"), "UNIVERSO-BETA-7K3Q9X");
  assert.equal(beta.normalizeBetaAccessCode("universo beta 7k3q9x"), "UNIVERSO-BETA-7K3Q9X");
  assert.equal(beta.normalizeBetaAccessCode("universo–beta—7k3q9x"), "UNIVERSO-BETA-7K3Q9X");
  assert.equal(beta.normalizeBetaAccessCode(""), "");
});

test("code shape matches the database rule (8-64 chars, A-Z 0-9 - _)", () => {
  assert.equal(beta.BETA_CODE_SHAPE.test("UNIVERSO-BETA-7K3Q9X"), true);
  assert.equal(beta.BETA_CODE_SHAPE.test("SHORT"), false);
  assert.equal(beta.BETA_CODE_SHAPE.test("-LEADING-DASH-1"), false);
  assert.equal(beta.BETA_CODE_SHAPE.test("CON ESPACIO 123"), false);
  assert.equal(beta.BETA_CODE_SHAPE.test("ñandú-1234567"), false);
  assert.equal(beta.BETA_CODE_SHAPE.test("A".repeat(65)), false);
  assert.match(migration, /\^\[A-Z0-9\]\[A-Z0-9_-\]\{7,63\}\$/);
});

test("every status maps to a clear user message and only safe fields reach the UI", () => {
  const expected = {
    redeemed: "Acceso Beta activado.",
    already_redeemed: "Ya canjeaste este código.",
    invalid: "Código inválido.",
    expired: "Este código venció.",
    exhausted: "Este código ya alcanzó el límite de usos.",
  };
  for (const [status, message] of Object.entries(expected)) {
    const result = beta.toBetaRedeemResult({ status });
    assert.equal(result.message, message);
    assert.equal(result.ok, status === "redeemed" || status === "already_redeemed");
  }
  const leaky = beta.toBetaRedeemResult({
    status: "redeemed",
    access_expires_at: future,
    code_digest: "a".repeat(64),
    label: "interno",
    error: "relation public.beta_access_codes does not exist",
  });
  assert.deepEqual(Object.keys(leaky).sort(), ["accessExpiresAt", "message", "ok", "status"]);
  assert.equal(JSON.stringify(leaky).includes("a".repeat(64)), false);
  assert.equal(JSON.stringify(leaky).includes("interno"), false);
});

test("unknown or malformed RPC payloads degrade to a generic non-technical error", () => {
  for (const raw of [null, undefined, "boom", 42, {}, { status: "pg_exception" }, { status: 7 }]) {
    const result = beta.toBetaRedeemResult(raw);
    assert.equal(result.status, "error");
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /rpc|pg|sql|exception|relation/i);
  }
});

test("only definitive outcomes discard the pending code", () => {
  for (const status of ["redeemed", "already_redeemed", "invalid", "expired", "exhausted", "revoked"]) {
    assert.equal(beta.isDefinitiveBetaOutcome(status), true, status);
  }
  for (const status of ["rate_limited", "unauthenticated", "error"]) {
    assert.equal(beta.isDefinitiveBetaOutcome(status), false, status);
  }
});

// ---------------------------------------------------------------------------
// Access model: Beta is a platform grant, never a paid subscription
// ---------------------------------------------------------------------------

test("Free without code keeps no platform access; calculator stays personalizable", () => {
  const free = accessPolicy.evaluateAccessPolicy(policyInput());
  assert.equal(free.capabilities.accessPlatform, false);
  assert.equal(free.capabilities.personalizeCalculator, true);
  assert.deepEqual(free.accessSources, []);
});

test("an active beta grant gives platform access but is NOT a paid membership", () => {
  const result = accessPolicy.evaluateAccessPolicy(policyInput({ grants: [betaGrant()] }));
  assert.equal(result.capabilities.accessPlatform, true);
  assert.equal(result.capabilities.useStampy, true);
  assert.equal(result.membershipValid, false);
  assert.equal(result.capabilities.accessAdmin, false);
  assert.deepEqual(result.accessSources, ["beta_tester"]);
  assert.equal(result.accessSources.includes("membership"), false);
});

test("an expired or revoked beta grant removes platform access", () => {
  assert.equal(accessPolicy.evaluateAccessPolicy(policyInput({ grants: [betaGrant({ expiresAt: past })] })).capabilities.accessPlatform, false);
  assert.equal(accessPolicy.evaluateAccessPolicy(policyInput({ grants: [betaGrant({ status: "revoked" })] })).capabilities.accessPlatform, false);
});

test("a beta grant without expiry is valid until revoked", () => {
  assert.equal(accessPolicy.evaluateAccessPolicy(policyInput({ grants: [betaGrant({ expiresAt: null })] })).capabilities.accessPlatform, true);
});

test("paid and admin keep working and keep their own source", () => {
  const paid = accessPolicy.evaluateAccessPolicy(policyInput({ membershipStatus: "active" }));
  assert.equal(paid.capabilities.accessPlatform, true);
  assert.deepEqual(paid.accessSources, ["membership"]);

  const admin = accessPolicy.evaluateAccessPolicy(policyInput({ role: "admin" }));
  assert.equal(admin.capabilities.accessPlatform, true);
  assert.equal(admin.capabilities.accessAdmin, true);

  const both = accessPolicy.evaluateAccessPolicy(policyInput({ membershipStatus: "active", grants: [betaGrant()] }));
  assert.deepEqual(both.accessSources, ["membership", "beta_tester"]);
});

test("anonymous never gets access from a grant fact", () => {
  const result = accessPolicy.evaluateAccessPolicy(policyInput({ authenticated: false, grants: [betaGrant()] }));
  assert.equal(result.capabilities.accessPlatform, false);
});

test("the client-side access resolver reads grants (so UI and RLS agree) and the middleware gates on accessPlatform", () => {
  assert.match(read("src/lib/auth/user-access.ts"), /from\("user_access_grants"\)/);
  assert.match(middleware, /access\.capabilities\.accessPlatform/);
  assert.match(middleware, /redirectWithCookies\('\/sin-acceso'\)/);
  // Beta redemption must be possible while the user is still Free.
  assert.match(middleware, /pathname\.startsWith\('\/sin-acceso'\)/);
  assert.match(middleware, /pathname === '\/perfil'/);
});

// ---------------------------------------------------------------------------
// Migration (static checks; behaviour is covered by beta-access-db.test.mjs)
// ---------------------------------------------------------------------------

test("migration never stores plaintext codes: only a sha-256 digest column and hashing in SQL", () => {
  assert.match(migration, /code_digest text not null/);
  assert.match(migration, /sha256\(convert_to\('beta-access:v1:'/);
  assert.doesNotMatch(migration, /\bcode text\b/i);
  assert.doesNotMatch(migration, /UNIVERSO-BETA/i);
});

test("migration is additive: new tables only, no ALTER of existing tables, no writes to profiles/subscriptions", () => {
  const sql = migration.replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /alter table public\.(profiles|subscriptions|user_access_grants)/i);
  assert.doesNotMatch(sql, /update public\.profiles/i);
  assert.doesNotMatch(sql, /subscriptions|membership_status = '(?!active)/i);
  assert.doesNotMatch(sql, /drop table/i);
});

test("redemption is atomic: row lock, one redemption per (code, user), uses counted under the lock", () => {
  assert.match(migration, /for update;/);
  assert.match(migration, /constraint beta_access_redemptions_code_user_key unique \(code_id, user_id\)/);
  const lockIndex = migration.indexOf("for update;");
  const countIndex = migration.indexOf("select count(*) into v_uses");
  const insertIndex = migration.indexOf("insert into public.beta_access_redemptions (code_id");
  assert.ok(lockIndex > 0 && lockIndex < countIndex && countIndex < insertIndex);
});

test("redemption identity is auth.uid() only: the RPC takes no user id", () => {
  assert.match(migration, /function public\.redeem_beta_access_code\(p_code text\)/);
  assert.match(migration, /v_uid uuid := auth\.uid\(\)/);
  assert.match(action, /rpc\("redeem_beta_access_code", \{ p_code: code \}\)/);
  assert.doesNotMatch(action, /user_id|userId|p_user/);
});

test("the redemption RPC is only executable by authenticated users; admin RPCs check admin", () => {
  assert.match(migration, /grant execute on function public\.redeem_beta_access_code\(text\) to authenticated;/);
  assert.match(migration, /revoke all on function public\.redeem_beta_access_code\(text\) from public, anon, authenticated;/);
  const adminChecks = migration.match(/public\.is_admin\(auth\.uid\(\)\)/g) ?? [];
  assert.ok(adminChecks.length >= 3, "create/revoke RPCs and the admin select policy verify admin");
  assert.match(migration, /to authenticated, service_role;/);
});

test("users cannot grant themselves access: no write privileges or policies for authenticated on the new tables", () => {
  assert.match(migration, /revoke all on table public\.beta_access_codes from anon, authenticated;/);
  assert.match(migration, /revoke all on table public\.beta_access_redemptions from anon, authenticated;/);
  assert.match(migration, /revoke all on table public\.beta_access_failed_attempts from anon, authenticated;/);
  assert.match(migration, /grant select on table public\.beta_access_redemptions to authenticated;/);
  const policyCommands = [...migration.matchAll(/create policy \w+\s+on [\w.]+ for (\w+)/gi)].map((m) => m[1].toLowerCase());
  assert.ok(policyCommands.length >= 2);
  assert.deepEqual([...new Set(policyCommands)], ["select"]);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all)[^;]* to (anon|authenticated)/i);
  assert.doesNotMatch(migration, /beta_access_codes[^;]*to authenticated/i);
});

test("brute force is limited server-side and failed attempts are committed (statuses returned, not raised)", () => {
  assert.match(migration, /v_user_failures >= 5/);
  // No shared counter: one user must never be able to lock out the other testers.
  assert.doesNotMatch(migration.replace(/--.*$/gm, ""), /global|v_global|attempted_at > v_now - interval '1 hour'/i);
  const limiter = migration.slice(migration.indexOf("select count(*) into v_user_failures"), migration.indexOf("v_norm := public.normalize_beta_access_code"));
  assert.match(limiter, /where user_id = v_uid and attempted_at/);
  assert.match(migration, /beta_access_failed_attempts/);
  assert.match(migration, /'rate_limited'/);
  // Business outcomes inside redeem_beta_access_code are returned, never raised (a raise would roll the attempt back).
  const redeemBody = migration.slice(
    migration.indexOf("function public.redeem_beta_access_code"),
    migration.indexOf("function public.create_beta_access_code"),
  );
  assert.doesNotMatch(redeemBody, /raise exception/);
});

test("redeem_until and access_expires_at are independent columns", () => {
  assert.match(migration, /redeem_until timestamptz/);
  assert.match(migration, /access_expires_at timestamptz/);
  assert.match(migration, /v_code\.redeem_until/);
  assert.match(migration, /expires_at = v_code\.access_expires_at|values \(v_uid, 'beta_tester', 'active', v_code\.access_expires_at/);
});

test("has_platform_access is NEVER created, replaced or altered: the migration only verifies it and aborts (fail closed)", () => {
  const sql = migration.replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /create (or replace )?function public\.has_platform_access/i);
  assert.doesNotMatch(sql, /alter function public\.has_platform_access/i);
  assert.doesNotMatch(sql, /drop function[^;]*has_platform_access/i);
  assert.doesNotMatch(sql, /execute format/i);
  assert.match(sql, /pg_get_functiondef\(to_regprocedure\('public\.has_platform_access\(uuid\)'\)\)/);
  assert.match(sql, /not ilike '%user_access_grants%' or v_def not ilike '%expires_at%' or v_def not ilike '%status%'/);
  assert.match(sql, /raise exception\s+'Beta access migration aborted/);
  assert.match(sql, /Nothing was changed/);
  // The guard runs before anything is created, so an abort leaves no partial state.
  assert.ok(sql.indexOf("beta_access_compat") < sql.indexOf("create table"));
});

test("user_access_grants hardening: revokes only the dangerous privileges and leaves service_role and admin writes alone", () => {
  const sql = migration.replace(/--.*$/gm, "");
  assert.match(sql, /revoke all on table public\.user_access_grants from anon;/);
  assert.match(sql, /revoke truncate, references, trigger on table public\.user_access_grants from public, authenticated;/);
  const grantsStatements = sql.split(";").filter((statement) => /user_access_grants/.test(statement) && /\brevoke\b/i.test(statement));
  assert.equal(grantsStatements.length, 2);
  for (const statement of grantsStatements) {
    assert.doesNotMatch(statement, /service_role/);
    // Only the dangerous privileges are named; SELECT/INSERT/UPDATE/DELETE stay with authenticated (RLS confines them).
    assert.doesNotMatch(statement, /\brevoke\s+(select|insert|update|delete)\b/i);
  }
});

test("repo audit: nothing needs TRUNCATE/REFERENCES/TRIGGER on user_access_grants and admin writes run as authenticated under RLS", () => {
  const usersActions = read("src/app/admin/usuarios/actions.ts");
  // Admin grant management uses the session client (authenticated + admin policy), never the service role.
  assert.match(usersActions, /createClient\(\)/);
  assert.doesNotMatch(usersActions, /SUPABASE_SERVICE_ROLE_KEY|createAdminClient/);
  assert.match(usersActions, /from\("user_access_grants"\)\s*\.update\(grantValues\)|from\("user_access_grants"\)\.update\(grantValues\)/);
  assert.match(read("src/components/admin/users-table.tsx"), /\.update\(\{ status: "revoked" \}\)/);
  // The only service-role writer is the legacy auth callback.
  assert.match(callback, /supabaseAdmin\.from\('user_access_grants'\)\.insert/);
  // No code path truncates, references or defines triggers on the table, and nothing deletes grants.
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|sql)$/.test(entry.name)) sources.push(rel);
    }
  };
  walk("src");
  walk("supabase/migrations");
  for (const file of sources) {
    if (file.includes("20261005120000_beta_access_codes")) continue;
    const content = read(file);
    assert.doesNotMatch(content, /truncate[^;]*user_access_grants/i, file);
    assert.doesNotMatch(content, /references\s+(public\.)?user_access_grants/i, file);
    assert.doesNotMatch(content, /on\s+(public\.)?user_access_grants\s+for\s+each/i, file);
    assert.doesNotMatch(content, /from\(["']user_access_grants["']\)\s*\.delete/i, file);
  }
});

test("diagnostic SQL is a single read-only catalog SELECT covering function, policies, privileges and Beta objects", () => {
  const raw = read("supabase/diagnostics/20261005_beta_access_state.sql");
  const sql = raw.replace(/--.*$/gm, "").trim();
  assert.equal(sql.split(";").filter((part) => part.trim()).length, 1, "exactly one statement");
  assert.match(sql, /^with\b/i);
  const withoutStrings = sql.replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(withoutStrings, /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|drop\s|alter\s|create\s|truncate\s|grant\s|revoke\s|notify\s|call\s)/i);
  // Does not read business tables (so it also works before the migration exists).
  assert.doesNotMatch(sql, /from\s+public\.(invite_codes|beta_access_codes|beta_access_redemptions|user_access_grants|profiles)\b/i);
  for (const section of ["0_VERDICT", "A_functions", "B_policies", "C_privileges", "D_beta_objects"]) {
    assert.ok(sql.includes(section), section);
  }
  assert.match(sql, /pg_policies/);
  assert.match(sql, /pg_get_functiondef/);
});

test("legacy invite_codes is fully isolated from Beta Access", () => {
  const betaFiles = [
    "supabase/migrations/20261005120000_beta_access_codes.sql",
    "src/lib/beta-access/code.ts",
    "src/lib/beta-access/pending-code.ts",
    "src/app/beta-access/actions.ts",
    "src/components/beta-access/BetaCodeRedeemCard.tsx",
    "src/components/beta-access/PendingBetaCodeRedeemer.tsx",
  ];
  for (const file of betaFiles) {
    const content = read(file)
      .replace(/--.*$/gm, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(content, /invite_codes|invite_code_redemptions|resolve-code|resolveRegistrationCode|registration_code|referral_code/i, file);
  }
  // The legacy callback, resolver and admin page do not know about the Beta tables.
  assert.doesNotMatch(callback, /beta_access/);
  assert.doesNotMatch(read("src/lib/codes/resolve-code.ts"), /beta_access/);
  assert.doesNotMatch(read("src/app/admin/codigos/page.tsx"), /beta_access/);
  // Signup keeps two separate fields; the beta code never travels in the legacy registration_code metadata.
  assert.match(registro, /id="ref-code"/);
  assert.match(registro, /id="beta-code"/);
  const signUpCall = registro.slice(registro.indexOf("supabase.auth.signUp("), registro.indexOf("if (signUpError)"));
  assert.match(signUpCall, /registration_code: normalizedCode/);
  assert.doesNotMatch(signUpCall, /betaCode|normalizedBetaCode/);
});

// ---------------------------------------------------------------------------
// Frontend / flows
// ---------------------------------------------------------------------------

test("no beta code, hash or digest exists in source, env names or docs; the frontend never handles digests", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|sql|md|mjs)$/.test(entry.name)) files.push(rel);
    }
  };
  for (const dir of ["src", "supabase", "docs"]) walk(dir);
  for (const file of files) {
    const content = read(file);
    assert.doesNotMatch(content, /NEXT_PUBLIC_[A-Z_]*BETA[A-Z_]*CODE/, `${file} exposes a beta code env var`);
    assert.doesNotMatch(content, /UNIVERSO-BETA-\d{3,}/, `${file} contains a hardcoded beta code`);
    if (file.startsWith("src/")) assert.doesNotMatch(content, /code_digest/, `${file} touches digests`);
  }
});

test("server action returns only the safe DTO and never exposes RPC errors", () => {
  assert.match(action, /toBetaRedeemResult\(data\)/);
  assert.match(action, /toBetaRedeemResult\(\{ status: "error" \}\)/);
  assert.doesNotMatch(action, /error\.message|error\.details|error\.hint|return \{ data|return data/);
  assert.doesNotMatch(action, /SUPABASE_SERVICE_ROLE_KEY|createAdminClient/);
});

test("signup: beta field is optional, free signup is unchanged and the code never goes to auth metadata", () => {
  assert.match(registro, /¿Tenés un código de invitación\?/);
  assert.match(registro, /id="beta-code"/);
  assert.doesNotMatch(registro, /id="beta-code"[^>]*\brequired\b/);
  const signUpCall = registro.slice(registro.indexOf("supabase.auth.signUp("), registro.indexOf("if (signUpError)"));
  assert.match(signUpCall, /emailRedirectTo: `\$\{window\.location\.origin\}\/auth\/callback/);
  assert.match(signUpCall, /full_name: name/);
  assert.doesNotMatch(signUpCall, /betaCode|normalizedBetaCode/);
  // Without a code: same redirect as before the feature.
  assert.match(registro, /window\.location\.assign\(destination\)/);
  assert.match(registro, /returnTo === "\/" \? "\/sin-acceso" : returnTo/);
});

test("signup: with a session the code is redeemed server-side right away; without one it waits for authentication", () => {
  assert.match(registro, /signUpData\.session/);
  assert.match(registro, /redeemBetaAccessCodeAction\(normalizedBetaCode\)/);
  assert.match(registro, /savePendingBetaCode\(normalizedBetaCode\)/);
  // An invalid code never blocks the Free account: the user is told and can continue.
  assert.match(registro, /setBetaNotice\(\{ message: betaResult\.message, destination \}\)/);
  assert.match(registro, /Tu cuenta fue creada\./);
});

test("email-confirmation flow: legacy callback is untouched and pending codes are redeemed after authentication", () => {
  assert.match(callback, /exchangeCodeForSession\(code\)/);
  assert.match(callback, /resolveRegistrationCode/);
  assert.match(callback, /\.from\('user_access_grants'\)\.insert/s);
  assert.doesNotMatch(callback, /beta_access|redeem_beta_access_code/);

  const layout = read("src/app/layout.tsx");
  assert.match(layout, /<PendingBetaCodeRedeemer \/>/);
  const redeemer = read("src/components/beta-access/PendingBetaCodeRedeemer.tsx");
  assert.match(redeemer, /auth\.getSession\(\)/);
  assert.match(redeemer, /if \(!session\) return;/);
  assert.match(redeemer, /isDefinitiveBetaOutcome/);
  const pending = read("src/lib/beta-access/pending-code.ts");
  assert.match(pending, /localStorage/);
  assert.match(pending, /7 \* 24 \* 60 \* 60 \* 1000/);
});

test("existing users can redeem from Perfil and from Sin acceso (manual fallback), only while they lack access", () => {
  assert.match(perfil, /<BetaCodeRedeemCard redirectTo="\/perfil" \/>/);
  assert.match(perfil, /canRedeemBetaCode = !isBetaTester && !isPaidMember && profile\?\.role !== "admin"/);
  assert.match(sinAcceso, /<BetaCodeRedeemCard[\s\S]*onRedeemed=\{handleBetaRedeemed\}/);
  assert.match(sinAcceso, /isAuthenticated && isEmailConfirmed/);
});

test("Perfil shows Beta as Beta Tester, not as a paid plan, and only while the grant is valid", () => {
  assert.match(perfil, /🧪/);
  assert.match(perfil, /Beta Tester/);
  assert.match(perfil, /No es una suscripción\./);
  assert.match(perfil, /const showBetaOnlyBadges = isBetaTester && !isPaidMember/);
  assert.match(perfil, /!showBetaOnlyBadges && \(/);
  assert.match(perfil, /grantData\.expires_at \|\| new Date\(grantData\.expires_at\)\.getTime\(\) > Date\.now\(\)/);
  assert.doesNotMatch(perfil, /Plan Premium/i);
  assert.doesNotMatch(perfil, /betaGrant\.notes/);
});

test("redeem card is mobile-safe and accessible", () => {
  const card = read("src/components/beta-access/BetaCodeRedeemCard.tsx");
  assert.match(card, /flex-col gap-2 sm:flex-row/);
  assert.match(card, /min-w-0/);
  assert.match(card, /text-base[^"]*sm:text-sm/);
  assert.match(card, /aria-live="polite"/);
  assert.match(card, /break-words/);
  assert.match(card, /htmlFor="beta-redeem-code"/);
  assert.match(registro, /min-w-0/);
});
