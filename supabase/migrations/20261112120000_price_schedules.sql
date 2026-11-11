-- Promotional price schedules (Pioneros: 9.900 for 6 monthly billing periods, then the price accepted at purchase).
--
-- ESCRITA Y PROBADA EN LOCAL, NO APLICADA. Diseño: docs/PROMOCIONES_AUTOMATIZADAS_DISENO.md.
--
-- Esta migration es ADITIVA: crea objetos nuevos y nada más. No modifica (DDL ni DML) invite_codes, discount_code_reservations,
-- checkout_attempts, subscriptions, payments, profiles, membership_settings, founder_members ni ninguna función existente
-- (confirm_discount_reservation incluida: la agenda se crea desde el servidor con ensure_price_schedule).
-- Reemplaza a la M1 de Pioneros (20261111120000_pioneer_edition.sql), que NO debe aplicarse.
--
-- La promoción se mide en PERÍODOS DE FACTURACIÓN del calendario, no en pagos aprobados:
--   anchor_at     = fecha de débito de la primera cuota que generó Mercado Pago (se fija una vez y no se mueve);
--   promo_ends_at = anchor_at + promo_cycles meses (contados desde el ancla, no encadenados).
-- Un pago rechazado, pendiente o reintentado no mueve ninguna de esas fechas. Los pagos aprobados solo concilian.
--
-- Objetos nuevos:
--   * discount_code_terms : condiciones comerciales de un código (ciclos, precio posterior, aviso, texto versionado).
--   * promo_acceptances   : consentimiento expreso del comprador (snapshot inmutable de las condiciones aceptadas).
--   * price_schedules     : una fila por suscripción promocional (estado del paso al precio posterior).
--   * price_schedule_events: bitácora (append-only para updates).
--   * Funciones (solo service_role): promo_terms_for_code, record_promo_acceptance, ensure_price_schedule,
--     sync_price_schedule, list_price_schedule_work, claim_price_schedule, finish_price_schedule,
--     mark_price_notice_sent, add_price_schedule_event.
--
-- No activa nada: sin filas en discount_code_terms ningún código tiene condiciones de ciclos y todo funciona como hoy.
-- Un preflight aborta sin cambiar nada si falta una dependencia. Seguro de re-ejecutar.

do $price_schedule_dependencies$
declare
  v_missing text;
begin
  if to_regclass('auth.users') is null
     or to_regclass('public.invite_codes') is null
     or to_regclass('public.discount_code_reservations') is null
     or to_regclass('public.checkout_attempts') is null
     or to_regclass('public.subscriptions') is null
     or to_regclass('public.payments') is null then
    raise exception 'Missing dependency: auth.users, public.invite_codes, public.discount_code_reservations, public.checkout_attempts, public.subscriptions and public.payments are required. Nothing was changed.';
  end if;

  select string_agg(req.tbl || '.' || req.col, ', ') into v_missing
  from (values
    ('invite_codes', 'id'), ('invite_codes', 'code'), ('invite_codes', 'status'),
    ('discount_code_reservations', 'id'), ('discount_code_reservations', 'invite_code_id'),
    ('discount_code_reservations', 'user_id'), ('discount_code_reservations', 'status'),
    ('discount_code_reservations', 'base_amount'), ('discount_code_reservations', 'final_amount'),
    ('discount_code_reservations', 'currency'), ('discount_code_reservations', 'checkout_attempt_id'),
    ('checkout_attempts', 'id'), ('checkout_attempts', 'mercado_pago_preapproval_id'),
    ('subscriptions', 'id'), ('subscriptions', 'user_id'), ('subscriptions', 'mercado_pago_preapproval_id'),
    ('payments', 'id'), ('payments', 'subscription_id'), ('payments', 'user_id'), ('payments', 'status'),
    ('payments', 'amount'), ('payments', 'paid_at')
  ) as req(tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = req.tbl and c.column_name = req.col
  );

  if v_missing is not null then
    raise exception 'Missing expected columns: %. Nothing was changed.', v_missing;
  end if;

  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'invite_codes' and c.column_name = 'id' and c.data_type = 'uuid'
  ) then
    raise exception 'public.invite_codes.id is not uuid. Nothing was changed.';
  end if;
end;
$price_schedule_dependencies$;

-- ---------------------------------------------------------------------------
-- discount_code_terms: condiciones de un código con precio por ciclos.
-- ---------------------------------------------------------------------------

create table if not exists public.discount_code_terms (
  invite_code_id uuid primary key references public.invite_codes(id) on delete restrict,
  promo_cycles integer not null,
  post_price numeric(12, 2) not null,
  notice_days integer not null default 20,
  notice_lead_days integer not null default 30,
  terms_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_code_terms_cycles_check check (promo_cycles between 1 and 24),
  constraint discount_code_terms_post_price_check check (post_price > 0),
  constraint discount_code_terms_notice_days_check check (notice_days between 7 and 60),
  constraint discount_code_terms_lead_check check (notice_lead_days between notice_days and 90),
  constraint discount_code_terms_version_check check (char_length(btrim(terms_version)) between 1 and 64)
);

comment on table public.discount_code_terms is
  'Condiciones de un código de precio fijo por ciclos (p. ej. 9.900 x 6 períodos y luego 19.900). Sin fila = código sin condiciones de ciclos.';

-- ---------------------------------------------------------------------------
-- promo_acceptances: consentimiento expreso (snapshot de lo aceptado). Inmutable.
-- ---------------------------------------------------------------------------

create table if not exists public.promo_acceptances (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.discount_code_reservations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invite_code_id uuid not null references public.invite_codes(id) on delete restrict,
  currency text not null,
  list_price numeric(12, 2) not null,
  promo_price numeric(12, 2) not null,
  post_price numeric(12, 2) not null,
  promo_cycles integer not null,
  notice_days integer not null,
  notice_lead_days integer not null,
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  constraint promo_acceptances_prices_check check (promo_price > 0 and post_price >= promo_price and list_price > 0),
  constraint promo_acceptances_currency_check check (currency ~ '^[A-Z]{3}$')
);

-- ---------------------------------------------------------------------------
-- price_schedules: una fila por suscripción promocional.
-- ---------------------------------------------------------------------------

create table if not exists public.price_schedules (
  id uuid primary key default gen_random_uuid(),
  acceptance_id uuid not null unique references public.promo_acceptances(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invite_code_id uuid not null references public.invite_codes(id) on delete restrict,
  mercado_pago_preapproval_id text not null,
  currency text not null,
  list_price numeric(12, 2) not null,
  promo_price numeric(12, 2) not null,
  post_price numeric(12, 2) not null,
  promo_cycles integer not null,
  notice_days integer not null,
  notice_lead_days integer not null,
  terms_version text not null,
  accepted_at timestamptz not null,
  status text not null default 'scheduled',
  anchor_at timestamptz,
  promo_ends_at timestamptz,
  approved_promo_periods integer not null default 0,
  notice_email_sent_at timestamptz,
  notice_email_count integer not null default 0,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  lease_until timestamptz,
  applied_at timestamptz,
  last_error text,
  last_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_schedules_status_check check (status in ('scheduled', 'applied', 'needs_review', 'needs_reauth', 'failed', 'void')),
  constraint price_schedules_anchor_pair_check check ((anchor_at is null) = (promo_ends_at is null)),
  constraint price_schedules_applied_has_date check (status <> 'applied' or applied_at is not null)
);

create unique index if not exists price_schedules_preapproval_idx on public.price_schedules (mercado_pago_preapproval_id);
create index if not exists price_schedules_user_idx on public.price_schedules (user_id);
create index if not exists price_schedules_work_idx on public.price_schedules (promo_ends_at) where status = 'scheduled';

create table if not exists public.price_schedule_events (
  id bigint generated always as identity primary key,
  schedule_id uuid not null references public.price_schedules(id) on delete cascade,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists price_schedule_events_schedule_idx on public.price_schedule_events (schedule_id, id);

-- ---------------------------------------------------------------------------
-- Guardas: los términos aceptados no cambian nunca, ni siquiera para service_role.
-- ---------------------------------------------------------------------------

create or replace function public.discount_code_terms_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Con aceptaciones registradas, las condiciones de ese código ya no se editan (se crea otro código/versión).
  if (new.promo_cycles is distinct from old.promo_cycles
      or new.post_price is distinct from old.post_price
      or new.terms_version is distinct from old.terms_version
      or new.notice_days is distinct from old.notice_days
      or new.notice_lead_days is distinct from old.notice_lead_days)
     and exists (select 1 from public.promo_acceptances a where a.invite_code_id = old.invite_code_id) then
    raise exception 'discount code terms cannot change once users accepted them';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists discount_code_terms_guard_trg on public.discount_code_terms;
create trigger discount_code_terms_guard_trg
  before update on public.discount_code_terms
  for each row execute function public.discount_code_terms_guard();

create or replace function public.promo_acceptances_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'promo_acceptances is immutable';
end;
$$;

drop trigger if exists promo_acceptances_guard_trg on public.promo_acceptances;
create trigger promo_acceptances_guard_trg
  before update on public.promo_acceptances
  for each row execute function public.promo_acceptances_guard();

create or replace function public.price_schedules_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id <> old.id
     or new.acceptance_id <> old.acceptance_id
     or new.user_id <> old.user_id
     or new.invite_code_id <> old.invite_code_id
     or new.mercado_pago_preapproval_id <> old.mercado_pago_preapproval_id
     or new.currency <> old.currency
     or new.list_price <> old.list_price
     or new.promo_price <> old.promo_price
     or new.post_price <> old.post_price
     or new.promo_cycles <> old.promo_cycles
     or new.notice_days <> old.notice_days
     or new.notice_lead_days <> old.notice_lead_days
     or new.terms_version <> old.terms_version
     or new.accepted_at <> old.accepted_at
     or new.created_at <> old.created_at then
    raise exception 'price schedule terms (prices, cycles, consent) are immutable';
  end if;

  -- The calendar anchor is fixed once; payments can never move it.
  if old.anchor_at is not null
     and (new.anchor_at is distinct from old.anchor_at or new.promo_ends_at is distinct from old.promo_ends_at) then
    raise exception 'the promotion calendar is fixed once set';
  end if;

  if old.status in ('applied', 'void') and new.status <> old.status then
    raise exception 'a % price schedule is terminal', old.status;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists price_schedules_guard_trg on public.price_schedules;
create trigger price_schedules_guard_trg
  before update on public.price_schedules
  for each row execute function public.price_schedules_guard();

create or replace function public.price_schedule_events_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'price_schedule_events is append-only';
end;
$$;

drop trigger if exists price_schedule_events_guard_trg on public.price_schedule_events;
create trigger price_schedule_events_guard_trg
  before update on public.price_schedule_events
  for each row execute function public.price_schedule_events_guard();

-- ---------------------------------------------------------------------------
-- RLS y privilegios. Escritura solo por funciones; cada persona lee solo su agenda (sin errores del proveedor).
-- ---------------------------------------------------------------------------

alter table public.discount_code_terms enable row level security;
alter table public.promo_acceptances enable row level security;
alter table public.price_schedules enable row level security;
alter table public.price_schedule_events enable row level security;

revoke all on table public.discount_code_terms from public, anon, authenticated, service_role;
revoke all on table public.promo_acceptances from public, anon, authenticated, service_role;
revoke all on table public.price_schedules from public, anon, authenticated, service_role;
revoke all on table public.price_schedule_events from public, anon, authenticated, service_role;

-- Las condiciones las edita el servidor (admin) con service_role; el trigger protege lo ya aceptado.
grant select, insert, update on table public.discount_code_terms to service_role;
grant select on table public.promo_acceptances to service_role;
grant select on table public.price_schedules to service_role;
grant select on table public.price_schedule_events to service_role;

grant select (
  id, user_id, status, currency, promo_price, post_price, promo_cycles, notice_lead_days,
  anchor_at, promo_ends_at, notice_email_sent_at, applied_at
) on public.price_schedules to authenticated;

drop policy if exists price_schedules_select_own on public.price_schedules;
create policy price_schedules_select_own
  on public.price_schedules for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Funciones
-- ---------------------------------------------------------------------------

create or replace function public._price_schedule_event(p_schedule_id uuid, p_event text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.price_schedule_events (schedule_id, event, detail) values (p_schedule_id, p_event, coalesce(p_detail, '{}'::jsonb))
$$;

-- Condiciones de un código (para mostrar y exigir la aceptación). Mismo criterio de normalización que reserve_discount_code.
create or replace function public.promo_terms_for_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_norm text := upper(regexp_replace(btrim(coalesce(p_code, '')), '\s+', '-', 'g'));
  v_terms public.discount_code_terms%rowtype;
begin
  select t.* into v_terms
  from public.invite_codes c
  join public.discount_code_terms t on t.invite_code_id = c.id
  where c.code = v_norm and c.status = 'active';

  if not found then
    return jsonb_build_object('has_terms', false);
  end if;

  return jsonb_build_object(
    'has_terms', true,
    'promo_cycles', v_terms.promo_cycles,
    'post_price', v_terms.post_price,
    'notice_days', v_terms.notice_days,
    'terms_version', v_terms.terms_version
  );
end;
$$;

-- Registra el consentimiento expreso. Se llama justo después de reservar el código y ANTES de crear el checkout.
-- Estados: recorded | already_recorded | not_found | not_reservable | no_terms | terms_mismatch.
create or replace function public.record_promo_acceptance(p_user_id uuid, p_reservation_id uuid, p_terms_version text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res public.discount_code_reservations%rowtype;
  v_terms public.discount_code_terms%rowtype;
  v_existing public.promo_acceptances%rowtype;
begin
  select * into v_res from public.discount_code_reservations where id = p_reservation_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into v_existing from public.promo_acceptances where reservation_id = v_res.id;
  if found then
    return jsonb_build_object('status', 'already_recorded', 'acceptance_id', v_existing.id);
  end if;

  if v_res.status not in ('reserved', 'confirmed') then
    return jsonb_build_object('status', 'not_reservable');
  end if;

  select * into v_terms from public.discount_code_terms where invite_code_id = v_res.invite_code_id;
  if not found then
    return jsonb_build_object('status', 'no_terms');
  end if;
  if p_terms_version is null or p_terms_version <> v_terms.terms_version then
    return jsonb_build_object('status', 'terms_mismatch');
  end if;
  -- The accepted later price can never be below the promotional one (that would not be a "later" price).
  if v_terms.post_price < v_res.final_amount then
    return jsonb_build_object('status', 'no_terms');
  end if;

  insert into public.promo_acceptances (
    reservation_id, user_id, invite_code_id, currency, list_price, promo_price, post_price,
    promo_cycles, notice_days, notice_lead_days, terms_version
  ) values (
    v_res.id, v_res.user_id, v_res.invite_code_id, v_res.currency, v_res.base_amount, v_res.final_amount, v_terms.post_price,
    v_terms.promo_cycles, v_terms.notice_days, v_terms.notice_lead_days, v_terms.terms_version
  )
  on conflict (reservation_id) do nothing
  returning * into v_existing;

  return jsonb_build_object('status', 'recorded', 'acceptance_id', v_existing.id);
end;
$$;

-- Crea la agenda cuando Mercado Pago autorizó la preapproval de una reserva confirmada con aceptación. Idempotente.
-- Estados: created | exists | none | no_acceptance.
create or replace function public.ensure_price_schedule(p_preapproval_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res public.discount_code_reservations%rowtype;
  v_acc public.promo_acceptances%rowtype;
  v_id uuid;
begin
  if p_preapproval_id is null or btrim(p_preapproval_id) = '' then
    raise exception 'preapproval id is required';
  end if;

  select r.* into v_res
  from public.discount_code_reservations r
  join public.checkout_attempts a on a.id = r.checkout_attempt_id
  where a.mercado_pago_preapproval_id = p_preapproval_id
    and r.status = 'confirmed'
  order by r.confirmed_at desc nulls last
  limit 1;

  if not found then
    -- Not a (confirmed) discounted checkout. A schedule that already exists for this preapproval keeps existing.
    if exists (select 1 from public.price_schedules where mercado_pago_preapproval_id = p_preapproval_id) then
      return jsonb_build_object('status', 'exists');
    end if;
    return jsonb_build_object('status', 'none');
  end if;

  select * into v_acc from public.promo_acceptances where reservation_id = v_res.id;
  if not found then
    return jsonb_build_object('status', 'no_acceptance');
  end if;

  insert into public.price_schedules (
    acceptance_id, user_id, invite_code_id, mercado_pago_preapproval_id, currency, list_price, promo_price, post_price,
    promo_cycles, notice_days, notice_lead_days, terms_version, accepted_at
  ) values (
    v_acc.id, v_acc.user_id, v_acc.invite_code_id, p_preapproval_id, v_acc.currency, v_acc.list_price, v_acc.promo_price,
    v_acc.post_price, v_acc.promo_cycles, v_acc.notice_days, v_acc.notice_lead_days, v_acc.terms_version, v_acc.accepted_at
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('status', 'exists');
  end if;

  perform public._price_schedule_event(v_id, 'created', jsonb_build_object('promo_price', v_acc.promo_price, 'post_price', v_acc.post_price, 'promo_cycles', v_acc.promo_cycles));
  return jsonb_build_object('status', 'created', 'schedule_id', v_id);
end;
$$;

-- Sincroniza una agenda con lo ya registrado por el circuito de facturación. Idempotente: se recalcula todo cada vez.
--   * fija el ancla (fecha de débito de la primera cuota) UNA vez; promo_ends_at = ancla + promo_cycles meses;
--   * concilia cuántos períodos promocionales tienen un cobro aprobado (solo informativo);
--   * una cancelación en Mercado Pago cierra la agenda (void).
create or replace function public.sync_price_schedule(p_preapproval_id text, p_provider_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sched public.price_schedules%rowtype;
  v_provider text := lower(btrim(coalesce(p_provider_status, '')));
  v_anchor timestamptz;
  v_ends timestamptz;
  v_approved integer;
begin
  select * into v_sched from public.price_schedules where mercado_pago_preapproval_id = p_preapproval_id for update;
  if not found then
    return jsonb_build_object('status', 'none');
  end if;

  if v_sched.anchor_at is null then
    select min(coalesce(
      case when p.raw_data->>'debit_date' ~ '^\d{4}-\d{2}-\d{2}T' then (p.raw_data->>'debit_date')::timestamptz end,
      p.paid_at
    )) into v_anchor
    from public.payments p
    join public.subscriptions s on s.id = p.subscription_id
    where s.mercado_pago_preapproval_id = p_preapproval_id and s.user_id = v_sched.user_id;

    if v_anchor is not null then
      v_ends := ((v_anchor at time zone 'UTC') + make_interval(months => v_sched.promo_cycles)) at time zone 'UTC';
      update public.price_schedules set anchor_at = v_anchor, promo_ends_at = v_ends where id = v_sched.id returning * into v_sched;
      perform public._price_schedule_event(v_sched.id, 'anchor_set', jsonb_build_object('anchor_at', v_anchor, 'promo_ends_at', v_ends));
    end if;
  end if;

  select count(*) into v_approved
  from public.payments p
  join public.subscriptions s on s.id = p.subscription_id
  where s.mercado_pago_preapproval_id = p_preapproval_id
    and s.user_id = v_sched.user_id
    and lower(coalesce(p.status::text, '')) = 'approved'
    and round(p.amount::numeric, 2) = v_sched.promo_price
    and (v_sched.promo_ends_at is null or p.paid_at < v_sched.promo_ends_at);

  if v_approved <> v_sched.approved_promo_periods then
    update public.price_schedules set approved_promo_periods = v_approved where id = v_sched.id returning * into v_sched;
  end if;

  if v_provider in ('cancelled', 'canceled') and v_sched.status <> 'void' and v_sched.status <> 'applied' then
    update public.price_schedules set status = 'void', lease_until = null where id = v_sched.id returning * into v_sched;
    perform public._price_schedule_event(v_sched.id, 'void', jsonb_build_object('reason', 'provider_cancelled'));
  end if;

  return jsonb_build_object(
    'status', v_sched.status,
    'schedule_id', v_sched.id,
    'anchor_at', v_sched.anchor_at,
    'promo_ends_at', v_sched.promo_ends_at,
    'approved_promo_periods', v_sched.approved_promo_periods
  );
end;
$$;

-- Trabajo pendiente para el cron: agendas activas con ancla cuya ventana ya empezó (notice_lead_days + 10 días antes del
-- fin) o ya pasó, sin lease vigente y sin espera de reintento. Devuelve filas, no las modifica.
create or replace function public.list_price_schedule_work(p_limit integer default 40)
returns setof public.price_schedules
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.*
  from public.price_schedules s
  where s.status = 'scheduled'
    and s.anchor_at is not null
    and s.promo_ends_at - make_interval(days => s.notice_lead_days + 10) <= now()
    and (s.lease_until is null or s.lease_until < now())
    and (s.next_attempt_at is null or s.next_attempt_at <= now())
  order by s.promo_ends_at
  limit greatest(least(coalesce(p_limit, 40), 200), 1)
$$;

-- Lease atómico: solo una ejecución puede procesar una agenda a la vez (dos crons / un webhook simultáneos no hacen dos PUT).
create or replace function public.claim_price_schedule(p_id uuid, p_lease_seconds integer default 120)
returns setof public.price_schedules
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.price_schedules
  set lease_until = now() + make_interval(secs => greatest(least(coalesce(p_lease_seconds, 120), 900), 30))
  where id = p_id
    and status = 'scheduled'
    and (lease_until is null or lease_until < now())
  returning *
$$;

-- Cierra una pasada: libera el lease y fija el estado. Solo desde 'scheduled'. p_error != null cuenta un intento fallido.
create or replace function public.finish_price_schedule(
  p_id uuid,
  p_status text,
  p_error text default null,
  p_snapshot jsonb default null,
  p_retry_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sched public.price_schedules%rowtype;
begin
  if p_status not in ('scheduled', 'applied', 'needs_review', 'needs_reauth', 'failed', 'void') then
    raise exception 'invalid price schedule status';
  end if;

  select * into v_sched from public.price_schedules where id = p_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_sched.status <> 'scheduled' then
    return jsonb_build_object('status', v_sched.status, 'unchanged', true);
  end if;

  update public.price_schedules
  set status = p_status,
      lease_until = null,
      attempts = attempts + case when p_error is not null then 1 else 0 end,
      last_error = case when p_error is not null then left(p_error, 500) else last_error end,
      last_snapshot = coalesce(p_snapshot, last_snapshot),
      next_attempt_at = case when p_retry_seconds is not null then now() + make_interval(secs => p_retry_seconds) else null end,
      applied_at = case when p_status = 'applied' then now() else applied_at end
  where id = p_id
  returning * into v_sched;

  return jsonb_build_object('status', v_sched.status, 'attempts', v_sched.attempts);
end;
$$;

create or replace function public.mark_price_notice_sent(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sched public.price_schedules%rowtype;
begin
  update public.price_schedules
  set notice_email_sent_at = now(), notice_email_count = notice_email_count + 1
  where id = p_id and status = 'scheduled'
  returning * into v_sched;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  perform public._price_schedule_event(p_id, 'notice_email_sent', jsonb_build_object('count', v_sched.notice_email_count));
  return jsonb_build_object('status', 'marked', 'notice_email_sent_at', v_sched.notice_email_sent_at);
end;
$$;

create or replace function public.add_price_schedule_event(p_id uuid, p_event text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_event is null or p_event !~ '^[a-z_]{3,40}$' then
    raise exception 'event must be a short snake_case code';
  end if;
  insert into public.price_schedule_events (schedule_id, event, detail) values (p_id, p_event, coalesce(p_detail, '{}'::jsonb));
end;
$$;

-- Privilegios de funciones: service_role únicamente.
revoke all on function public._price_schedule_event(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.promo_terms_for_code(text) from public, anon, authenticated;
revoke all on function public.record_promo_acceptance(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ensure_price_schedule(text) from public, anon, authenticated;
revoke all on function public.sync_price_schedule(text, text) from public, anon, authenticated;
revoke all on function public.list_price_schedule_work(integer) from public, anon, authenticated;
revoke all on function public.claim_price_schedule(uuid, integer) from public, anon, authenticated;
revoke all on function public.finish_price_schedule(uuid, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.mark_price_notice_sent(uuid) from public, anon, authenticated;
revoke all on function public.add_price_schedule_event(uuid, text, jsonb) from public, anon, authenticated;

grant execute on function public.promo_terms_for_code(text) to service_role;
grant execute on function public.record_promo_acceptance(uuid, uuid, text) to service_role;
grant execute on function public.ensure_price_schedule(text) to service_role;
grant execute on function public.sync_price_schedule(text, text) to service_role;
grant execute on function public.list_price_schedule_work(integer) to service_role;
grant execute on function public.claim_price_schedule(uuid, integer) to service_role;
grant execute on function public.finish_price_schedule(uuid, text, text, jsonb, integer) to service_role;
grant execute on function public.mark_price_notice_sent(uuid) to service_role;
grant execute on function public.add_price_schedule_event(uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
