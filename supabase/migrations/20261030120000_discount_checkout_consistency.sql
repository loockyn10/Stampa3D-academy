-- Discount codes: seat accounting that survives slow and late Mercado Pago notifications.
--
-- Review findings fixed here (20261029120000_discount_code_checkout.sql was NOT edited: it may already be applied):
--
--   * A reservation that already created its Mercado Pago preapproval used to expire by the clock (30 min) like an
--     unused one. The seat was then given to another buyer while the first preapproval could still be authorized,
--     and confirm_discount_reservation honoured the late authorization anyway => max_uses was exceeded.
--
-- New invariant (a reservation "holds its seat"):
--   * Not attached to a checkout attempt: it holds the seat until expires_at (30 min). Nothing exists at Mercado Pago
--     for it, so letting it lapse is safe.
--   * Attached to a checkout attempt that is still open (creating / reconciliation_required / completed): it holds
--     the seat for as long as that attempt is open, regardless of the clock. The preapproval can be authorized at any
--     time, so the seat is released only when the attempt is authorized (confirmed), cancelled at Mercado Pago,
--     replaced by the user, or closed.
--   * Capacity of a code = max(used_count, real redemptions) + reservations that hold their seat.
--
-- Late notifications:
--   * confirm_discount_reservation is idempotent (webhook retries, sync-subscription) and serialized with
--     reserve_discount_code by the row lock of the code.
--   * If the authorization arrives for a reservation that no longer holds its seat (abnormal: released by hand, closed
--     attempt, legacy row) it re-checks the limit. A free seat => confirmed normally. No seat => the payer is NEVER
--     harmed or cancelled: the use is recorded with over_limit = true so it is visible (diagnostic + log) and the code
--     is closed to everyone else. This is the only way the limit can be exceeded, and only by a payment that already
--     happened; see docs/DEPLOY_DISCOUNT_CODES.md.
--
-- Additive: one nullable-safe column, one helper, two replaced functions (same signatures and privileges).
-- Requires 20261029120000_discount_code_checkout.sql. Safe to re-run.

do $consistency_dependencies$
begin
  if to_regclass('public.discount_code_reservations') is null
     or to_regprocedure('public.reserve_discount_code(uuid,text,numeric,text,boolean,integer)') is null
     or to_regprocedure('public.confirm_discount_reservation(text)') is null then
    raise exception 'Apply 20261029120000_discount_code_checkout.sql first. Nothing was changed.';
  end if;
end;
$consistency_dependencies$;

alter table public.discount_code_reservations
  add column if not exists over_limit boolean not null default false;

comment on column public.discount_code_reservations.over_limit is
  'true when Mercado Pago authorized a subscription whose reservation no longer held a seat and the code was already at its limit: the payer is honoured, the excess is recorded here.';

-- ---------------------------------------------------------------------------
-- Does a reservation currently hold its seat? (single definition used everywhere)
-- ---------------------------------------------------------------------------

create or replace function public.discount_reservation_holds_seat(
  p_status text,
  p_attempt_id uuid,
  p_expires_at timestamptz,
  p_now timestamptz
)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_status = 'reserved' and (
    case
      when p_attempt_id is null then p_expires_at > p_now
      else exists (
        select 1 from public.checkout_attempts a
        where a.id = p_attempt_id and a.state in ('creating', 'reconciliation_required', 'completed')
      )
    end
  )
$$;

-- ---------------------------------------------------------------------------
-- reserve_discount_code: same contract as 20261029120000; only the notion of "live reservation" changes.
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
    -- Only reservations that no longer hold a seat are retired: unattached ones past their TTL (nothing exists at
    -- Mercado Pago for them) and ones whose checkout attempt is closed. An open checkout keeps its seat.
    update public.discount_code_reservations r
    set status = case when r.checkout_attempt_id is null then 'expired' else 'released' end,
        released_at = v_now
    where r.invite_code_id = v_inv.id
      and r.status = 'reserved'
      and not public.discount_reservation_holds_seat(r.status, r.checkout_attempt_id, r.expires_at, v_now);
  end if;

  select greatest(coalesce(v_inv.used_count, 0), (select count(*) from public.invite_code_redemptions where invite_code_id = v_inv.id))
       + (select count(*) from public.discount_code_reservations r
          where r.invite_code_id = v_inv.id and r.user_id <> p_user_id
            and public.discount_reservation_holds_seat(r.status, r.checkout_attempt_id, r.expires_at, v_now))
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

    -- Another code or price: the previous reservation stops holding a seat (same transaction, so no one can
    -- take it in between). If its checkout is still open the caller replaces that checkout.
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
-- confirm_discount_reservation: Mercado Pago authorized the preapproval. Idempotent and race-safe.
-- Returns {status}: confirmed | confirmed_over_limit | already_confirmed | none.
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
  v_over boolean := false;
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

  -- Same lock order as reserve_discount_code: the code row first, then the reservation. A concurrent reserve or a
  -- second notification waits here, so capacity is always evaluated against a consistent ledger.
  select * into v_inv from public.invite_codes where id = v_res.invite_code_id for update;

  select * into v_res from public.discount_code_reservations where id = v_res.id for update;

  if v_res.status = 'confirmed' then
    return jsonb_build_object('status', 'already_confirmed');
  end if;

  -- A reservation that still holds its seat is already counted: confirming it cannot exceed the limit.
  -- Otherwise (abnormal) the seat has to be found again.
  if not public.discount_reservation_holds_seat(v_res.status, v_res.checkout_attempt_id, v_res.expires_at, v_now) then
    select greatest(coalesce(v_inv.used_count, 0), (select count(*) from public.invite_code_redemptions where invite_code_id = v_inv.id))
         + (select count(*) from public.discount_code_reservations r
            where r.invite_code_id = v_inv.id and r.user_id <> v_res.user_id
              and public.discount_reservation_holds_seat(r.status, r.checkout_attempt_id, r.expires_at, v_now))
    into v_uses;

    v_over := v_inv.max_uses is not null and v_uses >= v_inv.max_uses;
  end if;

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
-- Privileges: service_role only (create or replace keeps the existing grants; re-asserted for the new helper).
-- ---------------------------------------------------------------------------

revoke all on function public.discount_reservation_holds_seat(text, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.discount_reservation_holds_seat(text, uuid, timestamptz, timestamptz) to service_role;

revoke all on function public.reserve_discount_code(uuid, text, numeric, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.reserve_discount_code(uuid, text, numeric, text, boolean, integer) to service_role;

revoke all on function public.confirm_discount_reservation(text) from public, anon, authenticated;
grant execute on function public.confirm_discount_reservation(text) to service_role;

notify pgrst, 'reload schema';
