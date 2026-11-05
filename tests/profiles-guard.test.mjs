// P0-1 — Contrato estático de la guarda de columnas privilegiadas de public.profiles (corre siempre con `npm test`).
// El comportamiento real contra Postgres está en tests/profiles-guard-db.test.mjs (opt-in, embedded-postgres).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const MIGRATION = "supabase/migrations/20261104120000_profiles_privileged_columns_guard.sql";

const PRIVILEGED_COLUMNS = [
  "id",
  "role",
  "membership_status",
  "membership_started_at",
  "membership_expires_at",
  "member_level",
  "active_months",
  "referred_by_user_id",
  "email",
  "created_at",
];

// Únicos lugares autorizados a escribir columnas privilegiadas de profiles:
//   * panel admin (sesión de administrador, permitido por la guarda vía is_admin);
//   * rutas de servidor con service_role (Mercado Pago, alta por código/referido).
const PRIVILEGED_WRITERS = new Set([
  "src/components/admin/users-table.tsx",
  // Membership billing (webhook, sync, cancel) writes membership_* only through this store, with service_role.
  "src/lib/mercadopago/membership-store.ts",
  "src/app/auth/callback/route.ts",
]);

function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(relative);
    return /\.(ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
}

test("la migration protege todas las columnas privilegiadas con un trigger BEFORE INSERT OR UPDATE", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /create or replace function public\.guard_profile_privileged_columns\(\)/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /before insert or update on public\.profiles\s+for each row execute function public\.guard_profile_privileged_columns\(\)/);
  assert.match(sql, /current_user not in \('anon', 'authenticated'\)/, "solo restringe roles de la API");
  assert.match(sql, /public\.is_admin\(auth\.uid\(\)\)/, "los administradores siguen pudiendo editar");
  assert.match(sql, /errcode = '42501'/);
  for (const column of PRIVILEGED_COLUMNS) {
    assert.match(sql, new RegExp(`new\\.${column} is distinct from old\\.${column}`), `UPDATE de ${column} protegido`);
  }
  assert.match(sql, /old\.referral_code is not null and new\.referral_code is distinct from old\.referral_code/);
  assert.match(sql, /revoke all on function public\.guard_profile_privileged_columns\(\) from public, anon, authenticated/);
});

test("la migration documenta un rollback de dos sentencias que no toca datos", () => {
  const sql = read(MIGRATION);
  const rollback = [...sql.matchAll(/^--\s+(drop (?:trigger|function) .+;)\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(rollback, [
    "drop trigger if exists profiles_guard_privileged_columns on public.profiles;",
    "drop function if exists public.guard_profile_privileged_columns();",
  ]);
  assert.doesNotMatch(sql, /^\s*(drop policy|alter policy|revoke (select|update|insert)|grant |delete from|truncate|update public\.)/im);
});

test("ningún código de usuario común escribe columnas privilegiadas de profiles", () => {
  const writers = walk("src").filter((file) =>
    /from\(\s*["']profiles["']\s*\)[\s\S]{0,400}?\.(update|insert|upsert)\(/.test(read(file)),
  );
  assert.ok(writers.length > 0, "se encontraron escrituras a profiles para revisar");

  const offenders = [];
  for (const file of writers) {
    if (PRIVILEGED_WRITERS.has(file)) continue;
    const source = read(file);
    for (const column of PRIVILEGED_COLUMNS.filter((c) => c !== "id")) {
      if (new RegExp(`\\b${column}\\s*:`).test(source)) offenders.push(`${file} -> ${column}`);
    }
  }
  assert.deepEqual(offenders, [], "estas escrituras fallarían con 42501 tras aplicar la guarda");
});

test("las rutas que activan membresías siguen usando service_role (no la sesión del usuario)", () => {
  // Wiring: service role key + the single store that writes membership_*.
  const server = read("src/lib/mercadopago/membership-server.ts");
  assert.match(server, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(server, /new SupabaseMembershipStore\(admin\)/);
  assert.match(read("src/lib/mercadopago/membership-store.ts"), /this\.admin\.from\("profiles"\)\.update\(fields\)/);
  for (const file of [
    "src/app/api/mercadopago/webhook/route.ts",
    "src/app/api/mercadopago/sync-subscription/route.ts",
    "src/app/api/mercadopago/cancel-subscription/route.ts",
  ]) {
    const source = read(file);
    assert.match(source, /createMembershipDependencies\(\)/, file);
    assert.doesNotMatch(source, /from\(\s*["']profiles["']\s*\)/, `${file} no escribe profiles directamente`);
  }
});
