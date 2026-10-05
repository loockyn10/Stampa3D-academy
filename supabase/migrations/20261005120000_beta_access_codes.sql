-- Beta access through invitation codes.
--
-- Beta access is NOT a paid subscription. A redeemed code writes a `beta_tester` row in
-- public.user_access_grants (the existing, independent access layer: src/lib/auth/access-policy.ts
-- already treats it as platform access without touching profiles.membership_* or subscriptions).
-- This migration adds only what was missing: hashed codes, an auditable redemption ledger, an
-- atomic/idempotent/rate-limited redemption RPC and admin-only create/revoke RPCs.
--
-- Plaintext codes are never stored: only a SHA-256 digest of the normalized code.
--
-- Does NOT touch has_platform_access(uuid): it only verifies (and aborts if it cannot) that the live function
-- already honours user_access_grants.
--
-- Also hardens table privileges on public.user_access_grants (revokes TRUNCATE/REFERENCES/TRIGGER from anon and
-- authenticated and everything from anon); see the final section. service_role and has_platform_access are untouched.
--
-- Apply after 20260921120000_maker_mug_projects.sql, and only after the diagnostics file reports a compatible state.
-- Safe to re-run (idempotent).

do $beta_access_dependencies$
begin
  if to_regclass('public.profiles') is null then raise exception 'Missing dependency: public.profiles'; end if;
  if to_regclass('public.user_access_grants') is null then raise exception 'Missing dependency: public.user_access_grants'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if to_regprocedure('public.is_admin(uuid)') is null then raise exception 'Missing dependency: public.is_admin(uuid)'; end if;
end;
$beta_access_dependencies$;

-- SAFETY GUARD (fail closed). has_platform_access(uuid) is NOT versioned in supabase/migrations and its live
-- body is unknown. This migration never creates, replaces or alters it. Beta grants only reach RLS if the live
-- function already honours user_access_grants (status + expires_at), so we refuse to continue otherwise.
-- This is a necessary check, not a sufficient one: also read the function definition printed by
-- supabase/diagnostics/20261005_beta_access_state.sql before applying.
do $beta_access_compat$
declare
  v_def text := pg_get_functiondef(to_regprocedure('public.has_platform_access(uuid)'));
begin
  if v_def not ilike '%user_access_grants%' or v_def not ilike '%expires_at%' or v_def not ilike '%status%' then
    raise exception
      'Beta access migration aborted: public.has_platform_access(uuid) does not visibly honour user_access_grants (status + expires_at), so Beta grants would NOT pass RLS. Nothing was changed.'
      using hint = 'Run supabase/diagnostics/20261005_beta_access_state.sql, review the function definition and update it manually in a separate, reviewed step. Then re-run this migration.';
  end if;
end;
$beta_access_compat$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.beta_access_codes (
  id uuid primary key default gen_random_uuid(),
  code_digest text not null,
  label text not null,
  active boolean not null default true,
  max_uses integer,
  -- Until when the code can be redeemed.
  redeem_until timestamptz,
  -- Until when a tester keeps access once redeemed (null = no expiry). Independent of redeem_until.
  access_expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,

  constraint beta_access_codes_digest_key unique (code_digest),
  constraint beta_access_codes_digest_check check (code_digest ~ '^[0-9a-f]{64}$'),
  constraint beta_access_codes_label_check check (char_length(btrim(label)) between 1 and 120),
  constraint beta_access_codes_max_uses_check check (max_uses is null or max_uses > 0)
);

comment on table public.beta_access_codes is
  'Beta invitation codes. Only a SHA-256 digest of the normalized code is stored. A beta code is not a subscription.';

create table if not exists public.beta_access_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.beta_access_codes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  access_expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,

  -- One redemption per (code, user): the same user redeeming again never consumes another use.
  constraint beta_access_redemptions_code_user_key unique (code_id, user_id)
);

create index if not exists beta_access_redemptions_user_idx
  on public.beta_access_redemptions (user_id);

comment on table public.beta_access_redemptions is
  'Auditable ledger of beta code redemptions. Uses of a code = rows here (revoked rows still count). Effective access lives in user_access_grants.';

-- Failed (invalid) attempts only; used to rate-limit code guessing. Written exclusively by redeem_beta_access_code.
create table if not exists public.beta_access_failed_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists beta_access_failed_attempts_user_idx
  on public.beta_access_failed_attempts (user_id, attempted_at desc);
create index if not exists beta_access_failed_attempts_time_idx
  on public.beta_access_failed_attempts (attempted_at);

-- ---------------------------------------------------------------------------
-- RLS / privileges
-- All writes go through the security definer RPCs below. Nothing is exposed to anon.
-- ---------------------------------------------------------------------------

alter table public.beta_access_codes enable row level security;
alter table public.beta_access_redemptions enable row level security;
alter table public.beta_access_failed_attempts enable row level security;

revoke all on table public.beta_access_codes from anon, authenticated;
revoke all on table public.beta_access_redemptions from anon, authenticated;
revoke all on table public.beta_access_failed_attempts from anon, authenticated;

-- A user can read only their own redemptions (no digests are reachable: codes has no policy).
grant select on table public.beta_access_redemptions to authenticated;

drop policy if exists beta_access_redemptions_select_own on public.beta_access_redemptions;
create policy beta_access_redemptions_select_own
  on public.beta_access_redemptions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists beta_access_redemptions_admin_select on public.beta_access_redemptions;
create policy beta_access_redemptions_admin_select
  on public.beta_access_redemptions for select to authenticated
  using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Normalization + digest (internal helpers)
-- Must stay equivalent to normalizeBetaAccessCode() in src/lib/beta-access/code.ts.
-- ---------------------------------------------------------------------------

create or replace function public.normalize_beta_access_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(p_code, ''), '^\s+|\s+$', '', 'g'),
        '[‐-―−]', '-', 'g'),
      '\s+', '-', 'g'))
$$;

create or replace function public.beta_access_code_digest(p_normalized_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to('beta-access:v1:' || coalesce(p_normalized_code, ''), 'UTF8')), 'hex')
$$;

revoke all on function public.normalize_beta_access_code(text) from public, anon, authenticated;
revoke all on function public.beta_access_code_digest(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- redeem_beta_access_code: atomic, idempotent, rate-limited. Identity = auth.uid() only.
--
-- Always returns a jsonb {status, ...} instead of raising for business outcomes, so failed
-- attempts are committed (needed for the brute-force counter). Statuses:
--   unauthenticated | rate_limited | invalid | expired | exhausted | revoked | already_redeemed | redeemed
-- The code row is locked (FOR UPDATE) while uses are counted and the redemption is inserted, so
-- concurrent redemptions of a max_uses=1 code can never both succeed.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_beta_access_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_norm text;
  v_code public.beta_access_codes%rowtype;
  v_existing public.beta_access_redemptions%rowtype;
  v_grant record;
  v_uses integer;
  v_user_failures integer;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;

  -- Housekeeping + brute-force guard: 5 invalid attempts / 15 min PER USER. Deliberately no shared/global
  -- counter: one user's failures must never be able to lock out the other testers.
  delete from public.beta_access_failed_attempts where attempted_at < v_now - interval '1 day';

  select count(*) into v_user_failures
  from public.beta_access_failed_attempts
  where user_id = v_uid and attempted_at > v_now - interval '15 minutes';

  if v_user_failures >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  v_norm := public.normalize_beta_access_code(p_code);

  if v_norm !~ '^[A-Z0-9][A-Z0-9_-]{7,63}$' then
    insert into public.beta_access_failed_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_code
  from public.beta_access_codes
  where code_digest = public.beta_access_code_digest(v_norm)
  for update;

  if not found then
    insert into public.beta_access_failed_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Idempotency: the same user never consumes a second use of the same code.
  select * into v_existing
  from public.beta_access_redemptions
  where code_id = v_code.id and user_id = v_uid;

  if found then
    if v_existing.revoked_at is not null
       or not exists (
         select 1 from public.user_access_grants g
         where g.user_id = v_uid and g.grant_type = 'beta_tester' and g.status = 'active'
       ) then
      return jsonb_build_object('status', 'revoked');
    end if;
    return jsonb_build_object('status', 'already_redeemed', 'access_expires_at', v_existing.access_expires_at);
  end if;

  if not v_code.active then
    insert into public.beta_access_failed_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'invalid');
  end if;

  if (v_code.redeem_until is not null and v_now > v_code.redeem_until)
     or (v_code.access_expires_at is not null and v_now >= v_code.access_expires_at) then
    return jsonb_build_object('status', 'expired');
  end if;

  select count(*) into v_uses from public.beta_access_redemptions where code_id = v_code.id;

  if v_code.max_uses is not null and v_uses >= v_code.max_uses then
    return jsonb_build_object('status', 'exhausted');
  end if;

  -- Grant (independent from the paid membership; never touches profiles / subscriptions).
  perform pg_advisory_xact_lock(hashtextextended('beta_access_grant:' || v_uid::text, 0));

  select g.id, g.status, g.expires_at into v_grant
  from public.user_access_grants g
  where g.user_id = v_uid and g.grant_type = 'beta_tester'
  order by (g.status = 'active') desc, g.expires_at desc nulls first
  limit 1;

  if found then
    if v_grant.status = 'active' and (v_grant.expires_at is null or v_grant.expires_at > v_now) then
      -- Already has live beta access: only ever extend it, never shorten or downgrade it.
      if v_grant.expires_at is not null
         and (v_code.access_expires_at is null or v_code.access_expires_at > v_grant.expires_at) then
        update public.user_access_grants
        set expires_at = v_code.access_expires_at
        where id = v_grant.id;
      end if;
    else
      update public.user_access_grants
      set status = 'active',
          expires_at = v_code.access_expires_at,
          notes = 'Código beta: ' || v_code.label
      where id = v_grant.id;
    end if;
  else
    insert into public.user_access_grants (user_id, grant_type, status, expires_at, notes)
    values (v_uid, 'beta_tester', 'active', v_code.access_expires_at, 'Código beta: ' || v_code.label);
  end if;

  insert into public.beta_access_redemptions (code_id, user_id, redeemed_at, access_expires_at)
  values (v_code.id, v_uid, v_now, v_code.access_expires_at);

  return jsonb_build_object('status', 'redeemed', 'access_expires_at', v_code.access_expires_at);
end;
$$;

revoke all on function public.redeem_beta_access_code(text) from public, anon, authenticated;
grant execute on function public.redeem_beta_access_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_beta_access_code: admin only. Fede runs it once from the Supabase SQL editor
-- (postgres session) or an authenticated admin can call it. The code is hashed here and is
-- never stored or returned.
-- ---------------------------------------------------------------------------

create or replace function public.create_beta_access_code(
  p_code text,
  p_label text,
  p_max_uses integer default null,
  p_redeem_until timestamptz default null,
  p_access_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text;
  v_label text := btrim(coalesce(p_label, ''));
  v_id uuid;
begin
  if not (
    (auth.uid() is not null and public.is_admin(auth.uid()))
    or coalesce(auth.role(), '') = 'service_role'
    or session_user in ('postgres', 'supabase_admin')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_norm := public.normalize_beta_access_code(p_code);
  if v_norm !~ '^[A-Z0-9][A-Z0-9_-]{7,63}$' then
    raise exception 'invalid_code_format: use 8-64 characters (letters, digits, - or _)' using errcode = '22023';
  end if;
  if char_length(v_label) not between 1 and 120 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if p_max_uses is not null and p_max_uses < 1 then
    raise exception 'invalid_max_uses' using errcode = '22023';
  end if;
  if p_redeem_until is not null and p_redeem_until <= now() then
    raise exception 'redeem_until_must_be_in_the_future' using errcode = '22023';
  end if;
  if p_access_expires_at is not null and p_access_expires_at <= now() then
    raise exception 'access_expires_at_must_be_in_the_future' using errcode = '22023';
  end if;

  begin
    insert into public.beta_access_codes
      (code_digest, label, max_uses, redeem_until, access_expires_at, created_by)
    values
      (public.beta_access_code_digest(v_norm), v_label, p_max_uses, p_redeem_until, p_access_expires_at, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'code_already_exists' using errcode = '23505';
  end;

  return jsonb_build_object(
    'id', v_id,
    'label', v_label,
    'max_uses', p_max_uses,
    'redeem_until', p_redeem_until,
    'access_expires_at', p_access_expires_at
  );
end;
$$;

revoke all on function public.create_beta_access_code(text, text, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.create_beta_access_code(text, text, integer, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- revoke_beta_access: admin only. Revokes a user's beta access (grant + redemptions).
-- Does not free the used seat (uses = redemption rows) and the user cannot re-redeem the same code.
-- ---------------------------------------------------------------------------

create or replace function public.revoke_beta_access(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grants integer;
  v_redemptions integer;
begin
  if not (
    (auth.uid() is not null and public.is_admin(auth.uid()))
    or coalesce(auth.role(), '') = 'service_role'
    or session_user in ('postgres', 'supabase_admin')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.user_access_grants
  set status = 'revoked'
  where user_id = p_user_id and grant_type = 'beta_tester' and status = 'active';
  get diagnostics v_grants = row_count;

  update public.beta_access_redemptions
  set revoked_at = now(), revoked_by = auth.uid()
  where user_id = p_user_id and revoked_at is null;
  get diagnostics v_redemptions = row_count;

  return jsonb_build_object('grants_revoked', v_grants, 'redemptions_revoked', v_redemptions);
end;
$$;

revoke all on function public.revoke_beta_access(uuid) from public, anon, authenticated;
grant execute on function public.revoke_beta_access(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privilege hardening of public.user_access_grants (the table Beta grants are written to).
--
-- The remote diagnostic showed table-level privileges that RLS does NOT cover: TRUNCATE (and REFERENCES /
-- TRIGGER) for anon and authenticated. TRUNCATE ignores RLS entirely, so any signed-in user could wipe every
-- access grant. Repo audit (src/, tests/, supabase/):
--   * no code uses TRUNCATE, REFERENCES or TRIGGER on this table, and nothing references it with a foreign key;
--   * anon never reads or writes it (it is only read with the user's own JWT or the service role);
--   * authenticated legitimately needs SELECT (own grants), and INSERT/UPDATE for admins only: the admin
--     server action grantBetaAccessAdmin and /admin/usuarios ("Revocar Beta") write as authenticated, restricted by
--     the existing policy "Admins can manage access grants" (is_admin). No DELETE is used, but INSERT/UPDATE/DELETE
--     are intentionally KEPT for authenticated: RLS (admin-only writes) already confines them.
--   * service_role is not touched.
-- Redemption does not depend on any of these privileges: redeem_beta_access_code is security definer.
-- Idempotent; part of this (not yet applied) migration so it ships together with Beta Access.
-- ---------------------------------------------------------------------------

revoke all on table public.user_access_grants from anon;
revoke truncate, references, trigger on table public.user_access_grants from public, authenticated;

notify pgrst, 'reload schema';
