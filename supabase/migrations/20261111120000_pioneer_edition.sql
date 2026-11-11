-- Edición Pioneros — M1: estructura de datos (20 cupos, $9.900 x 6 ciclos, insignia permanente).
--
-- Diseño aprobado: docs/PIONEERS_EDITION_DESIGN.md. Esta migration es ADITIVA: crea objetos nuevos y nada más.
--
--   NO modifica (ni DDL ni DML): founder_members, founder_pricing_tiers, subscriptions, payments, profiles,
--   membership_settings, checkout_attempts, user_access_grants, platform_feature_flags, has_platform_access,
--   ni ninguna policy existente. La única referencia a una tabla existente que no es propia son SELECT de lectura
--   (elegibilidad y verificación de pagos) dentro de las funciones de abajo. Los 3 Fundadores reales viven en
--   founder_members y quedan fuera: la reserva rechaza a cualquiera que figure ahí.
--   No activa la promoción: pioneer_edition nace con enabled = false y sin términos aprobados (terms_version null),
--   y la base impide encenderla sin términos.
--
-- Objetos nuevos:
--   * public.pioneer_edition: una sola fila (id = 'default') con la configuración de la edición.
--   * public.pioneer_members: libro de cupos. Un lugar por persona. reserved -> active (primer pago aprobado
--     verificado en public.payments) | released. 'active' es PERMANENTE: la numeración y la insignia no se pierden
--     ni se reasignan (un trigger lo impone también contra el service_role).
--   * public.pioneer_seat_events: bitácora append-only de cada transición.
--   * Funciones (solo service_role): pioneer_offer_state, reserve_pioneer_seat, attach_pioneer_seat,
--     sync_pioneer_seat, release_pioneer_seat, release_expired_pioneer_holds, pioneer_early_access_features.
--
-- Invariantes en la base (no dependen del código de la app):
--   * Nunca más de capacity (<= 20) lugares reserved/active a la vez: índice único parcial sobre pioneer_number
--     (1..20) + advisory lock global en cada operación que ocupa un número + CHECK 1..20.
--   * Un lugar reserved/active por persona (índice único parcial sobre user_id).
--   * Un preapproval pertenece a un solo lugar.
--   * Un lugar se confirma SOLO si public.payments (escrito por el servidor desde Mercado Pago) tiene un pago
--     `approved` de esa suscripción, de esa persona, por exactamente el precio promocional bloqueado.
--     Ningún parámetro "estoy pagado" viaja desde el cliente.
--   * Ninguna escritura directa para anon/authenticated/service_role sobre las tablas: solo funciones.
--
-- Depende de tablas no versionadas en este repo (payments, founder_members, subscriptions) y de checkout_attempts.
-- Un preflight aborta sin cambiar nada si falta algo. Seguro de re-ejecutar.

do $pioneer_dependencies$
declare
  v_missing text;
begin
  if to_regclass('auth.users') is null
     or to_regclass('public.checkout_attempts') is null
     or to_regclass('public.subscriptions') is null
     or to_regclass('public.payments') is null
     or to_regclass('public.founder_members') is null then
    raise exception 'Missing dependency: auth.users, public.checkout_attempts, public.subscriptions, public.payments and public.founder_members are required. Nothing was changed.';
  end if;

  if to_regprocedure('auth.uid()') is null then
    raise exception 'Missing dependency: auth.uid(). Nothing was changed.';
  end if;

  select string_agg(req.tbl || '.' || req.col, ', ') into v_missing
  from (values
    ('checkout_attempts', 'id'), ('checkout_attempts', 'user_id'), ('checkout_attempts', 'amount'),
    ('checkout_attempts', 'currency'), ('checkout_attempts', 'state'),
    ('checkout_attempts', 'mercado_pago_preapproval_id'),
    ('subscriptions', 'id'), ('subscriptions', 'user_id'), ('subscriptions', 'status'),
    ('subscriptions', 'mercado_pago_preapproval_id'),
    ('payments', 'id'), ('payments', 'user_id'), ('payments', 'subscription_id'), ('payments', 'status'),
    ('payments', 'amount'), ('payments', 'currency'), ('payments', 'paid_at'),
    ('founder_members', 'user_id')
  ) as req(tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = req.tbl and c.column_name = req.col
  );

  if v_missing is not null then
    raise exception 'Missing expected columns: %. Nothing was changed.', v_missing
      using hint = 'Run supabase/diagnostics/20261110_founders_legacy_state.sql and review the table shapes.';
  end if;

  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'checkout_attempts' and c.column_name = 'id' and c.data_type = 'uuid'
  ) then
    raise exception 'public.checkout_attempts.id is not uuid. Nothing was changed.';
  end if;
end;
$pioneer_dependencies$;

-- ---------------------------------------------------------------------------
-- Helper puro usado por un CHECK: lista de funcionalidades de acceso anticipado (mismo formato que
-- platform_feature_flags.feature_id). Inmutable e inocuo; no se le revoca EXECUTE porque el CHECK lo evalúa.
-- ---------------------------------------------------------------------------

create or replace function public.pioneer_valid_feature_ids(p_ids text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_ids is not null
    and coalesce(cardinality(p_ids), 0) <= 50
    and not exists (select 1 from unnest(p_ids) as x where x is null or x !~ '^[a-z][a-z0-9_]{1,47}$')
$$;

-- ---------------------------------------------------------------------------
-- pioneer_edition: configuración (una sola fila).
-- ---------------------------------------------------------------------------

create table if not exists public.pioneer_edition (
  id text primary key default 'default',
  enabled boolean not null default false,
  capacity integer not null default 20,
  promo_price numeric(12, 2) not null default 9900,
  currency text not null default 'ARS',
  price_cycles integer not null default 6,
  terms_version text,
  hold_minutes integer not null default 60,
  unpaid_hold_days integer not null default 11,
  early_access_features text[] not null default '{}',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint pioneer_edition_singleton check (id = 'default'),
  constraint pioneer_edition_capacity_check check (capacity between 1 and 20),
  constraint pioneer_edition_price_check check (promo_price > 0),
  constraint pioneer_edition_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint pioneer_edition_cycles_check check (price_cycles between 1 and 24),
  constraint pioneer_edition_terms_check check (terms_version is null or char_length(btrim(terms_version)) between 1 and 64),
  constraint pioneer_edition_hold_minutes_check check (hold_minutes between 5 and 240),
  constraint pioneer_edition_unpaid_hold_days_check check (unpaid_hold_days between 1 and 30),
  constraint pioneer_edition_enabled_needs_terms check (not enabled or terms_version is not null),
  constraint pioneer_edition_features_check check (public.pioneer_valid_feature_ids(early_access_features))
);

comment on table public.pioneer_edition is
  'Edición Pioneros: configuración única. enabled = false por defecto (interruptor único). early_access_features vacía por defecto: solo la elige administración.';

-- La configuración nace APAGADA y sin términos. Si ya existe, no se toca.
insert into public.pioneer_edition (id, enabled) values ('default', false) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- pioneer_members: libro de cupos.
-- ---------------------------------------------------------------------------

create table if not exists public.pioneer_members (
  id uuid primary key default gen_random_uuid(),
  -- Si se borra la cuenta, el número NO se reasigna (queda con user_id null).
  user_id uuid references auth.users(id) on delete set null,
  pioneer_number integer not null,
  status text not null default 'reserved',
  currency text not null,
  locked_price numeric(12, 2) not null,
  locked_cycles integer not null,
  accepted_regular_price numeric(12, 2) not null,
  accepted_terms_version text not null,
  accepted_at timestamptz not null default now(),
  checkout_attempt_id uuid references public.checkout_attempts(id) on delete set null,
  mercado_pago_preapproval_id text,
  reserved_at timestamptz not null default now(),
  reservation_expires_at timestamptz,
  confirmed_at timestamptz,
  first_payment_id text,
  cycles_paid integer not null default 0,
  step_up_status text not null default 'not_due',
  step_up_target numeric(12, 2),
  step_up_applied_at timestamptz,
  step_up_error text,
  benefits_ended_at timestamptz,
  benefits_end_reason text,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pioneer_members_status_check check (status in ('reserved', 'active', 'released')),
  constraint pioneer_members_number_check check (pioneer_number between 1 and 20),
  constraint pioneer_members_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint pioneer_members_prices_check check (locked_price > 0 and accepted_regular_price > 0),
  constraint pioneer_members_cycles_check check (locked_cycles between 1 and 24 and cycles_paid >= 0),
  constraint pioneer_members_step_up_check check (step_up_status in ('not_due', 'due', 'applied', 'failed', 'manual', 'void')),
  constraint pioneer_members_reserved_has_expiry check (status <> 'reserved' or reservation_expires_at is not null),
  constraint pioneer_members_active_is_confirmed check (status <> 'active' or (confirmed_at is not null and first_payment_id is not null)),
  constraint pioneer_members_released_has_date check (status <> 'released' or released_at is not null),
  constraint pioneer_members_benefits_only_active check (benefits_ended_at is null or status = 'active')
);

comment on table public.pioneer_members is
  'Libro de cupos de la Edición Pioneros. reserved (temporal) -> active (primer pago aprobado verificado; PERMANENTE) | released. Solo se escribe por funciones.';

-- Invariantes de integridad: ocupación máxima, un lugar por persona, un preapproval por lugar.
create unique index if not exists pioneer_members_number_occupied_idx
  on public.pioneer_members (pioneer_number) where status in ('reserved', 'active');
create unique index if not exists pioneer_members_user_occupied_idx
  on public.pioneer_members (user_id) where status in ('reserved', 'active');
create unique index if not exists pioneer_members_preapproval_idx
  on public.pioneer_members (mercado_pago_preapproval_id) where mercado_pago_preapproval_id is not null;
create index if not exists pioneer_members_attempt_idx on public.pioneer_members (checkout_attempt_id);
create index if not exists pioneer_members_reserved_expiry_idx
  on public.pioneer_members (reservation_expires_at) where status = 'reserved';

create table if not exists public.pioneer_seat_events (
  id bigint generated always as identity primary key,
  seat_id uuid not null references public.pioneer_members(id) on delete restrict,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pioneer_seat_events_seat_idx on public.pioneer_seat_events (seat_id, id);

-- ---------------------------------------------------------------------------
-- Guardas (triggers): defensa en profundidad incluso contra el service_role.
-- ---------------------------------------------------------------------------

create or replace function public.pioneer_members_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- Ningún lugar nace confirmado: solo el pago verificado (sync_pioneer_seat) lo confirma.
    if new.status <> 'reserved' then
      raise exception 'a pioneer seat can only be created as reserved';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'pioneer seats are never deleted (numbering is permanent)';
  end if;

  -- UPDATE
  if new.id <> old.id
     or new.currency is distinct from old.currency
     or new.locked_price is distinct from old.locked_price
     or new.locked_cycles is distinct from old.locked_cycles
     or new.accepted_regular_price is distinct from old.accepted_regular_price
     or new.accepted_terms_version is distinct from old.accepted_terms_version
     or new.accepted_at is distinct from old.accepted_at
     or new.reserved_at is distinct from old.reserved_at
     or new.created_at is distinct from old.created_at then
    raise exception 'pioneer seat terms (price, cycles, consent) are immutable';
  end if;

  -- user_id solo puede pasar a null (borrado de cuenta); nunca se reasigna a otra persona.
  if new.user_id is distinct from old.user_id and new.user_id is not null then
    raise exception 'pioneer seat owner cannot change';
  end if;

  if old.status = 'active' then
    if new.status <> 'active' then
      raise exception 'an active pioneer seat is permanent';
    end if;
    if new.pioneer_number <> old.pioneer_number
       or new.confirmed_at is distinct from old.confirmed_at
       or new.first_payment_id is distinct from old.first_payment_id then
      raise exception 'confirmed pioneer numbering is permanent';
    end if;
    if new.cycles_paid < old.cycles_paid then
      raise exception 'cycles_paid never decreases';
    end if;
    if old.benefits_ended_at is not null and new.benefits_ended_at is distinct from old.benefits_ended_at then
      raise exception 'ended benefits cannot be restored';
    end if;
  elsif old.status = 'reserved' then
    if new.pioneer_number <> old.pioneer_number then
      raise exception 'a reserved seat keeps its number';
    end if;
  elsif old.status = 'released' then
    if new.status not in ('released', 'active') then
      raise exception 'a released seat can only stay released or be confirmed by a late verified payment';
    end if;
    if new.status = 'released' and new.pioneer_number <> old.pioneer_number then
      raise exception 'a released seat keeps its number';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pioneer_members_guard_trg on public.pioneer_members;
create trigger pioneer_members_guard_trg
  before insert or update or delete on public.pioneer_members
  for each row execute function public.pioneer_members_guard();

create or replace function public.pioneer_edition_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'the pioneer edition configuration row cannot be deleted';
  end if;

  -- Con lugares reservados o activos no se cambian capacidad, precio, moneda ni ciclos.
  if (new.capacity is distinct from old.capacity
      or new.promo_price is distinct from old.promo_price
      or new.currency is distinct from old.currency
      or new.price_cycles is distinct from old.price_cycles)
     and exists (select 1 from public.pioneer_members m where m.status in ('reserved', 'active')) then
    raise exception 'capacity, price, currency and cycles cannot change while there are reserved or active pioneer seats';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pioneer_edition_guard_trg on public.pioneer_edition;
create trigger pioneer_edition_guard_trg
  before update or delete on public.pioneer_edition
  for each row execute function public.pioneer_edition_guard();

create or replace function public.pioneer_seat_events_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'pioneer_seat_events is append-only';
end;
$$;

drop trigger if exists pioneer_seat_events_guard_trg on public.pioneer_seat_events;
create trigger pioneer_seat_events_guard_trg
  before update or delete on public.pioneer_seat_events
  for each row execute function public.pioneer_seat_events_guard();

-- ---------------------------------------------------------------------------
-- RLS y privilegios. Nada de escritura directa para nadie; solo funciones.
-- ---------------------------------------------------------------------------

alter table public.pioneer_edition enable row level security;
alter table public.pioneer_members enable row level security;
alter table public.pioneer_seat_events enable row level security;

revoke all on table public.pioneer_edition from public, anon, authenticated, service_role;
revoke all on table public.pioneer_members from public, anon, authenticated, service_role;
revoke all on table public.pioneer_seat_events from public, anon, authenticated, service_role;

-- La configuración la lee y la ajusta solo el servidor (service_role); los triggers protegen lo crítico.
grant select, update on table public.pioneer_edition to service_role;
grant select on table public.pioneer_members to service_role;
grant select on table public.pioneer_seat_events to service_role;

-- Cada persona ve únicamente SU lugar y solo columnas no sensibles (sin ids de pago ni errores del proveedor).
grant select (
  id, user_id, pioneer_number, status, currency, locked_price, locked_cycles, accepted_regular_price,
  accepted_terms_version, accepted_at, reserved_at, reservation_expires_at, confirmed_at, cycles_paid,
  step_up_status, benefits_ended_at, created_at
) on public.pioneer_members to authenticated;

drop policy if exists pioneer_members_select_own on public.pioneer_members;
create policy pioneer_members_select_own
  on public.pioneer_members for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Funciones internas (sin EXECUTE para nadie salvo el dueño: solo las llaman otras funciones de abajo).
-- ---------------------------------------------------------------------------

create or replace function public._pioneer_lock()
returns void
language sql
set search_path = public, pg_temp
as $$
  -- Serializa toda operación que ocupa, libera o confirma un número (20 lugares: costo irrelevante).
  select pg_advisory_xact_lock(hashtextextended('pioneer_seats', 0))
$$;

create or replace function public._pioneer_log(p_seat_id uuid, p_event text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.pioneer_seat_events (seat_id, event, detail) values (p_seat_id, p_event, coalesce(p_detail, '{}'::jsonb))
$$;

-- Pagos que cuentan para un lugar: `approved`, de la suscripción con el preapproval del lugar, de esa persona,
-- en la misma moneda y por EXACTAMENTE el precio promocional bloqueado. Fuente: public.payments (la escribe el
-- servidor desde Mercado Pago), nunca un dato del cliente.
create or replace function public._pioneer_qualifying_payments(p_seat_id uuid)
returns table (payment_id text, paid_at timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select p.id::text, p.paid_at
  from public.pioneer_members m
  join public.subscriptions s
    on s.mercado_pago_preapproval_id = m.mercado_pago_preapproval_id and s.user_id = m.user_id
  join public.payments p
    on p.subscription_id = s.id and p.user_id = m.user_id
  where m.id = p_seat_id
    and m.mercado_pago_preapproval_id is not null
    and m.user_id is not null
    and lower(coalesce(p.status::text, '')) = 'approved'
    and coalesce(p.currency::text, m.currency) = m.currency
    and round(p.amount::numeric, 2) = m.locked_price
$$;

-- ¿Mercado Pago todavía podría cobrar algo vinculado a este lugar? Regla conservadora: SÍ, salvo que se sepa que no.
--   * La llamada de checkout a MP puede seguir en curso (intento 'creating' / 'reconciliation_required'): resultado
--     desconocido -> puede cobrar.
--   * Hay un preapproval (del lugar o del intento) cuya suscripción local NO figura cancelada -> puede cobrar. Un
--     preapproval pendiente todavía puede ser autorizado por la persona; uno autorizado se cobra solo; sin fila
--     local no se sabe -> se asume que puede cobrar.
-- Un lugar sin preapproval ni intento vigente (nunca se llegó a MP) o con todas sus suscripciones canceladas NO puede
-- cobrar. La cancelación en MP es terminal: no se reactiva.
create or replace function public._pioneer_seat_chargeable(p_seat_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select coalesce(a.state in ('creating', 'reconciliation_required'), false)
      or exists (
        select 1
        from (select m.mercado_pago_preapproval_id as pid union select a.mercado_pago_preapproval_id) ids
        where ids.pid is not null
          and not exists (
            select 1 from public.subscriptions s
            where s.mercado_pago_preapproval_id = ids.pid and lower(coalesce(s.status::text, '')) in ('cancelled', 'canceled')
          )
      )
    from public.pioneer_members m
    left join public.checkout_attempts a on a.id = m.checkout_attempt_id
    where m.id = p_seat_id
  ), false)
$$;

-- Libera las reservas vencidas que NO tienen pago verificado Y NO pueden ser cobradas por Mercado Pago. Un lugar
-- vencido cuya suscripción MP todavía podría cobrar NO se libera aquí: sigue ocupando su número hasta que el servidor
-- verifique en MP y lo cancele (sync_pioneer_seat con 'cancelled') o MP lo cobre (se confirma). Devuelve las liberadas.
create or replace function public._pioneer_sweep_expired()
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  with expired as (
    update public.pioneer_members m
    set status = 'released', released_at = now(), release_reason = 'expired'
    where m.status = 'reserved'
      and m.reservation_expires_at <= now()
      and not exists (select 1 from public._pioneer_qualifying_payments(m.id))
      and not public._pioneer_seat_chargeable(m.id)
    returning m.id, m.mercado_pago_preapproval_id
  ), logged as (
    insert into public.pioneer_seat_events (seat_id, event, detail)
    select e.id, 'released', jsonb_build_object('reason', 'expired') from expired e
  )
  select coalesce(jsonb_agg(jsonb_build_object('seat_id', e.id, 'preapproval_id', e.mercado_pago_preapproval_id)), '[]'::jsonb)
  into v_result
  from expired e;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- pioneer_offer_state: lectura agregada (única fuente de checkout, landing y admin). Sin datos de personas.
-- ---------------------------------------------------------------------------

create or replace function public.pioneer_offer_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ed public.pioneer_edition%rowtype;
  v_active integer;
  v_held integer;
  v_unresolved integer;
begin
  select * into v_ed from public.pioneer_edition where id = 'default';
  if not found then
    return jsonb_build_object('enabled', false, 'available', 0);
  end if;

  select count(*) into v_active from public.pioneer_members where status = 'active';
  select count(*) into v_held from public.pioneer_members where status = 'reserved' and reservation_expires_at > now();
  -- Vencidos que siguen ocupando número porque MP todavía podría cobrarlos (o esperan al barrido): no están disponibles.
  select count(*) into v_unresolved from public.pioneer_members where status = 'reserved' and reservation_expires_at <= now();

  return jsonb_build_object(
    'enabled', v_ed.enabled,
    'capacity', v_ed.capacity,
    'active', v_active,
    'held', v_held,
    'held_expired', v_unresolved,
    'available', greatest(v_ed.capacity - v_active - v_held - v_unresolved, 0),
    'promo_price', v_ed.promo_price,
    'currency', v_ed.currency,
    'price_cycles', v_ed.price_cycles,
    'terms_version', v_ed.terms_version,
    'hold_minutes', v_ed.hold_minutes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- reserve_pioneer_seat: reserva temporal atómica. Estados (nunca lanza por motivos de negocio):
-- reserved | disabled | currency_mismatch | terms_mismatch | no_benefit | founder_excluded | already_pioneer |
-- not_eligible | checkout_in_progress | sold_out.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_pioneer_seat(
  p_user_id uuid,
  p_regular_price numeric,
  p_currency text,
  p_terms_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_ed public.pioneer_edition%rowtype;
  v_regular numeric(12, 2);
  v_existing public.pioneer_members%rowtype;
  v_occupied integer;
  v_number integer;
  v_seat public.pioneer_members%rowtype;
begin
  if p_user_id is null then
    raise exception 'pioneer user is required';
  end if;
  if p_regular_price is null or p_regular_price <= 0 then
    raise exception 'pioneer regular price must be greater than zero';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'pioneer currency must be an ISO-style uppercase code';
  end if;
  if p_terms_version is null or btrim(p_terms_version) = '' then
    raise exception 'pioneer terms version is required';
  end if;

  v_regular := round(p_regular_price, 2);

  perform public._pioneer_lock();

  select * into v_ed from public.pioneer_edition where id = 'default';
  if not found or not v_ed.enabled then
    return jsonb_build_object('status', 'disabled');
  end if;
  if p_currency <> v_ed.currency then
    return jsonb_build_object('status', 'currency_mismatch');
  end if;
  if v_ed.terms_version is null or p_terms_version <> v_ed.terms_version then
    return jsonb_build_object('status', 'terms_mismatch');
  end if;
  if v_regular <= v_ed.promo_price then
    return jsonb_build_object('status', 'no_benefit');
  end if;

  perform public._pioneer_sweep_expired();

  -- Los Fundadores (los 3 creadores) no participan ni consumen cupos. Solo lectura.
  if exists (select 1 from public.founder_members f where f.user_id = p_user_id) then
    return jsonb_build_object('status', 'founder_excluded');
  end if;

  select * into v_existing
  from public.pioneer_members
  where user_id = p_user_id and status in ('reserved', 'active')
  for update;

  if found then
    if v_existing.status = 'active' then
      return jsonb_build_object('status', 'already_pioneer', 'pioneer_number', v_existing.pioneer_number);
    end if;

    if v_existing.accepted_regular_price = v_regular
       and v_existing.accepted_terms_version = p_terms_version
       and v_existing.currency = p_currency
       and v_existing.locked_price = v_ed.promo_price
       and v_existing.locked_cycles = v_ed.price_cycles then
      return jsonb_build_object(
        'status', 'reserved',
        'seat_id', v_existing.id,
        'pioneer_number', v_existing.pioneer_number,
        'locked_price', v_existing.locked_price,
        'locked_cycles', v_existing.locked_cycles,
        'currency', v_existing.currency,
        'expires_at', v_existing.reservation_expires_at,
        'reused', true
      );
    end if;

    -- Otro precio regular, otros términos u otra condición: solo se reemplaza si todavía no hay checkout.
    if v_existing.checkout_attempt_id is not null or v_existing.mercado_pago_preapproval_id is not null then
      return jsonb_build_object('status', 'checkout_in_progress', 'seat_id', v_existing.id);
    end if;

    update public.pioneer_members
    set status = 'released', released_at = v_now, release_reason = 'superseded'
    where id = v_existing.id;
    perform public._pioneer_log(v_existing.id, 'released', jsonb_build_object('reason', 'superseded'));
  end if;

  -- Nadie recibe el precio promocional por defecto: quien ya pagó o tiene una suscripción viva queda afuera
  -- (incluye las suscripciones de prueba internas).
  if exists (select 1 from public.payments p where p.user_id = p_user_id and lower(coalesce(p.status::text, '')) = 'approved')
     or exists (
       select 1 from public.subscriptions s
       where s.user_id = p_user_id and lower(coalesce(s.status::text, '')) in ('authorized', 'active', 'paused')
     ) then
    return jsonb_build_object('status', 'not_eligible');
  end if;

  select count(*) into v_occupied from public.pioneer_members where status in ('reserved', 'active');
  if v_occupied >= v_ed.capacity then
    -- needs_provider_check > 0: hay reservas vencidas que MP todavía podría cobrar; el servidor puede verificarlas
    -- (cancelar en MP las pendientes y sincronizar) y reintentar. No se liberan por su cuenta.
    return jsonb_build_object(
      'status', 'sold_out',
      'needs_provider_check', (select count(*) from public.pioneer_members where status = 'reserved' and reservation_expires_at <= v_now)
    );
  end if;

  select min(g) into v_number
  from generate_series(1, v_ed.capacity) g
  where not exists (
    select 1 from public.pioneer_members m where m.pioneer_number = g and m.status in ('reserved', 'active')
  );
  if v_number is null then
    return jsonb_build_object('status', 'sold_out');
  end if;

  insert into public.pioneer_members (
    user_id, pioneer_number, status, currency, locked_price, locked_cycles,
    accepted_regular_price, accepted_terms_version, accepted_at, reserved_at, reservation_expires_at
  ) values (
    p_user_id, v_number, 'reserved', v_ed.currency, v_ed.promo_price, v_ed.price_cycles,
    v_regular, p_terms_version, v_now, v_now, v_now + make_interval(mins => v_ed.hold_minutes)
  )
  returning * into v_seat;

  perform public._pioneer_log(v_seat.id, 'reserved', jsonb_build_object('pioneer_number', v_seat.pioneer_number));

  return jsonb_build_object(
    'status', 'reserved',
    'seat_id', v_seat.id,
    'pioneer_number', v_seat.pioneer_number,
    'locked_price', v_seat.locked_price,
    'locked_cycles', v_seat.locked_cycles,
    'currency', v_seat.currency,
    'expires_at', v_seat.reservation_expires_at,
    'reused', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- attach_pioneer_seat: ata el lugar al intento de checkout que lleva su monto. La base verifica que el intento es
-- de la persona y que se creó con EXACTAMENTE el precio promocional bloqueado.
-- ---------------------------------------------------------------------------

create or replace function public.attach_pioneer_seat(p_user_id uuid, p_seat_id uuid, p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seat public.pioneer_members%rowtype;
  v_att public.checkout_attempts%rowtype;
begin
  perform public._pioneer_lock();

  select * into v_seat from public.pioneer_members where id = p_seat_id and user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into v_att from public.checkout_attempts where id = p_attempt_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_seat.checkout_attempt_id = v_att.id and v_seat.status in ('reserved', 'active') then
    return jsonb_build_object('status', 'attached');
  end if;

  if v_seat.status <> 'reserved' then
    return jsonb_build_object('status', 'not_reservable');
  end if;

  if v_att.state not in ('creating', 'reconciliation_required', 'completed')
     or v_att.amount <> v_seat.locked_price
     or v_att.currency <> v_seat.currency then
    return jsonb_build_object('status', 'amount_mismatch');
  end if;

  if v_att.mercado_pago_preapproval_id is not null
     and exists (
       select 1 from public.pioneer_members o
       where o.mercado_pago_preapproval_id = v_att.mercado_pago_preapproval_id and o.id <> v_seat.id
     ) then
    return jsonb_build_object('status', 'preapproval_taken');
  end if;

  -- Un checkout reiniciado puede reemplazar el preapproval anterior solo si este no tiene pagos verificados.
  if v_seat.mercado_pago_preapproval_id is not null
     and v_att.mercado_pago_preapproval_id is not null
     and v_seat.mercado_pago_preapproval_id <> v_att.mercado_pago_preapproval_id
     and exists (select 1 from public._pioneer_qualifying_payments(v_seat.id)) then
    return jsonb_build_object('status', 'already_attached');
  end if;

  update public.pioneer_members
  set checkout_attempt_id = v_att.id,
      mercado_pago_preapproval_id = coalesce(v_att.mercado_pago_preapproval_id, v_seat.mercado_pago_preapproval_id)
  where id = v_seat.id;

  perform public._pioneer_log(v_seat.id, 'attached', jsonb_build_object('attempt_id', v_att.id));

  return jsonb_build_object('status', 'attached');
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_pioneer_seat: único punto que confirma, extiende o termina un lugar. Se llama desde el servidor cuando
-- Mercado Pago informa un cambio (webhook, sincronización, cron). TODO se deriva de public.payments y se calcula
-- de nuevo cada vez: repetir la llamada (webhooks duplicados o desordenados) no cambia nada.
--   p_provider_status: estado de la suscripción según MP ('authorized', 'pending', 'cancelled', ...). Solo se usa
--   para extender la retención o cerrar; NUNCA para confirmar (eso exige un pago aprobado en payments).
-- ---------------------------------------------------------------------------

create or replace function public.sync_pioneer_seat(p_preapproval_id text, p_provider_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_provider text := lower(btrim(coalesce(p_provider_status, '')));
  v_ed public.pioneer_edition%rowtype;
  v_seat public.pioneer_members%rowtype;
  v_paid integer;
  v_first text;
  v_other_amount integer;
  v_event text := 'unchanged';
  v_number integer;
  v_cycles integer;
  v_step text;
begin
  if p_preapproval_id is null or btrim(p_preapproval_id) = '' then
    raise exception 'preapproval id is required';
  end if;

  perform public._pioneer_lock();

  select * into v_seat from public.pioneer_members where mercado_pago_preapproval_id = p_preapproval_id for update;
  if not found then
    -- Aún no vinculado: se busca por el intento de checkout que lleva ese preapproval.
    select m.* into v_seat
    from public.pioneer_members m
    join public.checkout_attempts a on a.id = m.checkout_attempt_id
    where a.mercado_pago_preapproval_id = p_preapproval_id
    order by m.created_at desc
    limit 1
    for update of m;

    if not found then
      return jsonb_build_object('status', 'none');
    end if;

    if v_seat.mercado_pago_preapproval_id is null then
      update public.pioneer_members set mercado_pago_preapproval_id = p_preapproval_id where id = v_seat.id
      returning * into v_seat;
    end if;
  end if;

  select * into v_ed from public.pioneer_edition where id = 'default';

  select count(*), (array_agg(q.payment_id order by q.paid_at nulls last, q.payment_id))[1]
  into v_paid, v_first
  from public._pioneer_qualifying_payments(v_seat.id) q;

  -- Cobros aprobados de esa suscripción con otro importe: no confirman nada, se informan para revisión.
  select greatest(count(*) - v_paid, 0) into v_other_amount
  from public.payments p
  join public.subscriptions s on s.id = p.subscription_id
  where s.mercado_pago_preapproval_id = v_seat.mercado_pago_preapproval_id
    and s.user_id = v_seat.user_id
    and lower(coalesce(p.status::text, '')) = 'approved';

  if v_seat.status = 'reserved' then
    if v_paid > 0 then
      -- Primer pago aprobado verificado: el lugar queda confirmado (también si la retención ya había vencido:
      -- el número sigue siendo suyo porque nadie más pudo tomarlo).
      update public.pioneer_members
      set status = 'active',
          confirmed_at = v_now,
          first_payment_id = v_first,
          cycles_paid = v_paid,
          reservation_expires_at = null,
          step_up_status = case when v_paid >= locked_cycles then 'due' else step_up_status end
      where id = v_seat.id
      returning * into v_seat;
      perform public._pioneer_log(v_seat.id, 'confirmed', jsonb_build_object('first_payment_id', v_first, 'cycles_paid', v_paid));
      v_event := 'confirmed';
    elsif v_provider = 'cancelled' then
      update public.pioneer_members
      set status = 'released', released_at = v_now, release_reason = 'provider_cancelled'
      where id = v_seat.id
      returning * into v_seat;
      perform public._pioneer_log(v_seat.id, 'released', jsonb_build_object('reason', 'provider_cancelled'));
      v_event := 'released';
    elsif v_provider = 'authorized' and v_ed.unpaid_hold_days is not null then
      -- Autorizada pero sin cobro aprobado todavía: MP reintenta durante días; se retiene hasta que resuelva.
      if v_seat.reservation_expires_at < v_now + make_interval(days => v_ed.unpaid_hold_days) then
        update public.pioneer_members
        set reservation_expires_at = v_now + make_interval(days => v_ed.unpaid_hold_days)
        where id = v_seat.id
        returning * into v_seat;
        v_event := 'hold_extended';
      end if;
    end if;

  elsif v_seat.status = 'released' then
    if v_paid > 0 then
      -- RED DE SEGURIDAD, no camino normal: un lugar solo se libera si Mercado Pago ya no puede cobrarlo (sin
      -- preapproval vigente o suscripción cancelada, que es terminal), así que un pago aprobado sobre un lugar
      -- liberado solo puede venir de un error operativo (liberación manual o estado de proveedor equivocado).
      -- Si pasa, se recupera solo si hay un número libre y la persona no ocupa otro lugar. Nunca se supera la
      -- capacidad; si no se puede, queda marcado 'late_payment_no_seat' para resolución manual.
      v_number := null;
      if v_seat.user_id is not null
         and not exists (
           select 1 from public.pioneer_members o
           where o.user_id = v_seat.user_id and o.status in ('reserved', 'active') and o.id <> v_seat.id
         ) then
        if not exists (
          select 1 from public.pioneer_members o where o.pioneer_number = v_seat.pioneer_number and o.status in ('reserved', 'active')
        ) then
          v_number := v_seat.pioneer_number;
        else
          select min(g) into v_number
          from generate_series(1, v_ed.capacity) g
          where not exists (
            select 1 from public.pioneer_members o where o.pioneer_number = g and o.status in ('reserved', 'active')
          );
        end if;
      end if;

      if v_number is not null then
        update public.pioneer_members
        set status = 'active',
            pioneer_number = v_number,
            confirmed_at = v_now,
            first_payment_id = v_first,
            cycles_paid = v_paid,
            released_at = null,
            release_reason = null,
            reservation_expires_at = null,
            step_up_status = case when v_paid >= locked_cycles then 'due' else step_up_status end
        where id = v_seat.id
        returning * into v_seat;
        perform public._pioneer_log(v_seat.id, 'late_reactivated', jsonb_build_object('pioneer_number', v_number, 'first_payment_id', v_first));
        v_event := 'late_reactivated';
      else
        v_event := 'no_seat_available';
        if v_seat.release_reason is distinct from 'late_payment_no_seat' then
          update public.pioneer_members set release_reason = 'late_payment_no_seat' where id = v_seat.id returning * into v_seat;
          perform public._pioneer_log(v_seat.id, 'late_payment_no_seat', jsonb_build_object('paid', v_paid));
        end if;
      end if;
    end if;

  elsif v_seat.status = 'active' then
    v_cycles := greatest(v_seat.cycles_paid, v_paid);
    v_step := v_seat.step_up_status;
    if v_step = 'not_due' and v_seat.benefits_ended_at is null and v_cycles >= v_seat.locked_cycles then
      v_step := 'due';
    end if;

    if v_cycles <> v_seat.cycles_paid or v_step <> v_seat.step_up_status then
      update public.pioneer_members set cycles_paid = v_cycles, step_up_status = v_step where id = v_seat.id returning * into v_seat;
      perform public._pioneer_log(v_seat.id, 'cycles_updated', jsonb_build_object('cycles_paid', v_cycles, 'step_up_status', v_step));
      v_event := 'cycles_updated';
    end if;

    -- Cancelar pierde el beneficio promocional y el acceso anticipado; el lugar y la insignia no se pierden.
    if v_provider = 'cancelled' and v_seat.benefits_ended_at is null then
      update public.pioneer_members
      set benefits_ended_at = v_now,
          benefits_end_reason = 'cancelled',
          step_up_status = 'void'
      where id = v_seat.id
      returning * into v_seat;
      perform public._pioneer_log(v_seat.id, 'benefits_ended', jsonb_build_object('reason', 'cancelled'));
      v_event := 'benefits_ended';
    end if;
  end if;

  return jsonb_build_object(
    'status', v_seat.status,
    'event', v_event,
    'seat_id', v_seat.id,
    'pioneer_number', v_seat.pioneer_number,
    'cycles_paid', v_seat.cycles_paid,
    'step_up_status', v_seat.step_up_status,
    'benefits_ended', v_seat.benefits_ended_at is not null,
    'approved_other_amount', v_other_amount
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- release_pioneer_seat: libera un lugar RESERVADO (checkout fallido, abandonado o cancelado en MP). Nunca libera un
-- lugar activo ni uno con pago verificado.
-- ---------------------------------------------------------------------------

create or replace function public.release_pioneer_seat(p_seat_id uuid, p_reason text, p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seat public.pioneer_members%rowtype;
begin
  if p_reason is null or p_reason !~ '^[a-z_]{3,40}$' then
    raise exception 'release reason must be a short snake_case code';
  end if;

  perform public._pioneer_lock();

  select * into v_seat from public.pioneer_members where id = p_seat_id for update;
  if not found or (p_user_id is not null and v_seat.user_id is distinct from p_user_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_seat.status <> 'reserved' then
    return jsonb_build_object('status', 'not_releasable', 'seat_status', v_seat.status);
  end if;

  if exists (select 1 from public._pioneer_qualifying_payments(v_seat.id)) then
    return jsonb_build_object('status', 'paid');
  end if;

  -- Nunca se libera un lugar cuya suscripción Mercado Pago todavía podría cobrar: primero hay que cancelarla en MP y
  -- sincronizar con estado 'cancelled' (sync_pioneer_seat), o dejar que MP la cobre y se confirme.
  if public._pioneer_seat_chargeable(v_seat.id) then
    return jsonb_build_object('status', 'chargeable');
  end if;

  update public.pioneer_members
  set status = 'released', released_at = now(), release_reason = p_reason
  where id = v_seat.id;
  perform public._pioneer_log(v_seat.id, 'released', jsonb_build_object('reason', p_reason));

  return jsonb_build_object('status', 'released', 'pioneer_number', v_seat.pioneer_number);
end;
$$;

-- release_expired_pioneer_holds: para el job periódico. 'released' = vencidas sin pago y sin posibilidad de cobro
-- (ya liberadas). 'needs_provider_check' = vencidas que MP todavía podría cobrar: SIGUEN ocupando su número; el
-- servidor debe consultar su estado en Mercado Pago y, según corresponda:
--   pending    -> cancelarla en MP y luego sync_pioneer_seat(preapproval, 'cancelled') (libera);
--   authorized -> dejarla: sync_pioneer_seat(preapproval, 'authorized') extiende la retención y MP puede cobrar;
--   cancelled  -> sync_pioneer_seat(preapproval, 'cancelled') (libera).
create or replace function public.release_expired_pioneer_holds()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_released jsonb;
  v_pending jsonb;
begin
  perform public._pioneer_lock();
  v_released := public._pioneer_sweep_expired();

  select coalesce(jsonb_agg(jsonb_build_object(
    'seat_id', m.id,
    'preapproval_id', coalesce(m.mercado_pago_preapproval_id, a.mercado_pago_preapproval_id),
    'attempt_state', a.state,
    'local_subscription_status', (
      select s.status from public.subscriptions s
      where s.mercado_pago_preapproval_id = coalesce(m.mercado_pago_preapproval_id, a.mercado_pago_preapproval_id)
      limit 1
    )
  ) order by m.pioneer_number), '[]'::jsonb)
  into v_pending
  from public.pioneer_members m
  left join public.checkout_attempts a on a.id = m.checkout_attempt_id
  where m.status = 'reserved'
    and m.reservation_expires_at <= now()
    and not exists (select 1 from public._pioneer_qualifying_payments(m.id));

  return jsonb_build_object('released', v_released, 'needs_provider_check', v_pending);
end;
$$;

-- pioneer_early_access_features: funcionalidades de acceso anticipado de una persona. Vacía salvo lugar ACTIVO con
-- beneficios vigentes (no cancelado). La membresía Premium vigente la valida el servidor aparte.
create or replace function public.pioneer_early_access_features(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select e.early_access_features
     from public.pioneer_members m
     cross join public.pioneer_edition e
     where m.user_id = p_user_id and m.status = 'active' and m.benefits_ended_at is null and e.id = 'default'),
    '{}'::text[]
  )
$$;

-- ---------------------------------------------------------------------------
-- Privilegios de funciones: service_role únicamente. Las internas (_pioneer_*) no se exponen a nadie.
-- ---------------------------------------------------------------------------

revoke all on function public._pioneer_lock() from public, anon, authenticated, service_role;
revoke all on function public._pioneer_log(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public._pioneer_qualifying_payments(uuid) from public, anon, authenticated, service_role;
revoke all on function public._pioneer_seat_chargeable(uuid) from public, anon, authenticated, service_role;
revoke all on function public._pioneer_sweep_expired() from public, anon, authenticated, service_role;

revoke all on function public.pioneer_offer_state() from public, anon, authenticated;
revoke all on function public.reserve_pioneer_seat(uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.attach_pioneer_seat(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.sync_pioneer_seat(text, text) from public, anon, authenticated;
revoke all on function public.release_pioneer_seat(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.release_expired_pioneer_holds() from public, anon, authenticated;
revoke all on function public.pioneer_early_access_features(uuid) from public, anon, authenticated;

grant execute on function public.pioneer_offer_state() to service_role;
grant execute on function public.reserve_pioneer_seat(uuid, numeric, text, text) to service_role;
grant execute on function public.attach_pioneer_seat(uuid, uuid, uuid) to service_role;
grant execute on function public.sync_pioneer_seat(text, text) to service_role;
grant execute on function public.release_pioneer_seat(uuid, text, uuid) to service_role;
grant execute on function public.release_expired_pioneer_holds() to service_role;
grant execute on function public.pioneer_early_access_features(uuid) to service_role;

notify pgrst, 'reload schema';
