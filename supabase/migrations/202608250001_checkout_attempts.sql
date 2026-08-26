begin;

create table public.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  state text not null,
  external_reference text not null,
  mercado_pago_preapproval_id text,
  mercado_pago_init_point text,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount numeric(12, 2) not null,
  currency text not null,
  payer_email text not null,
  reason text not null,
  back_url text not null,
  provider_status text,
  provider_response jsonb,
  provider_request_started_at timestamptz,
  provider_response_received_at timestamptz,
  reconciliation_requested_at timestamptz,
  claim_token uuid,
  provider_call_count integer not null default 0,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  closed_at timestamptz,
  constraint checkout_attempts_user_idempotency_key_unique
    unique (user_id, idempotency_key),
  constraint checkout_attempts_external_reference_unique
    unique (external_reference),
  constraint checkout_attempts_preapproval_id_unique
    unique (mercado_pago_preapproval_id),
  constraint checkout_attempts_state_check
    check (state in (
      'creating',
      'reconciliation_required',
      'completed',
      'provider_error',
      'closed'
    )),
  constraint checkout_attempts_amount_check check (amount > 0),
  constraint checkout_attempts_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint checkout_attempts_provider_call_count_check
    check (provider_call_count >= 0),
  constraint checkout_attempts_claim_check
    check (
      state not in ('creating', 'reconciliation_required')
      or claim_token is not null
    ),
  constraint checkout_attempts_completed_data_check
    check (
      state <> 'completed'
      or (
        mercado_pago_preapproval_id is not null
        and mercado_pago_init_point is not null
        and subscription_id is not null
        and completed_at is not null
      )
    ),
  constraint checkout_attempts_closed_at_check
    check (state <> 'closed' or closed_at is not null)
);

comment on table public.checkout_attempts is
  'Durable, idempotent attempts to create Mercado Pago membership preapprovals.';
comment on column public.checkout_attempts.external_reference is
  'Stable local reference sent to Mercado Pago and used for reconciliation.';
comment on column public.checkout_attempts.claim_token is
  'Opaque token held by the single request allowed to call Mercado Pago.';
comment on column public.checkout_attempts.provider_response is
  'Last successful Mercado Pago preapproval response used to recover a lost HTTP response.';

create unique index checkout_attempts_one_open_per_user_idx
  on public.checkout_attempts (user_id)
  where state in ('creating', 'reconciliation_required', 'completed');

create index checkout_attempts_user_created_at_idx
  on public.checkout_attempts (user_id, created_at desc);

create index checkout_attempts_reconciliation_idx
  on public.checkout_attempts (updated_at)
  where state = 'reconciliation_required';

create function public.set_checkout_attempt_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger checkout_attempts_set_updated_at
before update on public.checkout_attempts
for each row execute function public.set_checkout_attempt_updated_at();

create function public.begin_membership_checkout(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_amount numeric,
  p_currency text,
  p_payer_email text,
  p_reason text,
  p_back_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.checkout_attempts%rowtype;
  v_open_attempt public.checkout_attempts%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_attempt_id uuid;
  v_claim_token uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'checkout amount must be greater than zero';
  end if;

  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'checkout currency must be an ISO-style uppercase code';
  end if;

  if nullif(trim(p_payer_email), '') is null then
    raise exception 'checkout payer email is required';
  end if;

  -- The advisory lock serializes every checkout decision for this user, even
  -- when concurrent requests carry different idempotency keys. The partial
  -- unique index remains the final invariant if this function changes later.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- A completed attempt stops blocking once its linked subscription has a
  -- terminal state. This preserves a legitimate cancel-and-resubscribe path.
  update public.checkout_attempts as attempt
  set
    state = 'closed',
    closed_at = coalesce(attempt.closed_at, now()),
    last_error_code = coalesce(attempt.last_error_code, 'subscription_terminal')
  from public.subscriptions as subscription
  where attempt.user_id = p_user_id
    and attempt.state = 'completed'
    and attempt.subscription_id = subscription.id
    and lower(coalesce(subscription.status, '')) in (
      'canceled',
      'cancelled',
      'expired',
      'rejected'
    );

  select *
  into v_attempt
  from public.checkout_attempts
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key
  for update;

  if v_attempt.id is not null then
    if v_attempt.state = 'completed' then
      return jsonb_build_object(
        'action', 'return_ready',
        'attempt_id', v_attempt.id,
        'idempotency_key', v_attempt.idempotency_key,
        'external_reference', v_attempt.external_reference,
        'claim_token', v_attempt.claim_token,
        'preapproval_id', v_attempt.mercado_pago_preapproval_id,
        'init_point', v_attempt.mercado_pago_init_point
      );
    end if;

    if v_attempt.state in ('creating', 'reconciliation_required') then
      update public.checkout_attempts
      set reconciliation_requested_at = now()
      where id = v_attempt.id
      returning * into v_attempt;

      return jsonb_build_object(
        'action', 'reconcile',
        'attempt_id', v_attempt.id,
        'idempotency_key', v_attempt.idempotency_key,
        'external_reference', v_attempt.external_reference,
        'claim_token', v_attempt.claim_token,
        'payer_email', v_attempt.payer_email
      );
    end if;

    if v_attempt.state = 'closed' then
      return jsonb_build_object(
        'action', 'closed_attempt',
        'attempt_id', v_attempt.id
      );
    end if;
  end if;

  select *
  into v_open_attempt
  from public.checkout_attempts
  where user_id = p_user_id
    and state in ('creating', 'reconciliation_required', 'completed')
  order by created_at desc
  limit 1
  for update;

  if v_open_attempt.id is not null then
    if v_open_attempt.state = 'completed' then
      return jsonb_build_object(
        'action', 'return_ready',
        'attempt_id', v_open_attempt.id,
        'idempotency_key', v_open_attempt.idempotency_key,
        'external_reference', v_open_attempt.external_reference,
        'claim_token', v_open_attempt.claim_token,
        'preapproval_id', v_open_attempt.mercado_pago_preapproval_id,
        'init_point', v_open_attempt.mercado_pago_init_point
      );
    end if;

    update public.checkout_attempts
    set reconciliation_requested_at = now()
    where id = v_open_attempt.id;

    return jsonb_build_object(
      'action', 'reconcile',
      'attempt_id', v_open_attempt.id,
      'idempotency_key', v_open_attempt.idempotency_key,
      'external_reference', v_open_attempt.external_reference,
      'claim_token', v_open_attempt.claim_token,
      'payer_email', v_open_attempt.payer_email
    );
  end if;

  -- Compatibility guard for subscriptions created before checkout_attempts.
  select *
  into v_subscription
  from public.subscriptions
  where user_id = p_user_id
    and lower(coalesce(status, '')) in ('pending', 'authorized', 'active', 'paused')
  order by created_at desc
  limit 1
  for update;

  if v_subscription.id is not null then
    return jsonb_build_object(
      'action', 'blocked_existing_subscription',
      'subscription_id', v_subscription.id,
      'subscription_status', v_subscription.status,
      'preapproval_id', v_subscription.mercado_pago_preapproval_id
    );
  end if;

  -- A retry after a definite provider rejection reuses the same local attempt
  -- and external_reference. Ambiguous outcomes never reach provider_error.
  if v_attempt.id is not null and v_attempt.state = 'provider_error' then
    v_claim_token := gen_random_uuid();

    update public.checkout_attempts
    set
      state = 'creating',
      claim_token = v_claim_token,
      provider_request_started_at = now(),
      provider_response_received_at = null,
      reconciliation_requested_at = null,
      provider_call_count = provider_call_count + 1,
      last_error_code = null,
      last_error_message = null
    where id = v_attempt.id
    returning * into v_attempt;

    return jsonb_build_object(
      'action', 'call_provider',
      'attempt_id', v_attempt.id,
      'idempotency_key', v_attempt.idempotency_key,
      'external_reference', v_attempt.external_reference,
      'claim_token', v_attempt.claim_token,
      'payer_email', v_attempt.payer_email
    );
  end if;

  v_attempt_id := gen_random_uuid();
  v_claim_token := gen_random_uuid();

  insert into public.checkout_attempts (
    id,
    user_id,
    idempotency_key,
    state,
    external_reference,
    amount,
    currency,
    payer_email,
    reason,
    back_url,
    provider_request_started_at,
    claim_token,
    provider_call_count
  ) values (
    v_attempt_id,
    p_user_id,
    p_idempotency_key,
    'creating',
    'stampa_checkout_' || replace(v_attempt_id::text, '-', ''),
    p_amount,
    p_currency,
    trim(p_payer_email),
    p_reason,
    p_back_url,
    now(),
    v_claim_token,
    1
  )
  returning * into v_attempt;

  return jsonb_build_object(
    'action', 'call_provider',
    'attempt_id', v_attempt.id,
    'idempotency_key', v_attempt.idempotency_key,
    'external_reference', v_attempt.external_reference,
    'claim_token', v_attempt.claim_token,
    'payer_email', v_attempt.payer_email
  );
end;
$$;

create function public.complete_membership_checkout(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_preapproval_id text,
  p_init_point text,
  p_provider_status text,
  p_provider_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.checkout_attempts%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_subscription_id uuid;
  v_user_id uuid;
begin
  select user_id
  into v_user_id
  from public.checkout_attempts
  where id = p_attempt_id;

  if v_user_id is null then
    raise exception 'checkout attempt not found';
  end if;

  -- Keep the same lock order as begin_membership_checkout: user advisory lock
  -- first, row locks second. This avoids a begin/complete deadlock.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select *
  into v_attempt
  from public.checkout_attempts
  where id = p_attempt_id
  for update;

  if v_attempt.id is null then
    raise exception 'checkout attempt not found';
  end if;

  if v_attempt.state = 'completed' then
    if v_attempt.mercado_pago_preapproval_id <> p_preapproval_id then
      raise exception 'checkout attempt already completed with another preapproval';
    end if;

    return jsonb_build_object(
      'attempt_id', v_attempt.id,
      'subscription_id', v_attempt.subscription_id,
      'preapproval_id', v_attempt.mercado_pago_preapproval_id,
      'init_point', v_attempt.mercado_pago_init_point
    );
  end if;

  if v_attempt.state not in ('creating', 'reconciliation_required') then
    raise exception 'checkout attempt cannot be completed from state %', v_attempt.state;
  end if;

  if v_attempt.claim_token is distinct from p_claim_token then
    raise exception 'invalid checkout claim token';
  end if;

  if nullif(trim(p_preapproval_id), '') is null
     or nullif(trim(p_init_point), '') is null then
    raise exception 'Mercado Pago preapproval id and init point are required';
  end if;

  select *
  into v_subscription
  from public.subscriptions
  where mercado_pago_preapproval_id = trim(p_preapproval_id)
  order by created_at
  limit 1
  for update;

  if v_subscription.id is not null then
    if v_subscription.user_id <> v_attempt.user_id then
      raise exception 'preapproval is already linked to another user';
    end if;

    update public.subscriptions
    set
      status = coalesce(nullif(p_provider_status, ''), status, 'pending'),
      payer_email = v_attempt.payer_email,
      amount = v_attempt.amount,
      currency = v_attempt.currency,
      raw_data = p_provider_response,
      next_payment_at = coalesce(
        nullif(p_provider_response ->> 'next_payment_date', '')::timestamptz,
        v_subscription.next_payment_at
      ),
      updated_at = now()
    where id = v_subscription.id
    returning id into v_subscription_id;
  else
    insert into public.subscriptions (
      user_id,
      mercado_pago_preapproval_id,
      status,
      payer_email,
      amount,
      currency,
      raw_data,
      next_payment_at,
      created_at,
      updated_at
    ) values (
      v_attempt.user_id,
      trim(p_preapproval_id),
      coalesce(nullif(p_provider_status, ''), 'pending'),
      v_attempt.payer_email,
      v_attempt.amount,
      v_attempt.currency,
      p_provider_response,
      nullif(p_provider_response ->> 'next_payment_date', '')::timestamptz,
      now(),
      now()
    )
    returning id into v_subscription_id;
  end if;

  update public.checkout_attempts
  set
    state = 'completed',
    mercado_pago_preapproval_id = trim(p_preapproval_id),
    mercado_pago_init_point = trim(p_init_point),
    subscription_id = v_subscription_id,
    provider_status = coalesce(nullif(p_provider_status, ''), 'pending'),
    provider_response = p_provider_response,
    provider_response_received_at = now(),
    completed_at = now(),
    reconciliation_requested_at = null,
    last_error_code = null,
    last_error_message = null
  where id = v_attempt.id
  returning * into v_attempt;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'subscription_id', v_attempt.subscription_id,
    'preapproval_id', v_attempt.mercado_pago_preapproval_id,
    'init_point', v_attempt.mercado_pago_init_point
  );
end;
$$;

create function public.mark_membership_checkout_reconciliation(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.checkout_attempts
  set
    state = 'reconciliation_required',
    reconciliation_requested_at = now(),
    last_error_code = left(p_error_code, 200),
    last_error_message = left(p_error_message, 2000)
  where id = p_attempt_id
    and claim_token = p_claim_token
    and state in ('creating', 'reconciliation_required');

  if not found then
    raise exception 'checkout attempt could not be marked for reconciliation';
  end if;
end;
$$;

create function public.mark_membership_checkout_provider_error(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text,
  p_provider_response jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.checkout_attempts
  set
    state = 'provider_error',
    provider_response = p_provider_response,
    provider_response_received_at = now(),
    reconciliation_requested_at = null,
    last_error_code = left(p_error_code, 200),
    last_error_message = left(p_error_message, 2000)
  where id = p_attempt_id
    and claim_token = p_claim_token
    and state = 'creating';

  if not found then
    raise exception 'checkout attempt could not be marked as provider error';
  end if;
end;
$$;

alter table public.checkout_attempts enable row level security;

-- Checkout attempts are server-owned. Authenticated clients use the Route
-- Handler; only the service role can read/write the table or execute the RPCs.
revoke all on table public.checkout_attempts from anon, authenticated;
grant select, insert, update on table public.checkout_attempts to service_role;

revoke all on function public.begin_membership_checkout(
  uuid, uuid, numeric, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.begin_membership_checkout(
  uuid, uuid, numeric, text, text, text, text
) to service_role;

revoke all on function public.complete_membership_checkout(
  uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_membership_checkout(
  uuid, uuid, text, text, text, jsonb
) to service_role;

revoke all on function public.mark_membership_checkout_reconciliation(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.mark_membership_checkout_reconciliation(
  uuid, uuid, text, text
) to service_role;

revoke all on function public.mark_membership_checkout_provider_error(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.mark_membership_checkout_provider_error(
  uuid, uuid, text, text, jsonb
) to service_role;

commit;
