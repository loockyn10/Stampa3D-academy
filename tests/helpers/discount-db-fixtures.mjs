// Shared fixtures for the discount-code database tests (embedded Postgres, local only, never Supabase).
// Supabase pieces (auth, roles, subscriptions) and the legacy invite_codes tables (not versioned in the repo) are stubbed;
// the real checkout_attempts migration and the discount migrations are applied by the tests.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

export const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

export const migrations = {
  checkout: read("supabase/migrations/202608250001_checkout_attempts.sql"),
  discount: read("supabase/migrations/20261029120000_discount_code_checkout.sql"),
  consistency: read("supabase/migrations/20261030120000_discount_checkout_consistency.sql"),
};

export const stub = `
do $r$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator login password 'pw' noinherit; grant anon, authenticated, service_role to authenticator; end if; end $r$;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  mercado_pago_preapproval_id text, status text, payer_email text, amount numeric, currency text, raw_data jsonb,
  next_payment_at timestamptz, started_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
`;

export const legacyTables = `
create table public.invite_codes (
  id uuid primary key default gen_random_uuid(), code text not null unique, code_type text not null, title text,
  status text not null default 'active', max_uses integer, used_count integer not null default 0,
  starts_at timestamptz, expires_at timestamptz, access_expires_at timestamptz, discount_type text,
  discount_value numeric, discount_duration text default 'forever', applies_to text, notes text, created_by uuid,
  created_at timestamptz default now());
create table public.invite_code_redemptions (
  id uuid primary key default gen_random_uuid(), invite_code_id uuid not null references public.invite_codes(id),
  user_id uuid not null references auth.users(id), redeemed_at timestamptz default now());
alter table public.invite_codes enable row level security;
alter table public.invite_code_redemptions enable row level security;
`;

export function makeDb(pg, port) {
  const mk = (database = "postgres") => new pg.Client({ host: "localhost", port, user: "postgres", password: "pw", database });

  async function freshDb(name, { checkout = true, legacy = true, discount = false, consistency = false } = {}) {
    const admin = mk();
    await admin.connect();
    await admin.query(`drop database if exists ${name}`);
    await admin.query(`create database ${name} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
    await admin.end();
    const c = mk(name);
    await c.connect();
    await c.query(stub);
    if (checkout) await c.query(migrations.checkout);
    if (legacy) await c.query(legacyTables);
    if (discount) await c.query(migrations.discount);
    if (consistency) await c.query(migrations.consistency);
    return c;
  }

  const newUser = async (c) => (await c.query(`insert into auth.users (email) values ($1) returning id`, [`u${Math.random()}@x.com`])).rows[0].id;

  const insertCode = async (c, code, fields = {}) => {
    const f = { code_type: "discount_percent", discount_value: 20, discount_duration: "forever", status: "active", ...fields };
    const keys = ["code", ...Object.keys(f)];
    return (await c.query(
      `insert into public.invite_codes (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
      [code, ...Object.values(f)],
    )).rows[0].id;
  };

  const BASE = 19900;
  const reserve = async (c, uid, code, { base = BASE, dryRun = false, ttl = 30, currency = "ARS" } = {}) =>
    (await c.query(`select public.reserve_discount_code($1,$2,$3,$4,$5,$6) as r`, [uid, code, base, currency, dryRun, ttl])).rows[0].r;
  const usedCount = async (c, code) => (await c.query(`select used_count from public.invite_codes where code=$1`, [code])).rows[0].used_count;
  const reservationRows = async (c, uid) => (await c.query(`select * from public.discount_code_reservations where user_id=$1 order by created_at`, [uid])).rows;
  const confirm = async (c, preapprovalId) => (await c.query(`select public.confirm_discount_reservation($1) as r`, [preapprovalId])).rows[0].r;
  const attach = async (c, uid, reservationId, attemptId) =>
    (await c.query(`select public.attach_discount_reservation($1,$2,$3) as r`, [uid, reservationId, attemptId])).rows[0].r.status;

  let seq = 0;
  /** Creates a COMPLETED checkout attempt (as the checkout flow does) at the given amount. */
  async function checkout(c, uid, amount, { subscriptionStatus = "pending" } = {}) {
    seq += 1;
    const key = `50000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
    const begin = (await c.query(`select public.begin_membership_checkout($1,$2,$3,'ARS','p@x.com','Membresía','https://x.test/back') as r`, [uid, key, amount])).rows[0].r;
    assert.equal(begin.action, "call_provider", JSON.stringify(begin));
    const preapproval = `pre_${seq}_${Math.random().toString(36).slice(2, 8)}`;
    await c.query(`select public.complete_membership_checkout($1,$2,$3,'https://mp.test/init','pending','{}'::jsonb)`, [begin.attempt_id, begin.claim_token, preapproval]);
    if (subscriptionStatus !== "pending") await c.query(`update public.subscriptions set status=$2 where mercado_pago_preapproval_id=$1`, [preapproval, subscriptionStatus]);
    return { attemptId: begin.attempt_id, preapprovalId: preapproval };
  }

  /** reserve + checkout at the reserved amount + attach: what the route does for a buyer. */
  async function buyWithCode(c, uid, code, opts = {}) {
    const r = await reserve(c, uid, code, opts);
    if (r.status !== "reserved") return { reservation: r, attempt: null };
    const attempt = await checkout(c, uid, Number(r.final_amount));
    const attached = await attach(c, uid, r.reservation_id, attempt.attemptId);
    assert.equal(attached, "attached");
    return { reservation: r, attempt };
  }

  const connect = async (database) => {
    const x = mk(database);
    await x.connect();
    return x;
  };

  return { mk, freshDb, newUser, insertCode, BASE, reserve, usedCount, reservationRows, confirm, attach, checkout, buyWithCode, connect };
}
