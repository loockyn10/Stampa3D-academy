-- XP V1: auditable ledger, transactional summary, levels and safe event hooks.
-- Raffle advantages are intentionally schema-ready but remain disabled in code.

do $xp_dependencies$
begin
  if to_regclass('public.profiles') is null then raise exception 'Missing dependency: public.profiles'; end if;
  if to_regclass('public.lesson_progress') is null then raise exception 'Missing dependency: public.lesson_progress'; end if;
  if to_regclass('public.printers') is null then raise exception 'Missing dependency: public.printers'; end if;
  if to_regclass('public.filaments') is null then raise exception 'Missing dependency: public.filaments'; end if;
  if to_regclass('public.products') is null then raise exception 'Missing dependency: public.products'; end if;
  if to_regclass('public.product_stock_movements') is null then raise exception 'Missing dependency: public.product_stock_movements'; end if;
  if to_regclass('public.business_sales') is null then raise exception 'Missing dependency: public.business_sales'; end if;
  if to_regclass('public.business_inventory_movements') is null then raise exception 'Missing dependency: public.business_inventory_movements'; end if;
  if to_regclass('public.business_inventory_transfers') is null then raise exception 'Missing dependency: public.business_inventory_transfers'; end if;
  if to_regclass('public.raffles') is null then raise exception 'Missing dependency: public.raffles'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if to_regprocedure('public.is_admin(uuid)') is null then raise exception 'Missing dependency: public.is_admin(uuid)'; end if;
  if to_regprocedure('public.consume_filaments_for_production_targets(jsonb,jsonb,text,boolean)') is null then
    raise exception 'Missing dependency: public.consume_filaments_for_production_targets(jsonb, jsonb, text, boolean)';
  end if;
end;
$xp_dependencies$;

create table if not exists public.user_xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  category text not null,
  source_entity_type text,
  source_entity_id uuid,
  event_key text not null,
  xp_awarded integer not null,
  logical_day date not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint user_xp_events_type_check check (event_type in (
    'class_completed', 'calculator_used', 'production_registered',
    'sale_completed', 'replenishment_completed', 'stock_adjusted',
    'first_printer', 'first_filament', 'first_product',
    'first_production', 'first_sale', 'launch_academy_history'
  )),
  constraint user_xp_events_category_check check (category in (
    'academy', 'tools', 'workshop', 'business', 'onboarding'
  )),
  constraint user_xp_events_key_check check (char_length(btrim(event_key)) between 3 and 240),
  constraint user_xp_events_xp_check check (xp_awarded between 0 and 1000),
  constraint user_xp_events_source_check check (
    (source_entity_type is null and source_entity_id is null)
    or (source_entity_type is not null and source_entity_id is not null)
  ),
  constraint user_xp_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.user_xp_summary (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_xp integer not null default 0,
  level integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint user_xp_summary_total_check check (total_xp >= 0),
  constraint user_xp_summary_level_check check (level >= 1)
);

create unique index if not exists user_xp_events_user_key_uidx
  on public.user_xp_events (user_id, event_key);
create index if not exists user_xp_events_user_created_idx
  on public.user_xp_events (user_id, created_at desc);
create index if not exists user_xp_events_user_type_day_idx
  on public.user_xp_events (user_id, event_type, logical_day, created_at desc);
create index if not exists user_xp_events_category_created_idx
  on public.user_xp_events (category, created_at desc);
create index if not exists user_xp_events_source_idx
  on public.user_xp_events (source_entity_type, source_entity_id)
  where source_entity_id is not null;
create index if not exists user_xp_summary_level_idx
  on public.user_xp_summary (level, total_xp desc);

-- Keep a partially executed migration fail-closed. Supabase projects may have
-- default table grants, while the policies are intentionally created near the
-- end after every dependency has been defined.
alter table public.user_xp_events enable row level security;
alter table public.user_xp_summary enable row level security;
revoke all on table public.user_xp_events from anon, authenticated;
revoke all on table public.user_xp_summary from anon, authenticated;

alter table public.raffles add column if not exists minimum_level integer;
do $xp_raffle_constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.raffles'::regclass
      and conname = 'raffles_minimum_level_check'
  ) then
    alter table public.raffles
      add constraint raffles_minimum_level_check
      check (minimum_level is null or minimum_level >= 1);
  end if;
end;
$xp_raffle_constraint$;

create or replace function public.xp_threshold_for_level(p_level integer)
returns bigint
language sql
immutable
strict
set search_path = ''
as $xp_threshold$
  select
    10::bigint * greatest(0, p_level - 1)::bigint * greatest(0, p_level - 1)::bigint
    + 90::bigint * greatest(0, p_level - 1)::bigint;
$xp_threshold$;

create or replace function public.xp_level_for_total(p_total_xp integer)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $xp_level$
declare
  safe_total integer := greatest(0, p_total_xp);
  result_level integer;
begin
  result_level := greatest(1, floor(
    (sqrt(8100::numeric + (40::numeric * safe_total)) - 90::numeric) / 20::numeric
  )::integer + 1);
  while public.xp_threshold_for_level(result_level + 1) <= safe_total loop
    result_level := result_level + 1;
  end loop;
  while result_level > 1 and public.xp_threshold_for_level(result_level) > safe_total loop
    result_level := result_level - 1;
  end loop;
  return result_level;
end;
$xp_level$;

create or replace function public.award_user_xp(
  p_user_id uuid,
  p_event_type text,
  p_source_entity_type text,
  p_source_entity_id uuid,
  p_event_key text,
  p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  awarded boolean,
  event_id uuid,
  xp_awarded integer,
  total_xp integer,
  old_level integer,
  new_level integer,
  reason text,
  label text
)
language plpgsql
security definer
set search_path = ''
as $award_user_xp$
declare
  configured_xp integer;
  configured_daily_limit integer;
  configured_lifetime_limit integer;
  configured_category text;
  configured_label text;
  event_day date := (coalesce(p_occurred_at, now()) at time zone 'America/Argentina/Buenos_Aires')::date;
  current_total integer;
  current_level integer;
  resulting_total integer;
  resulting_level integer;
  resulting_xp integer;
  resulting_reason text := 'awarded';
  existing_event public.user_xp_events%rowtype;
  inserted_event_id uuid;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = '22023', message = 'XP user is invalid';
  end if;
  if p_event_key is null or char_length(btrim(p_event_key)) not between 3 and 240 then
    raise exception using errcode = '22023', message = 'XP event key is invalid';
  end if;
  if (p_source_entity_type is null) <> (p_source_entity_id is null) then
    raise exception using errcode = '22023', message = 'XP source identity is incomplete';
  end if;

  select rule.category, rule.xp, rule.daily_limit, rule.lifetime_limit, rule.label
  into configured_category, configured_xp, configured_daily_limit, configured_lifetime_limit, configured_label
  from (values
    ('class_completed', 'academy', 10, 2, null::integer, 'Clase completada'),
    ('calculator_used', 'tools', 5, 1, null::integer, 'Cálculo válido'),
    ('production_registered', 'workshop', 10, 1, null::integer, 'Producción registrada'),
    ('sale_completed', 'business', 10, 1, null::integer, 'Venta confirmada'),
    ('replenishment_completed', 'business', 5, 1, null::integer, 'Reposición completada'),
    ('stock_adjusted', 'business', 5, 1, null::integer, 'Stock actualizado'),
    ('first_printer', 'onboarding', 20, null::integer, 1, 'Primera impresora'),
    ('first_filament', 'onboarding', 15, null::integer, 1, 'Primer filamento'),
    ('first_product', 'onboarding', 25, null::integer, 1, 'Primer producto'),
    ('first_production', 'onboarding', 25, null::integer, 1, 'Primera producción'),
    ('first_sale', 'onboarding', 25, null::integer, 1, 'Primera venta')
  ) as rule(event_type, category, xp, daily_limit, lifetime_limit, label)
  where rule.event_type = p_event_type;

  if configured_xp is null then
    raise exception using errcode = '22023', message = 'XP event type is not awardable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stampa-xp:' || p_user_id::text, 0)
  );

  insert into public.user_xp_summary (user_id, total_xp, level)
  values (p_user_id, 0, 1)
  on conflict (user_id) do nothing;

  select summary.total_xp, summary.level
  into current_total, current_level
  from public.user_xp_summary as summary
  where summary.user_id = p_user_id
  for update;

  select event.* into existing_event
  from public.user_xp_events as event
  where event.user_id = p_user_id and event.event_key = btrim(p_event_key);
  if found then
    return query select false, existing_event.id, 0, current_total, current_level, current_level,
      'duplicate'::text, configured_label;
    return;
  end if;

  resulting_xp := configured_xp;
  if configured_daily_limit is not null and (
    select count(*) from public.user_xp_events as daily_event
    where daily_event.user_id = p_user_id
      and daily_event.event_type = p_event_type
      and daily_event.logical_day = event_day
      and daily_event.xp_awarded > 0
  ) >= configured_daily_limit then
    resulting_xp := 0;
    resulting_reason := 'daily_limit';
  end if;
  if configured_lifetime_limit is not null and (
    select count(*) from public.user_xp_events as lifetime_event
    where lifetime_event.user_id = p_user_id
      and lifetime_event.event_type = p_event_type
      and lifetime_event.xp_awarded > 0
  ) >= configured_lifetime_limit then
    resulting_xp := 0;
    resulting_reason := 'lifetime_limit';
  end if;

  resulting_total := current_total + resulting_xp;
  resulting_level := public.xp_level_for_total(resulting_total);

  insert into public.user_xp_events (
    user_id, event_type, category, source_entity_type, source_entity_id,
    event_key, xp_awarded, logical_day, metadata, created_at
  ) values (
    p_user_id, p_event_type, configured_category, p_source_entity_type, p_source_entity_id,
    btrim(p_event_key), resulting_xp, event_day,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'label', configured_label,
      'awardReason', resulting_reason,
      'oldLevel', current_level,
      'newLevel', resulting_level,
      'newTotalXp', resulting_total
    ),
    coalesce(p_occurred_at, now())
  ) returning id into inserted_event_id;

  if resulting_xp > 0 then
    update public.user_xp_summary
    set total_xp = resulting_total, level = resulting_level, updated_at = now()
    where user_id = p_user_id;
  end if;

  return query select resulting_xp > 0, inserted_event_id, resulting_xp,
    resulting_total, current_level, resulting_level, resulting_reason, configured_label;
end;
$award_user_xp$;

-- This is an internal engine. Revoke immediately so a statement-by-statement
-- runner cannot leave it publicly executable if a later backfill fails.
revoke all on function public.award_user_xp(uuid,text,text,uuid,text,timestamptz,jsonb)
from public, anon, authenticated;

create or replace function public.record_calculator_xp(
  p_operation_key uuid,
  p_total_grams numeric,
  p_duration_minutes integer,
  p_base_cost numeric,
  p_sale_price numeric
)
returns table (
  awarded boolean,
  xp_awarded integer,
  total_xp integer,
  old_level integer,
  new_level integer,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $record_calculator_xp$
declare
  current_user_id uuid := auth.uid();
  event_day date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  award_result record;
begin
  if current_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if public.has_platform_access(current_user_id) is distinct from true then raise exception using errcode = '42501', message = 'Platform access required'; end if;
  if p_operation_key is null or p_total_grams is null or p_total_grams <= 0
     or p_total_grams > 10000000
     or p_duration_minutes is null or p_duration_minutes < 0
     or p_duration_minutes > 525600
     or p_base_cost is null or p_base_cost <= 0
     or p_base_cost > 1000000000000
     or p_sale_price is null or p_sale_price <= 0
     or p_sale_price > 1000000000000 then
    raise exception using errcode = '22023', message = 'The calculation is not meaningful';
  end if;

  select * into award_result from public.award_user_xp(
    current_user_id,
    'calculator_used',
    'calculator_run',
    p_operation_key,
    'calculator_used:' || event_day::text,
    now(),
    jsonb_build_object(
      'totalGrams', round(p_total_grams, 2),
      'durationMinutes', p_duration_minutes,
      'baseCost', round(p_base_cost, 2),
      'salePrice', round(p_sale_price, 2)
    )
  );
  return query select award_result.awarded, award_result.xp_awarded,
    award_result.total_xp, award_result.old_level, award_result.new_level, award_result.reason;
end;
$record_calculator_xp$;

create or replace function public.record_production_with_xp(
  p_operation_key uuid,
  p_product_items jsonb default '[]'::jsonb,
  p_component_items jsonb default '[]'::jsonb,
  p_reason text default 'Producción registrada desde stock',
  p_add_to_stock boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $record_production_with_xp$
declare
  current_user_id uuid := auth.uid();
  operation_event_key text;
  production_result jsonb;
  activity_award record;
  milestone_award record;
begin
  if current_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if public.has_platform_access(current_user_id) is distinct from true then raise exception using errcode = '42501', message = 'Platform access required'; end if;
  if p_operation_key is null then raise exception using errcode = '22023', message = 'Production operation key is required'; end if;

  operation_event_key := 'production_registered:' || p_operation_key::text;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stampa-production-xp:' || current_user_id::text || ':' || p_operation_key::text, 0)
  );
  if exists (
    select 1 from public.user_xp_events
    where user_id = current_user_id and event_key = operation_event_key
  ) then
    return jsonb_build_object('success', true, 'replayed', true, 'xpAwarded', 0);
  end if;

  production_result := public.consume_filaments_for_production_targets(
    p_product_items, p_component_items, p_reason, p_add_to_stock
  );
  if coalesce((production_result ->> 'success')::boolean, false) is distinct from true then
    return production_result;
  end if;

  select * into activity_award from public.award_user_xp(
    current_user_id, 'production_registered', 'production_operation', p_operation_key,
    operation_event_key, now(), jsonb_build_object('addToStock', p_add_to_stock)
  );
  select * into milestone_award from public.award_user_xp(
    current_user_id, 'first_production', 'production_operation', p_operation_key,
    'milestone:first_production', now(), '{}'::jsonb
  );

  return production_result || jsonb_build_object(
    'replayed', false,
    'xpAwarded', coalesce(activity_award.xp_awarded, 0) + coalesce(milestone_award.xp_awarded, 0),
    'newTotalXp', greatest(coalesce(activity_award.total_xp, 0), coalesce(milestone_award.total_xp, 0)),
    'newLevel', greatest(coalesce(activity_award.new_level, 1), coalesce(milestone_award.new_level, 1))
  );
end;
$record_production_with_xp$;

create or replace function public.xp_on_lesson_progress_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $xp_lesson_trigger$
begin
  perform 1 from public.award_user_xp(
    new.user_id, 'class_completed', 'lesson', new.lesson_id,
    'class_completed:' || new.lesson_id::text,
    coalesce(new.completed_at, now()), '{}'::jsonb
  );
  return new;
end;
$xp_lesson_trigger$;

create or replace function public.xp_on_printer_insert()
returns trigger language plpgsql security definer set search_path = '' as $xp_printer_trigger$
begin
  if new.is_active is distinct from false then
    perform 1 from public.award_user_xp(new.user_id, 'first_printer', 'printer', new.id, 'milestone:first_printer', new.created_at, '{}'::jsonb);
  end if;
  return new;
end;
$xp_printer_trigger$;

create or replace function public.xp_on_filament_insert()
returns trigger language plpgsql security definer set search_path = '' as $xp_filament_trigger$
begin
  if new.is_active is distinct from false then
    perform 1 from public.award_user_xp(new.user_id, 'first_filament', 'filament', new.id, 'milestone:first_filament', new.created_at, '{}'::jsonb);
  end if;
  return new;
end;
$xp_filament_trigger$;

create or replace function public.xp_on_product_insert()
returns trigger language plpgsql security definer set search_path = '' as $xp_product_trigger$
begin
  if new.is_active is distinct from false then
    perform 1 from public.award_user_xp(new.user_id, 'first_product', 'product', new.id, 'milestone:first_product', new.created_at, '{}'::jsonb);
  end if;
  return new;
end;
$xp_product_trigger$;

create or replace function public.xp_on_business_sale_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $xp_sale_trigger$
begin
  if new.status <> 'completed' then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  perform 1 from public.award_user_xp(new.user_id, 'sale_completed', 'business_sale', new.id, 'sale_completed:' || new.id::text, new.created_at, '{}'::jsonb);
  perform 1 from public.award_user_xp(new.user_id, 'first_sale', 'business_sale', new.id, 'milestone:first_sale', new.created_at, '{}'::jsonb);
  return new;
end;
$xp_sale_trigger$;

create or replace function public.xp_on_business_replenishment()
returns trigger language plpgsql security definer set search_path = '' as $xp_replenishment_trigger$
begin
  perform 1 from public.award_user_xp(
    new.user_id, 'replenishment_completed', 'business_inventory_transfer', new.id,
    'replenishment_completed:' || new.operation_key::text, new.created_at, '{}'::jsonb
  );
  return new;
end;
$xp_replenishment_trigger$;

create or replace function public.xp_on_business_stock_movement()
returns trigger language plpgsql security definer set search_path = '' as $xp_stock_trigger$
begin
  if new.movement_type in ('restock', 'manual_adjustment') then
    perform 1 from public.award_user_xp(
      new.user_id, 'stock_adjusted', 'business_inventory_movement', new.id,
      'stock_adjusted:' || new.operation_key::text, new.created_at,
      jsonb_build_object('movementType', new.movement_type)
    );
  end if;
  return new;
end;
$xp_stock_trigger$;

-- Existing accounts receive a capped, auditable launch bonus. The fixed cutoff
-- keeps this idempotent even if the migration is reviewed/applied again later.
insert into public.user_xp_events (user_id, event_type, category, source_entity_type, source_entity_id, event_key, xp_awarded, logical_day, metadata)
select distinct on (printer.user_id)
  printer.user_id, 'first_printer', 'onboarding', 'printer', printer.id,
  'milestone:first_printer', 20, date '2026-09-09',
  jsonb_build_object('label', 'Primera impresora', 'awardReason', 'launch_backfill')
from public.printers printer
join public.profiles profile on profile.id = printer.user_id
where profile.created_at < timestamptz '2026-09-09 14:52:59-03'
order by printer.user_id, printer.created_at, printer.id
on conflict (user_id, event_key) do nothing;

insert into public.user_xp_events (user_id, event_type, category, source_entity_type, source_entity_id, event_key, xp_awarded, logical_day, metadata)
select distinct on (filament.user_id)
  filament.user_id, 'first_filament', 'onboarding', 'filament', filament.id,
  'milestone:first_filament', 15, date '2026-09-09',
  jsonb_build_object('label', 'Primer filamento', 'awardReason', 'launch_backfill')
from public.filaments filament
join public.profiles profile on profile.id = filament.user_id
where profile.created_at < timestamptz '2026-09-09 14:52:59-03'
order by filament.user_id, filament.created_at, filament.id
on conflict (user_id, event_key) do nothing;

insert into public.user_xp_events (user_id, event_type, category, source_entity_type, source_entity_id, event_key, xp_awarded, logical_day, metadata)
select distinct on (product.user_id)
  product.user_id, 'first_product', 'onboarding', 'product', product.id,
  'milestone:first_product', 25, date '2026-09-09',
  jsonb_build_object('label', 'Primer producto', 'awardReason', 'launch_backfill')
from public.products product
join public.profiles profile on profile.id = product.user_id
where profile.created_at < timestamptz '2026-09-09 14:52:59-03'
order by product.user_id, product.created_at, product.id
on conflict (user_id, event_key) do nothing;

insert into public.user_xp_events (user_id, event_type, category, source_entity_type, source_entity_id, event_key, xp_awarded, logical_day, metadata)
select distinct on (sale.user_id)
  sale.user_id, 'first_sale', 'onboarding', 'business_sale', sale.id,
  'milestone:first_sale', 25, date '2026-09-09',
  jsonb_build_object('label', 'Primera venta', 'awardReason', 'launch_backfill')
from public.business_sales sale
join public.profiles profile on profile.id = sale.user_id
where profile.created_at < timestamptz '2026-09-09 14:52:59-03' and sale.status = 'completed'
order by sale.user_id, sale.created_at, sale.id
on conflict (user_id, event_key) do nothing;

insert into public.user_xp_events (user_id, event_type, category, source_entity_type, source_entity_id, event_key, xp_awarded, logical_day, metadata)
select distinct on (movement.user_id)
  movement.user_id, 'first_production', 'onboarding', 'product_stock_movement', movement.id,
  'milestone:first_production', 25, date '2026-09-09',
  jsonb_build_object('label', 'Primera producción', 'awardReason', 'launch_backfill')
from public.product_stock_movements movement
join public.profiles profile on profile.id = movement.user_id
where profile.created_at < timestamptz '2026-09-09 14:52:59-03'
  -- product_stock_movements predates the versioned schema and has existed with
  -- both `type` and `movement_type`. JSON access keeps the launch backfill
  -- compatible without assuming that either optional column exists.
  and coalesce(
    nullif(to_jsonb(movement) ->> 'quantity', '')::numeric,
    nullif(to_jsonb(movement) ->> 'quantity_delta', '')::numeric,
    0
  ) > 0
  and (
    coalesce(to_jsonb(movement) ->> 'reason', '') ilike '%producci%'
    or lower(coalesce(to_jsonb(movement) ->> 'source_type', '')) in ('production', 'product_production')
  )
  and coalesce(
    lower(nullif(to_jsonb(movement) ->> 'movement_type', '')),
    lower(nullif(to_jsonb(movement) ->> 'type', '')),
    'add'
  ) in ('add', 'manual_add', 'production')
order by movement.user_id,
  coalesce(
    nullif(to_jsonb(movement) ->> 'created_at', '')::timestamptz,
    timestamptz '2026-09-09 14:52:59-03'
  ),
  movement.id
on conflict (user_id, event_key) do nothing;

-- Historical lessons are marked with zero-XP per-entity entries so toggling an
-- old completion cannot farm XP. A separate launch event grants at most 20 XP.
insert into public.user_xp_events (user_id, event_type, category, source_entity_type, source_entity_id, event_key, xp_awarded, logical_day, metadata, created_at)
select progress.user_id, 'class_completed', 'academy', 'lesson', progress.lesson_id,
  'class_completed:' || progress.lesson_id::text, 0,
  (coalesce(progress.completed_at, timestamptz '2026-09-09 14:52:59-03') at time zone 'America/Argentina/Buenos_Aires')::date,
  jsonb_build_object('label', 'Clase completada', 'awardReason', 'historical_marker'),
  coalesce(progress.completed_at, timestamptz '2026-09-09 14:52:59-03')
from public.lesson_progress progress
join public.profiles profile on profile.id = progress.user_id
where profile.created_at < timestamptz '2026-09-09 14:52:59-03'
on conflict (user_id, event_key) do nothing;

insert into public.user_xp_events (user_id, event_type, category, event_key, xp_awarded, logical_day, metadata)
select progress.user_id, 'launch_academy_history', 'onboarding', 'launch:academy_history',
  least(count(*)::integer, 2) * 10, date '2026-09-09',
  jsonb_build_object('label', 'Progreso previo en Academia', 'awardReason', 'launch_backfill', 'completedLessons', count(*))
from public.lesson_progress progress
join public.profiles profile on profile.id = progress.user_id
where profile.created_at < timestamptz '2026-09-09 14:52:59-03'
group by progress.user_id
on conflict (user_id, event_key) do nothing;

insert into public.user_xp_summary (user_id, total_xp, level, updated_at)
select profile.id, coalesce(sum(event.xp_awarded), 0)::integer,
  public.xp_level_for_total(coalesce(sum(event.xp_awarded), 0)::integer), now()
from public.profiles profile
left join public.user_xp_events event on event.user_id = profile.id
group by profile.id
on conflict (user_id) do update
set total_xp = excluded.total_xp, level = excluded.level, updated_at = excluded.updated_at;

drop trigger if exists lesson_progress_award_xp on public.lesson_progress;
create trigger lesson_progress_award_xp after insert on public.lesson_progress
for each row execute function public.xp_on_lesson_progress_insert();
drop trigger if exists printers_award_first_xp on public.printers;
create trigger printers_award_first_xp after insert on public.printers
for each row execute function public.xp_on_printer_insert();
drop trigger if exists filaments_award_first_xp on public.filaments;
create trigger filaments_award_first_xp after insert on public.filaments
for each row execute function public.xp_on_filament_insert();
drop trigger if exists products_award_first_xp on public.products;
create trigger products_award_first_xp after insert on public.products
for each row execute function public.xp_on_product_insert();
drop trigger if exists business_sales_award_xp on public.business_sales;
create trigger business_sales_award_xp after insert or update of status on public.business_sales
for each row execute function public.xp_on_business_sale_completed();
drop trigger if exists business_replenishment_award_xp on public.business_inventory_transfers;
create trigger business_replenishment_award_xp after insert on public.business_inventory_transfers
for each row execute function public.xp_on_business_replenishment();
drop trigger if exists business_stock_movement_award_xp on public.business_inventory_movements;
create trigger business_stock_movement_award_xp after insert on public.business_inventory_movements
for each row execute function public.xp_on_business_stock_movement();

alter table public.user_xp_events enable row level security;
alter table public.user_xp_summary enable row level security;

drop policy if exists user_xp_events_select_own on public.user_xp_events;
create policy user_xp_events_select_own on public.user_xp_events
for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));
drop policy if exists user_xp_events_admin_select on public.user_xp_events;
create policy user_xp_events_admin_select on public.user_xp_events
for select to authenticated using (public.is_admin(auth.uid()));

drop policy if exists user_xp_summary_select_own on public.user_xp_summary;
create policy user_xp_summary_select_own on public.user_xp_summary
for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));
drop policy if exists user_xp_summary_admin_select on public.user_xp_summary;
create policy user_xp_summary_admin_select on public.user_xp_summary
for select to authenticated using (public.is_admin(auth.uid()));

revoke all on table public.user_xp_events from anon, authenticated;
revoke all on table public.user_xp_summary from anon, authenticated;
grant select on table public.user_xp_events to authenticated;
grant select on table public.user_xp_summary to authenticated;

revoke all on function public.award_user_xp(uuid,text,text,uuid,text,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.xp_on_lesson_progress_insert() from public, anon, authenticated;
revoke all on function public.xp_on_printer_insert() from public, anon, authenticated;
revoke all on function public.xp_on_filament_insert() from public, anon, authenticated;
revoke all on function public.xp_on_product_insert() from public, anon, authenticated;
revoke all on function public.xp_on_business_sale_completed() from public, anon, authenticated;
revoke all on function public.xp_on_business_replenishment() from public, anon, authenticated;
revoke all on function public.xp_on_business_stock_movement() from public, anon, authenticated;

revoke all on function public.record_calculator_xp(uuid,numeric,integer,numeric,numeric) from public, anon;
grant execute on function public.record_calculator_xp(uuid,numeric,integer,numeric,numeric) to authenticated;
revoke all on function public.record_production_with_xp(uuid,jsonb,jsonb,text,boolean) from public, anon;
grant execute on function public.record_production_with_xp(uuid,jsonb,jsonb,text,boolean) to authenticated;
revoke all on function public.xp_threshold_for_level(integer) from public, anon;
revoke all on function public.xp_level_for_total(integer) from public, anon;
grant execute on function public.xp_threshold_for_level(integer) to authenticated;
grant execute on function public.xp_level_for_total(integer) to authenticated;

do $xp_realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'user_xp_events'
     ) then
    execute 'alter publication supabase_realtime add table public.user_xp_events';
  end if;
end;
$xp_realtime$;

notify pgrst, 'reload schema';
