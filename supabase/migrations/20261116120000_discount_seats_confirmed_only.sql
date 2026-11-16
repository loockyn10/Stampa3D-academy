-- Discount codes (Pioneros): a seat is counted ONLY by a confirmed first payment. No temporary reservations of seats.
--
-- Commercial decision (2026-11-16): entering the code, starting the checkout, authorizing a subscription or having a
-- pending payment must NOT reduce the seats shown as available. Capacity of a code = confirmed uses only:
--
--     confirmed = max(used_count, real redemptions)          (a use is confirmed by the first APPROVED payment)
--     available = max_uses - confirmed
--
-- Why a hard "exactly max_uses" cannot be promised without holding seats: Mercado Pago charges the first installment on
-- its own, outside our database, as soon as the payer authorizes. Two or more people can therefore be paying at the same
-- time when the code is at max_uses - 1. Nothing here can stop an approved charge, and a payer who paid is NEVER
-- rejected, cancelled or left without Premium because of the limit. So:
--
--   * reserve_discount_code stops offering the code as soon as the confirmed uses reach max_uses (dry-run preview and new
--     checkouts answer 'exhausted'). Open checkouts / pending payments are not counted.
--   * confirm_discount_reservation always honours an approved payment. If the code is already at max_uses when it is
--     confirmed, the use is still recorded and the reservation is flagged over_limit = true, so the admin sees it. This
--     is the only way the limit can be exceeded, and only by payments that were already in flight when the last seat
--     was taken (bounded by the number of discounted checkouts open at that moment).
--   * Each subscription counts once: confirmation is idempotent per reservation under the lock of the code row, so
--     duplicated / late webhooks and every renewal never add a use.
--
-- The rows of discount_code_reservations remain, but only as the price lock of a checkout (reserved -> attached to the
-- attempt that carries the amount -> confirmed | released | expired). They no longer hold a seat.
--
-- Replaces three functions of 20261030120000 / 20261115120000 (reserve_discount_code, confirm_discount_reservation,
-- discount_code_seat_summary: its two "reserved" columns become informational "in flight"). No data is modified.
-- Requires 20261115120000 (discount_preapproval_has_approved_payment). Safe to re-run. NOT applied to any environment by
-- the repository.

do $seats_confirmed_only_dependencies$
begin
  if to_regprocedure('public.discount_preapproval_has_approved_payment(text)') is null
     or to_regprocedure('public.discount_reservation_holds_seat(text,uuid,timestamptz,timestamptz)') is null
     or to_regprocedure('public.reserve_discount_code(uuid,text,numeric,text,boolean,integer)') is null
     or to_regprocedure('public.confirm_discount_reservation(text)') is null then
    raise exception 'Apply 20261029120000, 20261030120000 and 20261115120000 first. Nothing was changed.';
  end if;
end;
$seats_confirmed_only_dependencies$;

comment on function public.discount_reservation_holds_seat(text, uuid, timestamptz, timestamptz) is
  'Is this reservation still a LIVE price lock (unattached and unexpired, or attached to an open checkout attempt)? Informational since 20261116120000: it no longer holds a seat of the code.';

-- ---------------------------------------------------------------------------
-- reserve_discount_code: same contract and statuses as before; capacity = confirmed uses only.
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
    -- Price locks that are no longer live are retired (unattached past their TTL; checkout attempt closed).
    update public.discount_code_reservations r
    set status = case when r.checkout_attempt_id is null then 'expired' else 'released' end,
        released_at = v_now
    where r.invite_code_id = v_inv.id
      and r.status = 'reserved'
      and not public.discount_reservation_holds_seat(r.status, r.checkout_attempt_id, r.expires_at, v_now);
  end if;

  -- Capacity: confirmed uses ONLY (first approved payment). Reservations, open checkouts, authorizations without a
  -- payment and pending payments never reduce what is offered.
  select greatest(coalesce(v_inv.used_count, 0), (select count(*) from public.invite_code_redemptions where invite_code_id = v_inv.id))
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
       and public.discount_reservation_holds_seat(v_existing.status, v_existing.checkout_attempt_id, v_existing.expires_at, v_now)
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

    update public.discount_code_reservations
    set status = case when v_existing.checkout_attempt_id is null and v_existing.expires_at <= v_now then 'expired' else 'released' end,
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
-- confirm_discount_reservation: the first approved payment of the preapproval consumes one use. Idempotent, race-safe,
-- and it NEVER rejects a payer: past max_uses the use is still recorded and flagged over_limit.
-- Returns {status}: confirmed | confirmed_over_limit | already_confirmed | awaiting_payment | none.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_discount_reservation(p_preapproval_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.discount_code_reservations%rowtype;
  v_inv public.invite_codes%rowtype;
  v_now timestamptz := now();
  v_uses integer;
  v_over boolean;
begin
  select r.* into v_res
  from public.discount_code_reservations r
  join public.checkout_attempts a on a.id = r.checkout_attempt_id
  where a.mercado_pago_preapproval_id = p_preapproval_id
    and r.status in ('reserved', 'expired', 'released', 'confirmed')
  order by (r.status = 'confirmed') desc, (r.status = 'reserved') desc, r.created_at desc
  limit 1;

  if v_res.id is null then
    return jsonb_build_object('status', 'none');
  end if;

  if v_res.status = 'confirmed' then
    return jsonb_build_object('status', 'already_confirmed');
  end if;

  -- Only an approved payment counts: authorized, pending or rejected never consume a use.
  if not public.discount_preapproval_has_approved_payment(p_preapproval_id) then
    return jsonb_build_object('status', 'awaiting_payment');
  end if;

  -- The code row serializes every confirmation of the code (and reserve_discount_code): each one reads the confirmed
  -- count left by the previous one, so concurrent payments of the last seat are ordered, never lost or counted twice.
  select * into v_inv from public.invite_codes where id = v_res.invite_code_id for update;

  select * into v_res from public.discount_code_reservations where id = v_res.id for update;

  if v_res.status = 'confirmed' then
    return jsonb_build_object('status', 'already_confirmed');
  end if;

  select greatest(coalesce(v_inv.used_count, 0), (select count(*) from public.invite_code_redemptions where invite_code_id = v_inv.id))
  into v_uses;

  v_over := v_inv.max_uses is not null and v_uses >= v_inv.max_uses;

  update public.discount_code_reservations
  set status = 'released', released_at = v_now
  where invite_code_id = v_res.invite_code_id and user_id = v_res.user_id and id <> v_res.id and status = 'reserved';

  update public.discount_code_reservations
  set status = 'confirmed', confirmed_at = v_now, over_limit = v_over, released_at = null
  where id = v_res.id
  returning * into v_res;

  insert into public.invite_code_redemptions (invite_code_id, user_id, redeemed_at)
  values (v_res.invite_code_id, v_res.user_id, v_now)
  on conflict do nothing;

  update public.invite_codes set used_count = coalesce(used_count, 0) + 1 where id = v_res.invite_code_id;

  return jsonb_build_object(
    'status', case when v_over then 'confirmed_over_limit' else 'confirmed' end,
    'final_amount', v_res.final_amount
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: seats per discount code. confirmed = paid uses; available = max_uses - confirmed (what is still offered);
-- in_flight* = checkouts open right now (informational: they hold NOTHING; if all of them paid, the code could pass its
-- limit by up to in_flight, each one honoured and flagged over_limit).
-- The two "reserved" columns of 20261115120000 are replaced by in_flight / in_flight_authorized.
-- ---------------------------------------------------------------------------

drop function if exists public.discount_code_seat_summary();

create function public.discount_code_seat_summary()
returns table (
  invite_code_id uuid,
  code text,
  max_uses integer,
  confirmed integer,
  in_flight integer,
  in_flight_authorized integer,
  available integer,
  over_limit integer
)
language sql
stable
security definer
set search_path = public
as $$
  with seats as (
    select
      k.id,
      k.code,
      k.max_uses,
      greatest(coalesce(k.used_count, 0), (select count(*) from public.invite_code_redemptions x where x.invite_code_id = k.id))::integer as confirmed,
      (select count(*) from public.discount_code_reservations r
        where r.invite_code_id = k.id
          and public.discount_reservation_holds_seat(r.status, r.checkout_attempt_id, r.expires_at, now()))::integer as in_flight,
      (select count(*) from public.discount_code_reservations r
        join public.checkout_attempts a on a.id = r.checkout_attempt_id
        join public.subscriptions s on s.id = a.subscription_id
        where r.invite_code_id = k.id
          and lower(coalesce(s.status, '')) = 'authorized'
          and public.discount_reservation_holds_seat(r.status, r.checkout_attempt_id, r.expires_at, now()))::integer as in_flight_authorized,
      (select count(*) from public.discount_code_reservations r where r.invite_code_id = k.id and r.over_limit)::integer as over_limit
    from public.invite_codes k
    where k.code_type::text in ('discount_percent', 'discount_fixed_amount', 'fixed_price')
  )
  select
    id, code, max_uses, confirmed, in_flight, in_flight_authorized,
    case when max_uses is null then null else greatest(max_uses - confirmed, 0) end,
    over_limit
  from seats
$$;

comment on function public.discount_code_seat_summary() is
  'Seats per discount code: confirmed = first approved payments; available = max_uses - confirmed; in_flight* = open checkouts that hold nothing (informational).';

-- ---------------------------------------------------------------------------
-- Privileges: service_role only.
-- ---------------------------------------------------------------------------

revoke all on function public.reserve_discount_code(uuid, text, numeric, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.reserve_discount_code(uuid, text, numeric, text, boolean, integer) to service_role;

revoke all on function public.confirm_discount_reservation(text) from public, anon, authenticated;
grant execute on function public.confirm_discount_reservation(text) to service_role;

revoke all on function public.discount_code_seat_summary() from public, anon, authenticated;
grant execute on function public.discount_code_seat_summary() to service_role;

notify pgrst, 'reload schema';
