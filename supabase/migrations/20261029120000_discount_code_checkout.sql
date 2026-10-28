-- Discount codes in the membership checkout.
--
-- Until now /admin/codigos stored discount codes (invite_codes.code_type discount_percent / discount_fixed_amount /
-- fixed_price) but nothing applied them: create-subscription always charged membership_settings.monthly_price.
--
-- This migration adds the server-side pieces. It is additive: no existing table, policy, function, code, redemption,
-- subscription or checkout attempt is modified, except the explicit supersede function below, which only ever closes
-- a never-authorized pending attempt on request of that same user.
--
--   * public.discount_code_reservations: one row per reservation of a code for a user. A use is RESERVED when the
--     checkout is created (price locked into the Mercado Pago preapproval), CONFIRMED when Mercado Pago authorizes the
--     subscription, RELEASED when the checkout is cancelled/replaced and EXPIRED after the TTL. Capacity of a code =
--     max(used_count, real redemptions) + live reservations, so a 1-use code cannot be sold twice.
--   * public.reserve_discount_code(...): validates + computes the price + reserves, atomically (user advisory lock +
--     row lock on the code). Also a dry-run for the price preview. Per-user rate limit for invalid guesses.
--   * public.discount_code_final_amount(...): THE pricing rule (the app never computes a discounted price).
--   * attach / confirm / release / describe / close functions used by the checkout route and the Mercado Pago webhook.
--
-- Only the duration 'forever' is supported (Mercado Pago has a single recurring amount): 'once' codes answer
-- 'unsupported'. Discount codes never grant access; they only change the amount of a new membership checkout.
-- Everything is executable by service_role only (the Next.js server, identity taken from the session there).
--
-- Does NOT touch has_platform_access, RLS of other tables, profiles or invite_codes rows. Safe to re-run.

do $discount_dependencies$
declare
  v_missing text;
begin
  if to_regclass('public.invite_codes') is null
     or to_regclass('public.invite_code_redemptions') is null
     or to_regclass('public.checkout_attempts') is null
     or to_regclass('public.subscriptions') is null then
    raise exception 'Missing dependency: public.invite_codes, public.invite_code_redemptions, public.checkout_attempts and public.subscriptions are required. Nothing was changed.';
  end if;

  select string_agg(req.tbl || '.' || req.col, ', ') into v_missing
  from (values
    ('invite_codes', 'id'), ('invite_codes', 'code'), ('invite_codes', 'code_type'), ('invite_codes', 'status'),
    ('invite_codes', 'starts_at'), ('invite_codes', 'expires_at'), ('invite_codes', 'max_uses'),
    ('invite_codes', 'used_count'), ('invite_codes', 'discount_value'), ('invite_codes', 'discount_duration'),
    ('invite_code_redemptions', 'invite_code_id'), ('invite_code_redemptions', 'user_id'),
    ('invite_code_redemptions', 'redeemed_at'),
    ('checkout_attempts', 'id'), ('checkout_attempts', 'user_id'), ('checkout_attempts', 'amount'),
    ('checkout_attempts', 'currency'), ('checkout_attempts', 'state'), ('checkout_attempts', 'closed_at'),
    ('checkout_attempts', 'last_error_code'), ('checkout_attempts', 'mercado_pago_preapproval_id'),
    ('checkout_attempts', 'subscription_id'),
    ('subscriptions', 'id'), ('subscriptions', 'status'), ('subscriptions', 'cancelled_at'),
    ('subscriptions', 'updated_at')
  ) as req(tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = req.tbl and c.column_name = req.col
  );

  if v_missing is not null then
    raise exception 'Missing expected columns: %. Nothing was changed.', v_missing
      using hint = 'Run supabase/diagnostics/20261029_discount_codes_state.sql and review the table shapes.';
  end if;

  -- Foreign keys below are uuid: refuse to continue otherwise.
  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'invite_codes' and c.column_name = 'id' and c.data_type = 'uuid'
  ) then
    raise exception 'public.invite_codes.id is not uuid. Nothing was changed.';
  end if;
end;
$discount_dependencies$;

-- ---------------------------------------------------------------------------
-- Tables (service_role only: RLS on, no policies, nothing for anon / authenticated)
-- ---------------------------------------------------------------------------

create table if not exists public.discount_code_reservations (
  id uuid primary key default gen_random_uuid(),
  invite_code_id uuid not null references public.invite_codes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'reserved',
  base_amount numeric(12, 2) not null,
  final_amount numeric(12, 2) not null,
  currency text not null,
  code_type text not null,
  discount_value numeric not null,
  checkout_attempt_id uuid references public.checkout_attempts(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  released_at timestamptz,
  constraint discount_code_reservations_status_check check (status in ('reserved', 'confirmed', 'released', 'expired')),
  constraint discount_code_reservations_amounts_check check (base_amount > 0 and final_amount > 0 and final_amount < base_amount),
  constraint discount_code_reservations_currency_check check (currency ~ '^[A-Z]{3}$')
);

comment on table public.discount_code_reservations is
  'Reservations of discount codes for membership checkouts: reserved -> confirmed (subscription authorized) | released | expired. Locks the discounted amount sent to Mercado Pago.';

create unique index if not exists discount_code_reservations_one_reserved_per_user_idx
  on public.discount_code_reservations (user_id) where status = 'reserved';
create unique index if not exists discount_code_reservations_one_use_per_user_idx
  on public.discount_code_reservations (invite_code_id, user_id) where status in ('reserved', 'confirmed');
create index if not exists discount_code_reservations_code_status_idx
  on public.discount_code_reservations (invite_code_id, status);
create index if not exists discount_code_reservations_attempt_idx
  on public.discount_code_reservations (checkout_attempt_id);

create table if not exists public.discount_code_failed_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists discount_code_failed_attempts_user_idx
  on public.discount_code_failed_attempts (user_id, attempted_at desc);

alter table public.discount_code_reservations enable row level security;
alter table public.discount_code_failed_attempts enable row level security;
revoke all on table public.discount_code_reservations from anon, authenticated;
revoke all on table public.discount_code_failed_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The one pricing rule. NULL = the code gives no valid benefit for this base price.
--   discount_percent       : base * (1 - value/100), 0 < value < 100
--   discount_fixed_amount  : base - value, value > 0
--   fixed_price            : value
-- Rounded to 2 decimals; a result <= 0 or >= base is not a discount.
-- ---------------------------------------------------------------------------

create or replace function public.discount_code_final_amount(p_code_type text, p_value numeric, p_base numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case when s.r > 0 and s.r < p_base then s.r end
  from (
    select round(
      case p_code_type
        when 'discount_percent' then case when p_value > 0 and p_value < 100 then p_base * (1 - p_value / 100) end
        when 'discount_fixed_amount' then case when p_value > 0 then p_base - p_value end
        when 'fixed_price' then case when p_value > 0 then p_value end
      end, 2) as r
  ) s
$$;

-- ---------------------------------------------------------------------------
-- reserve_discount_code: validate + price + reserve (or dry-run) for p_user_id.
-- Returns jsonb {status, ...}. Statuses: ok (dry run) | reserved | invalid | expired | exhausted | unsupported |
-- no_benefit | already_used | rate_limited. Business outcomes never raise, so failed attempts are committed.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_discount_code(
  p_user_id uuid,
  p_code text,
  p_base_amount numeric,
  p_currency text,
  p_dry_run boolean default false,
  p_ttl_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_base numeric(12, 2);
  v_norm text;
  v_inv public.invite_codes%rowtype;
  v_type text;
  v_final numeric;
  v_uses integer;
  v_failures integer;
  v_existing public.discount_code_reservations%rowtype;
  v_res public.discount_code_reservations%rowtype;
begin
  if p_user_id is null then
    raise exception 'discount user is required';
  end if;
  if p_base_amount is null or p_base_amount <= 0 then
    raise exception 'discount base amount must be greater than zero';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'discount currency must be an ISO-style uppercase code';
  end if;
  if p_ttl_minutes is null or p_ttl_minutes < 1 or p_ttl_minutes > 240 then
    raise exception 'discount reservation ttl must be between 1 and 240 minutes';
  end if;

  v_base := round(p_base_amount, 2);

  -- Serializes every discount decision of this user (separate key from the checkout lock).
  perform pg_advisory_xact_lock(hashtextextended('discount_code:' || p_user_id::text, 0));

  delete from public.discount_code_failed_attempts where user_id = p_user_id and attempted_at < v_now - interval '1 day';

  select count(*) into v_failures
  from public.discount_code_failed_attempts
  where user_id = p_user_id and attempted_at > v_now - interval '15 minutes';

  if v_failures >= 8 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  v_norm := upper(regexp_replace(btrim(coalesce(p_code, '')), '\s+', '-', 'g'));

  if v_norm = '' or char_length(v_norm) > 64 then
    insert into public.discount_code_failed_attempts (user_id) values (p_user_id);
    return jsonb_build_object('status', 'invalid');
  end if;

  if p_dry_run then
    select * into v_inv from public.invite_codes where code = v_norm;
  else
    select * into v_inv from public.invite_codes where code = v_norm for update;
  end if;

  v_type := v_inv.code_type::text;

  -- Beta / free access codes and unknown codes are indistinguishable from "not a discount code".
  if v_inv.id is null or v_type not in ('discount_percent', 'discount_fixed_amount', 'fixed_price') then
    insert into public.discount_code_failed_attempts (user_id) values (p_user_id);
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_inv.status::text <> 'active' or (v_inv.starts_at is not null and v_inv.starts_at > v_now) then
    insert into public.discount_code_failed_attempts (user_id) values (p_user_id);
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_inv.expires_at is not null and v_inv.expires_at <= v_now then
    return jsonb_build_object('status', 'expired');
  end if;

  -- Mercado Pago preapprovals have one recurring amount: first-month-only discounts are not supported yet.
  if coalesce(v_inv.discount_duration::text, 'forever') <> 'forever' then
    return jsonb_build_object('status', 'unsupported');
  end if;

  if exists (
    select 1 from public.discount_code_reservations r
    where r.invite_code_id = v_inv.id and r.user_id = p_user_id and r.status = 'confirmed'
  ) then
    return jsonb_build_object('status', 'already_used');
  end if;

  if not p_dry_run then
    update public.discount_code_reservations
    set status = 'expired'
    where invite_code_id = v_inv.id and status = 'reserved' and expires_at <= v_now;
  end if;

  -- Capacity: the larger of the stored counter and the real redemptions, plus live reservations of OTHER users.
  select greatest(coalesce(v_inv.used_count, 0), (select count(*) from public.invite_code_redemptions where invite_code_id = v_inv.id))
       + (select count(*) from public.discount_code_reservations
          where invite_code_id = v_inv.id and status = 'reserved' and expires_at > v_now and user_id <> p_user_id)
  into v_uses;

  if v_inv.max_uses is not null and v_uses >= v_inv.max_uses then
    return jsonb_build_object('status', 'exhausted');
  end if;

  v_final := public.discount_code_final_amount(v_type, v_inv.discount_value::numeric, v_base);

  if v_final is null then
    return jsonb_build_object('status', 'no_benefit');
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'status', 'ok',
      'base_amount', v_base,
      'final_amount', v_final,
      'discount_amount', v_base - v_final,
      'code_type', v_type
    );
  end if;

  select * into v_existing
  from public.discount_code_reservations
  where user_id = p_user_id and status = 'reserved'
  for update;

  if v_existing.id is not null then
    if v_existing.invite_code_id = v_inv.id
       and v_existing.expires_at > v_now
       and v_existing.base_amount = v_base
       and v_existing.final_amount = v_final
       and v_existing.currency = p_currency then
      return jsonb_build_object(
        'status', 'reserved',
        'reservation_id', v_existing.id,
        'base_amount', v_existing.base_amount,
        'final_amount', v_existing.final_amount,
        'discount_amount', v_existing.base_amount - v_existing.final_amount,
        'code_type', v_existing.code_type,
        'expires_at', v_existing.expires_at,
        'reused', true
      );
    end if;

    -- A different code, another price or a lapsed reservation: the old one stops holding a use.
    update public.discount_code_reservations
    set status = case when v_existing.expires_at <= v_now then 'expired' else 'released' end,
        released_at = v_now
    where id = v_existing.id;
  end if;

  insert into public.discount_code_reservations
    (invite_code_id, user_id, base_amount, final_amount, currency, code_type, discount_value, expires_at)
  values
    (v_inv.id, p_user_id, v_base, v_final, p_currency, v_type, v_inv.discount_value::numeric,
     v_now + make_interval(mins => p_ttl_minutes))
  returning * into v_res;

  return jsonb_build_object(
    'status', 'reserved',
    'reservation_id', v_res.id,
    'base_amount', v_res.base_amount,
    'final_amount', v_res.final_amount,
    'discount_amount', v_res.base_amount - v_res.final_amount,
    'code_type', v_res.code_type,
    'expires_at', v_res.expires_at,
    'reused', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- attach_discount_reservation: ties a reservation to the checkout attempt that carries its amount. The database
-- verifies that the attempt belongs to the user and was created with exactly the reserved final amount.
-- ---------------------------------------------------------------------------

create or replace function public.attach_discount_reservation(p_user_id uuid, p_reservation_id uuid, p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.discount_code_reservations%rowtype;
  v_att public.checkout_attempts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('discount_code:' || p_user_id::text, 0));

  select * into v_res
  from public.discount_code_reservations
  where id = p_reservation_id and user_id = p_user_id
  for update;

  if v_res.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into v_att
  from public.checkout_attempts
  where id = p_attempt_id and user_id = p_user_id;

  if v_att.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_res.status = 'confirmed' and v_res.checkout_attempt_id = v_att.id then
    return jsonb_build_object('status', 'attached');
  end if;

  if v_res.status <> 'reserved' then
    return jsonb_build_object('status', 'not_reservable');
  end if;

  if v_att.state not in ('creating', 'reconciliation_required', 'completed')
     or v_att.amount <> v_res.final_amount
     or v_att.currency <> v_res.currency then
    return jsonb_build_object('status', 'amount_mismatch');
  end if;

  -- An attempt carries one discount: earlier unconfirmed reservations of the same attempt stop holding a use.
  update public.discount_code_reservations
  set status = 'released', released_at = now()
  where checkout_attempt_id = v_att.id and id <> v_res.id and status in ('reserved', 'expired');

  update public.discount_code_reservations set checkout_attempt_id = v_att.id where id = v_res.id;

  return jsonb_build_object('status', 'attached');
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_discount_reservation: Mercado Pago authorized the preapproval. Idempotent. The price is already contracted,
-- so an expired (not released) reservation is honoured too.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_discount_reservation(p_preapproval_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.discount_code_reservations%rowtype;
begin
  select r.* into v_res
  from public.discount_code_reservations r
  join public.checkout_attempts a on a.id = r.checkout_attempt_id
  where a.mercado_pago_preapproval_id = p_preapproval_id
    and r.status in ('reserved', 'expired', 'confirmed')
  order by (r.status = 'confirmed') desc, r.created_at desc
  limit 1;

  if v_res.id is null then
    return jsonb_build_object('status', 'none');
  end if;

  if v_res.status = 'confirmed' then
    return jsonb_build_object('status', 'already_confirmed');
  end if;

  -- Lock order: code row first, then reservation (same as reserve_discount_code).
  perform 1 from public.invite_codes where id = v_res.invite_code_id for update;

  update public.discount_code_reservations
  set status = 'released', released_at = now()
  where invite_code_id = v_res.invite_code_id and user_id = v_res.user_id and id <> v_res.id and status = 'reserved';

  update public.discount_code_reservations
  set status = 'confirmed', confirmed_at = now()
  where id = v_res.id and status in ('reserved', 'expired')
  returning * into v_res;

  if v_res.id is null then
    return jsonb_build_object('status', 'already_confirmed');
  end if;

  insert into public.invite_code_redemptions (invite_code_id, user_id, redeemed_at)
  values (v_res.invite_code_id, v_res.user_id, now())
  on conflict do nothing;

  update public.invite_codes set used_count = coalesce(used_count, 0) + 1 where id = v_res.invite_code_id;

  return jsonb_build_object('status', 'confirmed', 'final_amount', v_res.final_amount);
end;
$$;

-- ---------------------------------------------------------------------------
-- release_discount_reservation (by id, for a failed checkout) and ..._for_preapproval (cancelled before authorization).
-- Confirmed reservations are never released.
-- ---------------------------------------------------------------------------

create or replace function public.release_discount_reservation(p_user_id uuid, p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.discount_code_reservations
  set status = 'released', released_at = now()
  where id = p_reservation_id and user_id = p_user_id and status in ('reserved', 'expired');
  get diagnostics v_count = row_count;
  return jsonb_build_object('released', v_count);
end;
$$;

create or replace function public.release_discount_reservation_for_preapproval(p_preapproval_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.discount_code_reservations r
  set status = 'released', released_at = now()
  from public.checkout_attempts a
  where a.id = r.checkout_attempt_id
    and a.mercado_pago_preapproval_id = p_preapproval_id
    and r.status in ('reserved', 'expired');
  get diagnostics v_count = row_count;
  return jsonb_build_object('released', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Replacing a still-pending checkout with a discounted one.
-- describe_open_checkout: read-only view of the user's open attempt.
-- close_pending_checkout: closes a COMPLETED attempt whose subscription never got authorized (status 'pending') and
-- marks that subscription cancelled so begin_membership_checkout accepts a new attempt. The route cancels the
-- preapproval at Mercado Pago BEFORE calling this. Never touches authorized / active / paused subscriptions.
-- ---------------------------------------------------------------------------

create or replace function public.describe_open_checkout(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_att public.checkout_attempts%rowtype;
  v_status text;
begin
  select * into v_att
  from public.checkout_attempts
  where user_id = p_user_id and state in ('creating', 'reconciliation_required', 'completed')
  order by created_at desc
  limit 1;

  if v_att.id is null then
    return jsonb_build_object('status', 'none');
  end if;

  select s.status into v_status from public.subscriptions s where s.id = v_att.subscription_id;

  return jsonb_build_object(
    'status', 'open',
    'attempt_id', v_att.id,
    'state', v_att.state,
    'amount', v_att.amount,
    'preapproval_id', v_att.mercado_pago_preapproval_id,
    'subscription_status', v_status
  );
end;
$$;

create or replace function public.close_pending_checkout(p_user_id uuid, p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_att public.checkout_attempts%rowtype;
  v_sub public.subscriptions%rowtype;
begin
  -- Same lock as begin_membership_checkout / complete_membership_checkout.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_att
  from public.checkout_attempts
  where id = p_attempt_id and user_id = p_user_id
  for update;

  if v_att.id is null or v_att.state <> 'completed' then
    return jsonb_build_object('status', 'not_closable');
  end if;

  select * into v_sub from public.subscriptions where id = v_att.subscription_id for update;

  if v_sub.id is null or lower(coalesce(v_sub.status, '')) <> 'pending' then
    return jsonb_build_object('status', 'not_closable', 'subscription_status', v_sub.status);
  end if;

  update public.subscriptions
  set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
  where id = v_sub.id;

  update public.checkout_attempts
  set state = 'closed', closed_at = coalesce(closed_at, now()), last_error_code = 'superseded_by_discount'
  where id = v_att.id;

  update public.discount_code_reservations
  set status = 'released', released_at = now()
  where checkout_attempt_id = v_att.id and status in ('reserved', 'expired');

  return jsonb_build_object('status', 'closed');
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: service_role only.
-- ---------------------------------------------------------------------------

revoke all on function public.discount_code_final_amount(text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.reserve_discount_code(uuid, text, numeric, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.attach_discount_reservation(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.confirm_discount_reservation(text) from public, anon, authenticated;
revoke all on function public.release_discount_reservation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_discount_reservation_for_preapproval(text) from public, anon, authenticated;
revoke all on function public.describe_open_checkout(uuid) from public, anon, authenticated;
revoke all on function public.close_pending_checkout(uuid, uuid) from public, anon, authenticated;

grant execute on function public.discount_code_final_amount(text, numeric, numeric) to service_role;
grant execute on function public.reserve_discount_code(uuid, text, numeric, text, boolean, integer) to service_role;
grant execute on function public.attach_discount_reservation(uuid, uuid, uuid) to service_role;
grant execute on function public.confirm_discount_reservation(text) to service_role;
grant execute on function public.release_discount_reservation(uuid, uuid) to service_role;
grant execute on function public.release_discount_reservation_for_preapproval(text) to service_role;
grant execute on function public.describe_open_checkout(uuid) to service_role;
grant execute on function public.close_pending_checkout(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
