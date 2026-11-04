// DB-level behaviour of supabase/migrations/20261104120000_profiles_privileged_columns_guard.sql against a REAL
// Postgres (embedded, throw-away, local only — never touches Supabase). Opt-in, like the other *-db tests:
//
//   npm i --no-save embedded-postgres pg && node --test tests/profiles-guard-db.test.mjs
//
// The stub reproduces the PRODUCTION configuration of public.profiles as read by
// supabase/diagnostics/20261104_profiles_security_audit.sql on 2026-11-04: same columns and defaults, RLS policies,
// table privileges (authenticated: SELECT + UPDATE, no INSERT/DELETE), is_admin() body and handle_new_user() trigger.
// The first test proves the stub reproduces the vulnerability; the rest prove the migration closes it without
// breaking legitimate flows. Also runs the post-apply verification script and the documented rollback.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireEmbeddedPgLock } from "./helpers/embedded-pg-lock.mjs";

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  ({ default: pg } = await import("pg"));
} catch {
  // optional dev tooling not installed
}

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const migration = read("supabase/migrations/20261104120000_profiles_privileged_columns_guard.sql");
const verifyScript = read("supabase/diagnostics/20261104_profiles_guard_verify.sql");
const rollbackStatements = [...migration.matchAll(/^--\s+(drop (?:trigger|function) .+;)\s*$/gm)].map((m) => m[1]);

const PORT = Number(process.env.PROFILES_GUARD_TEST_PG_PORT) || 54339;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampa-profiles-guard-pg-"));
let server;

const mk = (database = "postgres") => new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database });

const supabaseStub = `
do $r$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator login password 'pw' noinherit; grant anon, authenticated, service_role to authenticator; end if; end $r$;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

// Production shape of public.profiles (diagnostic 2026-11-04, sections C/D/E/F).
const productionProfiles = `
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, avatar_url text, phone text,
  role text not null default 'member',
  membership_status text not null default 'inactive',
  membership_started_at timestamptz, membership_expires_at timestamptz,
  active_months integer not null default 0,
  member_level text not null default 'bronze',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text, company_name text, company_logo_url text, company_city text, company_address text, company_phone text,
  display_name text, onboarding_completed boolean not null default false, onboarding_completed_at timestamptz,
  main_printer_brand text, main_printer_model text, experience_level text, main_goal text, slicer_preference text,
  commercial_stage text, referral_code text unique, referred_by_user_id uuid,
  company_legal_name text, company_cuit text, company_email text, company_province text
);
`;

const productionPolicies = `
alter table public.profiles enable row level security;
create policy "Admins can update profiles" on public.profiles for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "Admins can view all profiles" on public.profiles for select to authenticated using (public.is_admin(auth.uid()));
create policy "Users can update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "Users can view own profile" on public.profiles for select to authenticated using (auth.uid() = id);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
`;

const productionFunctions = `
create or replace function public.is_admin(user_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.profiles where id = user_id and role = 'admin');
$$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.profiles (id, email, full_name, role, membership_status, member_level, active_months)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'member', 'inactive', 'bronze', 0)
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
`;

async function asRole(c, role, uid = null) {
  await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role } : { role })]);
  await c.query(`set session authorization authenticator`);
  await c.query(`set role ${role}`);
}
async function asSuper(c) {
  await c.query(`reset role`);
  await c.query(`reset session authorization`);
  await c.query(`select set_config('request.jwt.claims', '', false)`);
}
async function as(c, role, uid, fn) {
  await asRole(c, role, uid);
  try {
    return await fn();
  } finally {
    await asSuper(c);
  }
}

async function freshDb(name, { withProfiles = true } = {}) {
  const admin = mk();
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
  await admin.end();
  const c = mk(name);
  await c.connect();
  await c.query(supabaseStub);
  if (withProfiles) {
    await c.query(productionProfiles);
    await c.query(productionFunctions);
    await c.query(productionPolicies);
  }
  return c;
}

// Signup goes through auth.users -> handle_new_user, exactly like Supabase Auth.
async function signUp(c, meta = {}) {
  const { rows } = await c.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [`u${Math.random().toString(36).slice(2)}@x.com`, JSON.stringify(meta)],
  );
  return rows[0].id;
}
const profileOf = async (c, id) => (await c.query(`select * from public.profiles where id = $1`, [id])).rows[0];

const guardRejects = (promise) =>
  assert.rejects(promise, (error) => error.code === "42501" && /No autorizado/.test(error.message));

async function main() {
  const releaseLock = await acquireEmbeddedPgLock();
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  try {
    await test("la migration aborta sin dependencias y no crea nada", async () => {
      const c = await freshDb("pg_nodeps", { withProfiles: false });
      try {
        await assert.rejects(c.query(migration), /Missing dependency: public\.profiles/);
        assert.equal((await c.query(`select to_regprocedure('public.guard_profile_privileged_columns()') as f`)).rows[0].f, null);
      } finally {
        await c.end();
      }
    });

    const c = await freshDb("pg_guard");
    const free = await signUp(c, { full_name: "Free" });
    const other = await signUp(c, { full_name: "Otro" });
    const admin = await signUp(c, { full_name: "Admin" });
    await c.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);

    await test("línea base: la configuración de producción SIN el fix permite autopromoverse (vulnerabilidad reproducida)", async () => {
      await as(c, "authenticated", free, async () => {
        const r1 = await c.query(`update public.profiles set role = 'admin' where id = $1`, [free]);
        const r2 = await c.query(`update public.profiles set membership_status = 'active', membership_expires_at = null where id = $1`, [free]);
        assert.equal(r1.rowCount, 1);
        assert.equal(r2.rowCount, 1);
      });
      const p = await profileOf(c, free);
      assert.equal(p.role, "admin");
      assert.equal(p.membership_status, "active");
      await c.query(`update public.profiles set role = 'member', membership_status = 'inactive', membership_expires_at = null where id = $1`, [free]);
    });

    await test("el script de verificación ANTES del fix informa PERMITIDO (MAL) y no deja cambios", async () => {
      const script = verifyScript
        .replace("'00000000-0000-0000-0000-000000000000';", `'${free}';`)
        .replace("v_admin uuid := null;", `v_admin uuid := '${admin}';`);
      const error = await c.query(script).then(() => null, (e) => e);
      assert.ok(error, "el script siempre termina con error para revertir");
      assert.match(error.message, /RESULTADO \(todo revertido\)/);
      assert.match(error.message, /trigger=AUSENTE/);
      assert.equal((error.message.match(/PERMITIDO \(MAL\)/g) ?? []).length, 8);
      const p = await profileOf(c, free);
      assert.equal(p.role, "member");
      assert.equal(p.membership_status, "inactive");
    });

    await test("la migration se aplica y es idempotente (un solo trigger)", async () => {
      await c.query(migration);
      await c.query(migration);
      const { rows } = await c.query(
        `select count(*)::int n from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_guard_privileged_columns' and not tgisinternal`,
      );
      assert.equal(rows[0].n, 1);
      const fn = (await c.query(
        `select prosecdef, has_function_privilege('authenticated', 'public.guard_profile_privileged_columns()', 'EXECUTE') as auth_exec from pg_proc where oid = 'public.guard_profile_privileged_columns()'::regprocedure`,
      )).rows[0];
      assert.equal(fn.prosecdef, false, "security invoker");
      assert.equal(fn.auth_exec, false);
    });

    await test("Free: onboarding, Configuración y Mi negocio siguen funcionando", async () => {
      await as(c, "authenticated", free, async () => {
        const onboarding = await c.query(
          `update public.profiles set full_name = 'Ana', display_name = 'ana', phone = '123', main_printer_brand = 'bambu',
             main_printer_model = 'a1', experience_level = 'beginner', main_goal = 'sell', commercial_stage = null,
             onboarding_completed = true, onboarding_completed_at = now(), updated_at = now() where id = $1`,
          [free],
        );
        const business = await c.query(
          `update public.profiles set company_name = 'Ana 3D', company_legal_name = 'Ana SRL', company_cuit = '20-1-1',
             company_email = 'a@x.com', company_logo_url = null, company_city = 'CABA', company_address = 'x',
             company_phone = '1', company_province = 'BA' where id = $1`,
          [free],
        );
        assert.equal(onboarding.rowCount, 1);
        assert.equal(business.rowCount, 1);
      });
      assert.equal((await profileOf(c, free)).display_name, "ana");
    });

    await test("Free: reenviar los mismos valores privilegiados (fila completa) no falla", async () => {
      await as(c, "authenticated", free, async () => {
        const r = await c.query(
          `update public.profiles set id = id, role = role, membership_status = membership_status,
             membership_started_at = membership_started_at, membership_expires_at = membership_expires_at,
             member_level = member_level, active_months = active_months, referred_by_user_id = referred_by_user_id,
             email = email, created_at = created_at, full_name = full_name where id = $1`,
          [free],
        );
        assert.equal(r.rowCount, 1);
      });
    });

    await test("Free: cada columna privilegiada queda bloqueada (42501) y nada cambia", async () => {
      const attempts = [
        `update public.profiles set role = 'admin' where id = $1`,
        `update public.profiles set membership_status = 'active' where id = $1`,
        `update public.profiles set membership_expires_at = now() + interval '10 years' where id = $1`,
        `update public.profiles set membership_started_at = now() where id = $1`,
        `update public.profiles set member_level = 'elite' where id = $1`,
        `update public.profiles set active_months = 99 where id = $1`,
        `update public.profiles set referred_by_user_id = '${other}' where id = $1`,
        `update public.profiles set email = 'otro@x.com' where id = $1`,
        `update public.profiles set created_at = now() - interval '5 years' where id = $1`,
        `update public.profiles set id = gen_random_uuid() where id = $1`,
        `update public.profiles set display_name = 'ok', role = 'admin' where id = $1`,
      ];
      const before = await profileOf(c, free);
      for (const sql of attempts) {
        await as(c, "authenticated", free, () => guardRejects(c.query(sql, [free])));
      }
      const after = await profileOf(c, free);
      assert.deepEqual(after, before);
    });

    await test("Free: referral_code se asigna una sola vez (NULL -> valor), después queda fijo", async () => {
      await as(c, "authenticated", free, async () => {
        const first = await c.query(`update public.profiles set referral_code = 'ANA-1234' where id = $1 and referral_code is null`, [free]);
        assert.equal(first.rowCount, 1);
        await guardRejects(c.query(`update public.profiles set referral_code = 'CAMBIADO' where id = $1`, [free]));
        await guardRejects(c.query(`update public.profiles set referral_code = null where id = $1`, [free]));
      });
      assert.equal((await profileOf(c, free)).referral_code, "ANA-1234");
    });

    await test("Free: no puede tocar la fila de otro usuario (RLS, 0 filas)", async () => {
      await as(c, "authenticated", free, async () => {
        const r = await c.query(`update public.profiles set membership_status = 'active', display_name = 'x' where id = $1`, [other]);
        assert.equal(r.rowCount, 0);
      });
      assert.equal((await profileOf(c, other)).membership_status, "inactive");
    });

    await test("Free: no puede insertar perfiles (sin privilegio INSERT), ni aunque alguien lo otorgue a futuro", async () => {
      const fresh = (await c.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'sinperfil@x.com') returning id`)).rows[0].id;
      await c.query(`delete from public.profiles where id = $1`, [fresh]);
      await as(c, "authenticated", fresh, () =>
        assert.rejects(c.query(`insert into public.profiles (id) values ($1)`, [fresh]), /permission denied/),
      );

      await c.query(`grant insert on public.profiles to authenticated`);
      await c.query(`create policy tmp_self_insert on public.profiles for insert to authenticated with check (auth.uid() = id)`);
      try {
        await as(c, "authenticated", fresh, async () => {
          await guardRejects(c.query(`insert into public.profiles (id, role) values ($1, 'admin')`, [fresh]));
          await guardRejects(c.query(`insert into public.profiles (id, membership_status, membership_expires_at) values ($1, 'active', now() + interval '1 year')`, [fresh]));
          const ok = await c.query(`insert into public.profiles (id, display_name, onboarding_completed) values ($1, 'nuevo', true)`, [fresh]);
          assert.equal(ok.rowCount, 1);
        });
      } finally {
        await c.query(`drop policy tmp_self_insert on public.profiles`);
        await c.query(`revoke insert on public.profiles from authenticated`);
      }
      assert.equal((await profileOf(c, fresh)).role, "member");
    });

    await test("Admin (/admin/usuarios): sigue editando rol, membresía, nivel y meses de otros usuarios", async () => {
      await as(c, "authenticated", admin, async () => {
        for (const [field, value] of [["membership_status", "active"], ["member_level", "gold"], ["active_months", 3], ["role", "admin"], ["role", "member"]]) {
          const r = await c.query(`update public.profiles set ${field} = $1 where id = $2`, [value, other]);
          assert.equal(r.rowCount, 1, `admin actualiza ${field}`);
        }
      });
      const p = await profileOf(c, other);
      assert.equal(p.membership_status, "active");
      assert.equal(p.member_level, "gold");
      assert.equal(p.active_months, 3);
      assert.equal(p.role, "member");
    });

    await test("service_role (webhook / sync de Mercado Pago) sigue activando y cancelando membresías", async () => {
      await as(c, "service_role", null, async () => {
        const activate = await c.query(
          `update public.profiles set membership_status = 'active', membership_started_at = now(),
             membership_expires_at = now() + interval '1 month' where id = $1`,
          [free],
        );
        assert.equal(activate.rowCount, 1);
        const referral = await c.query(`update public.profiles set referred_by_user_id = $1 where id = $2 and referred_by_user_id is null`, [other, free]);
        assert.equal(referral.rowCount, 1);
      });
      assert.equal((await profileOf(c, free)).membership_status, "active");
      await as(c, "service_role", null, () =>
        c.query(`update public.profiles set membership_status = 'expired', membership_expires_at = now() where id = $1`, [free]),
      );
      assert.equal((await profileOf(c, free)).membership_status, "expired");
    });

    await test("alta de usuario: handle_new_user crea member/inactive aunque la metadata pida admin", async () => {
      const id = await signUp(c, { full_name: "Nuevo", role: "admin", membership_status: "active" });
      const p = await profileOf(c, id);
      assert.equal(p.role, "member");
      assert.equal(p.membership_status, "inactive");
      assert.equal(p.full_name, "Nuevo");
    });

    await test("postgres (SQL Editor / migrations) no se restringe", async () => {
      const r = await c.query(`update public.profiles set member_level = 'silver' where id = $1`, [other]);
      assert.equal(r.rowCount, 1);
    });

    await test("el script de verificación DESPUÉS del fix informa todo OK y no deja cambios", async () => {
      await c.query(`update public.profiles set membership_status = 'inactive', membership_expires_at = null, member_level = 'bronze' where id = $1`, [free]);
      const before = await profileOf(c, free);
      const script = verifyScript
        .replace("'00000000-0000-0000-0000-000000000000';", `'${free}';`)
        .replace("v_admin uuid := null;", `v_admin uuid := '${admin}';`);
      const error = await c.query(script).then(() => null, (e) => e);
      assert.ok(error);
      assert.match(error.message, /trigger=PRESENTE/);
      assert.equal((error.message.match(/BLOQUEADO \(OK\)/g) ?? []).length, 8, error.message);
      assert.doesNotMatch(error.message, /MAL|revisar|inesperado/, error.message);
      assert.match(error.message, /free edita su perfil: OK/);
      assert.match(error.message, /free reenvía valores iguales: OK/);
      assert.match(error.message, /admin edita membresía ajena: OK/);
      assert.match(error.message, /service_role activa membresía: OK/);
      assert.deepEqual(await profileOf(c, free), before);
    });

    await test("el script de verificación se niega a correr sin configurar la cuenta Free", async () => {
      await assert.rejects(c.query(verifyScript), /Configurar v_free/);
    });

    await test("rollback documentado: elimina trigger y función y vuelve al comportamiento anterior", async () => {
      assert.equal(rollbackStatements.length, 2);
      for (const statement of rollbackStatements) await c.query(statement);
      assert.equal((await c.query(`select to_regprocedure('public.guard_profile_privileged_columns()') as f`)).rows[0].f, null);
      await as(c, "authenticated", free, async () => {
        const r = await c.query(`update public.profiles set member_level = 'elite' where id = $1`, [free]);
        assert.equal(r.rowCount, 1, "sin el trigger vuelve a estar abierto");
      });
      await c.query(migration);
      await as(c, "authenticated", free, () => guardRejects(c.query(`update public.profiles set member_level = 'gold' where id = $1`, [free])));
    });

    await c.end();
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    releaseLock();
  }
}

if (!EmbeddedPostgres || !pg) {
  test("profiles guard DB behaviour", { skip: "optional: npm i --no-save embedded-postgres pg" }, () => {});
} else {
  await main();
}
