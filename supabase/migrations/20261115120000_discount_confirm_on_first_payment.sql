-- Discount codes (Pioneros): a use is consumed only by the FIRST APPROVED PAYMENT of a valid subscription.
--
-- Before: confirm_discount_reservation ran when Mercado Pago AUTHORIZED the preapproval (card accepted), so a
-- subscription whose first charge was rejected, or that was cancelled before paying, had already consumed a use.
--
-- New lifecycle of a reservation (same table, same statuses; no data is modified by this migration):
--   reserved, not attached          -> holds the seat 30 min (nothing exists at Mercado Pago)            [unchanged]
--   reserved, attached to an open checkout attempt (creating / reconciliation_required / completed)
--                                   -> holds the seat while that preapproval can still charge: pending
--                                      (not authorized yet) AND authorized-without-payment. A local timer
--                                      never frees it; only a cancellation at Mercado Pago, a replaced or
--                                      closed attempt does.                                               [unchanged]
--   confirmed                       -> ONLY once an approved payment of that preapproval is recorded.   [NEW]
--                                      Idempotent: renewals and duplicated / late webhooks never add a use.
--   released                        -> cancelled before paying, replaced, closed.                       [unchanged]
--
-- Capacity is unchanged: max(used_count, redemptions) + reservations that hold their seat. Because an authorized but
-- unpaid preapproval keeps holding its seat, deferring the confirmation can never sell more seats than max_uses.
-- The only way past the limit is still the pre-existing one (a payment that arrives for a reservation that was
-- already released, e.g. cancelled then paid): the payer is honoured and the row is flagged over_limit.
--
-- Also adds two read-only helpers for the app (service_role only):
--   discount_code_seat_summary()            confirmed / reserved / available per code (admin);
--   list_stale_discount_checkouts(...)      never-authorized discounted checkouts older than N minutes (reconciliation
--                                           cancels them at Mercado Pago, which then frees the seat through the normal
--                                           cancellation path).
--
-- Additive: replaces one function (same signature and privileges) and adds three. Requires 20261029120000 and
-- 20261030120000. Safe to re-run. NOT applied to any environment by the repository.

do $first_payment_dependencies$
begin
  if to_regclass('public.discount_code_reservations') is null
     or to_regprocedure('public.discount_reservation_holds_seat(text,uuid,timestamptz,timestamptz)') is null
     or to_regprocedure('public.confirm_discount_reservation(text)') is null then
    raise exception 'Apply 20261029120000_discount_code_checkout.sql and 20261030120000_discount_checkout_consistency.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.payments') is null or to_regclass('public.subscriptions') is null then
    raise exception 'public.payments / public.subscriptions are required. Nothing was changed.';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'payments' and column_name in ('subscription_id', 'status')) <> 2 then
    raise exception 'public.payments must have subscription_id and status. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'mercado_pago_preapproval_id') then
    raise exception 'public.subscriptions.mercado_pago_preapproval_id is required. Nothing was changed.';
  end if;
end;
$first_payment_dependencies$;

comment on table public.discount_code_reservations is
  'Reservations of discount codes for membership checkouts: reserved -> confirmed (first approved payment of the subscription, 20261115120000) | released | expired. Locks the discounted amount sent to Mercado Pago.';

-- ---------------------------------------------------------------------------
-- Has this preapproval an approved payment recorded by the billing circuit? (webhook / sync / reconciliation)
-- ---------------------------------------------------------------------------

create or replace function public.discount_preapproval_has_approved_payment(p_preapproval_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_preapproval_id is null or btrim(p_preapproval_id) = '' then
    return false;
  end if;
  return exists (
    select 1
    from public.payments p
    join public.subscriptions s on s.id = p.subscription_id
    where s.mercado_pago_preapproval_id = p_preapproval_id
      and lower(coalesce(p.status, '')) = 'approved'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_discount_reservation: same contract as 20261030120000 plus the payment requirement.
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

  -- An authorization alone (card accepted, first charge pending or rejected) never consumes the use: the reservation
  -- keeps holding its seat until a payment is approved or the preapproval is cancelled.
  if not public.discount_preapproval_has_approved_payment(p_preapproval_id) then
    return jsonb_build_object('status', 'awaiting_payment');
  end if;

  -- Same lock order as reserve_discount_code: the code row first, then the reservation. A concurrent reserve or a
  -- second notification waits here, so capacity is always evaluated against a consistent ledger.
  select * into v_inv from public.invite_codes where id = v_res.invite_code_id for update;

  select * into v_res from public.discount_code_reservations where id = v_res.id for update;

  if v_res.status = 'confirmed' then
    return jsonb_build_object('status', 'already_confirmed');
  end if;

  -- A reservation that still holds its seat is already counted: confirming it cannot exceed the limit.
  -- Otherwise (released before the payment arrived) the seat has to be found again.
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
-- Admin: seats per discount code. confirmed = paid uses; reserved = reservations holding a seat right now (checkout
-- open, authorized without payment yet); available = what reserve_discount_code would still accept.
-- ---------------------------------------------------------------------------

create or replace function public.discount_code_seat_summary()
returns table (
  invite_code_id uuid,
  code text,
  max_uses integer,
  confirmed integer,
  reserved integer,
  reserved_authorized integer,
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
          and public.discount_reservation_holds_seat(r.status, r.checkout_attempt_id, r.expires_at, now()))::integer as reserved,
      (select count(*) from public.discount_code_reservations r
        join public.checkout_attempts a on a.id = r.checkout_attempt_id
        join public.subscriptions s on s.id = a.subscription_id
        where r.invite_code_id = k.id
          and lower(coalesce(s.status, '')) = 'authorized'
          and public.discount_reservation_holds_seat(r.status, r.checkout_attempt_id, r.expires_at, now()))::integer as reserved_authorized,
      (select count(*) from public.discount_code_reservations r where r.invite_code_id = k.id and r.over_limit)::integer as over_limit
    from public.invite_codes k
    where k.code_type::text in ('discount_percent', 'discount_fixed_amount', 'fixed_price')
  )
  select
    id, code, max_uses, confirmed, reserved, reserved_authorized,
    case when max_uses is null then null else greatest(max_uses - confirmed - reserved, 0) end,
    over_limit
  from seats
$$;

-- ---------------------------------------------------------------------------
-- Reconciliation: discounted checkouts never authorized at Mercado Pago (subscription still 'pending') and older than
-- p_older_than_minutes. They hold a seat indefinitely; the app re-reads each preapproval and cancels it ONLY if Mercado
-- Pago still reports it pending (no card authorized, nothing can be charged), then the normal cancellation path frees
-- the seat. Authorized ones are never listed: they can still charge.
-- ---------------------------------------------------------------------------

create or replace function public.list_stale_discount_checkouts(p_older_than_minutes integer default 2880, p_limit integer default 20)
returns table (reservation_id uuid, user_id uuid, preapproval_id text, attempt_created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_older_than_minutes is null or p_older_than_minutes < 60 then
    raise exception 'stale checkouts must be at least 60 minutes old';
  end if;
  return query
    select r.id, r.user_id, a.mercado_pago_preapproval_id, a.created_at
    from public.discount_code_reservations r
    join public.checkout_attempts a on a.id = r.checkout_attempt_id
    join public.subscriptions s on s.id = a.subscription_id
    where r.status = 'reserved'
      and a.state = 'completed'
      and a.mercado_pago_preapproval_id is not null
      and lower(coalesce(s.status, '')) = 'pending'
      and a.created_at < now() - make_interval(mins => p_older_than_minutes)
    order by a.created_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: service_role only.
-- ---------------------------------------------------------------------------

revoke all on function public.discount_preapproval_has_approved_payment(text) from public, anon, authenticated;
grant execute on function public.discount_preapproval_has_approved_payment(text) to service_role;

revoke all on function public.confirm_discount_reservation(text) from public, anon, authenticated;
grant execute on function public.confirm_discount_reservation(text) to service_role;

revoke all on function public.discount_code_seat_summary() from public, anon, authenticated;
grant execute on function public.discount_code_seat_summary() to service_role;

revoke all on function public.list_stale_discount_checkouts(integer, integer) from public, anon, authenticated;
grant execute on function public.list_stale_discount_checkouts(integer, integer) to service_role;

notify pgrst, 'reload schema';
