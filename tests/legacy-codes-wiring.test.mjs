// Static guards for the Beta / discount code fix (migration 20261028120000_beta_redeem_legacy_invite_codes.sql).
// Behaviour against a real Postgres lives in tests/beta-legacy-invite-db.test.mjs (opt-in).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const stripSql = (sql) => sql.replace(/--.*$/gm, "");

function loadTypeScriptModule(relativePath) {
  const filename = path.join(root, relativePath);
  const { outputText } = ts.transpileModule(read(relativePath), {
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

const beta = loadTypeScriptModule("src/lib/beta-access/code.ts");
const migration = read("supabase/migrations/20261028120000_beta_redeem_legacy_invite_codes.sql");
const sql = stripSql(migration);
const action = read("src/app/beta-access/actions.ts");
const registro = read("src/app/registro/page.tsx");
const callback = read("src/app/auth/callback/route.ts");
const adminCodes = read("src/app/admin/codigos/page.tsx");
const checkout = read("src/app/api/mercadopago/create-subscription/route.ts");

test("the redeem pre-check accepts short hand-made legacy codes but still discards junk", () => {
  for (const ok of ["BETA50", "BETA-AB23CD", "UNIVERSO-BETA-7K3Q9X", "abc"]) {
    assert.equal(beta.REDEEMABLE_CODE_SHAPE.test(beta.normalizeBetaAccessCode(ok)), true, ok);
  }
  for (const bad of ["", "AB", "con espacio", "A".repeat(65)]) {
    assert.equal(beta.REDEEMABLE_CODE_SHAPE.test(bad), false, bad);
  }
  // The strict hashed-code rule is unchanged.
  assert.equal(beta.BETA_CODE_SHAPE.test("BETA50"), false);
  assert.match(action, /REDEEMABLE_CODE_SHAPE\.test\(code\)/);
  assert.doesNotMatch(action, /BETA_CODE_SHAPE\.test/);
  assert.match(sql, /\^\[\^\[:space:\]\]\{3,64\}\$/);
});

test("migration is additive, ordered after Beta Access and fails closed", () => {
  assert.match(sql, /to_regprocedure\('public\.redeem_beta_access_code\(text\)'\) is null/);
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /grant_type is not text\/varchar/);
  // Never rewrites data, policies, other functions or earlier migrations' objects.
  const withoutStrings = sql.replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(withoutStrings, /\b(drop\s|truncate\s|alter\s|delete\s+from\s+public\.(invite|user_access|beta_access_codes|beta_access_redemptions)|create\s+policy|has_platform_access\s*\(uuid\)\s*returns)/i);
  assert.doesNotMatch(sql, /update\s+public\.profiles|subscriptions/i);
  // The public entry point keeps its contract and privileges.
  assert.match(sql, /create or replace function public\.redeem_beta_access_code\(p_code text\)/);
  assert.match(sql, /revoke all on function public\.redeem_beta_access_code\(text\) from public, anon, authenticated;\s*grant execute on function public\.redeem_beta_access_code\(text\) to authenticated;/);
  // The internal helper is not exposed and identity stays auth.uid().
  assert.match(sql, /revoke all on function public\.redeem_legacy_beta_invite\(uuid, text\) from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /grant execute on function public\.redeem_legacy_beta_invite/);
  assert.match(sql, /v_uid uuid := auth\.uid\(\)/);
  assert.match(sql, /redeem_legacy_beta_invite\(v_uid, v_norm\)/);
});

test("legacy redemption is atomic, idempotent and never grants access for discount codes", () => {
  assert.match(sql, /from public\.invite_codes\s+where code = p_normalized_code\s+for update/);
  assert.match(sql, /v_type not in \('beta_tester', 'manual_free_access'\)/);
  assert.match(sql, /greatest\(coalesce\(v_inv\.used_count, 0\), v_uses\) >= v_inv\.max_uses/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('beta_access_grant:'/);
  // The plaintext code never goes to grants.notes.
  const notes = [...sql.matchAll(/notes\s*=\s*([^\n]+)|values \([^)]*\)/g)].join(" ");
  assert.doesNotMatch(notes, /p_normalized_code|v_inv\.code\b/);
  // One shared failed-attempt counter: only 'invalid' outcomes are counted, once.
  assert.match(sql, /v_legacy->>'status' = 'invalid'/);
});

test("the shared rate limit still applies to legacy codes (no direct brute-force path)", () => {
  assert.match(sql, /v_user_failures >= 5/);
  assert.match(sql, /where user_id = v_uid and attempted_at > v_now - interval '15 minutes'/);
});

test("signup: a code typed in the referral field gets one silent redemption when the session is immediate", () => {
  assert.match(registro, /else if \(signUpData\.session && normalizedCode\)/);
  assert.match(registro, /redeemBetaAccessCodeAction\(normalizeBetaAccessCode\(normalizedCode\)\)/);
  // Silent: it never opens the "Tu cuenta fue creada" notice nor blocks the Free account.
  const branch = registro.slice(registro.indexOf("else if (signUpData.session && normalizedCode)"), registro.indexOf("window.location.assign(destination);"));
  assert.doesNotMatch(branch, /setBetaNotice|setError/);
  // Beta code and referral code still travel separately; neither the beta field nor a result ever goes to auth metadata.
  const signUpCall = registro.slice(registro.indexOf("supabase.auth.signUp("), registro.indexOf("if (signUpError)"));
  assert.doesNotMatch(signUpCall, /betaCode|normalizedBetaCode/);
});

test("legacy callback no longer hides failed writes", () => {
  assert.match(callback, /result\.error/);
  assert.match(callback, /Legacy code write failed/);
  // Only the error code is logged, never the code or the user.
  assert.doesNotMatch(callback, /console\.error\([^)]*(submittedCode|userId|invite\.code)/);
});

test("discount codes: the list price is server-side only; the redeem RPC for Beta never grants a discount code", () => {
  // The only price sources are membership_settings / MEMBERSHIP_MONTHLY_PRICE (see tests/discount-checkout.test.mjs).
  assert.match(read("src/lib/mercadopago/membership-price.ts"), /from\("membership_settings"\)\s*\.select\("monthly_price, currency"\)/);
  assert.match(checkout, /amount: price,/);
  assert.match(checkout, /\(body as Record<string, unknown>\)\.idempotency_key/);
  assert.doesNotMatch(checkout, /invite_codes|discount_value|discount_type/i);
  // Beta redemption only honours beta / free-access legacy codes: discount types stay "invalid" there.
  assert.match(sql, /v_type not in \('beta_tester', 'manual_free_access'\)/);
  // The admin UI documents how discounts are applied (and the switch that controls it).
  assert.match(adminCodes, /DISCOUNT_CODES_ENABLED=true/);
});

test("codes diagnostic is a single read-only SELECT that never reads code values", () => {
  const diagnostic = stripSql(read("supabase/diagnostics/20261028_codes_state.sql")).trim();
  assert.equal(diagnostic.replace(/\$q\$[\s\S]*?\$q\$/g, "").split(";").filter((part) => part.trim()).length, 1, "exactly one statement");
  assert.match(diagnostic, /^with\b/i);
  const withoutStrings = diagnostic.replace(/\$q\$[\s\S]*?\$q\$/g, (inner) => inner).replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(withoutStrings, /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|drop\s|alter\s|create\s|truncate\s|grant\s|revoke\s|notify\s|call\s)/i);
  // Counts and catalogs only: the plaintext legacy code and user ids are never selected.
  assert.doesNotMatch(diagnostic, /select[^;]*\b((k\.code|invite_codes\.code)\b|code\s*,|user_id\s+as|email\b)/i);
  for (const section of ["0_VERDICT", "A_invite_tables", "B_grants", "C_functions", "D_legacy_counts"]) {
    assert.ok(diagnostic.includes(section), section);
  }
});
