-- Sprint 4/4: e-commerce base, provider-neutral orders and Mercado Pago marketplace.
-- Apply after 20260907213952_business_storefront.sql. This migration does not
-- enable production payments and does not execute any external provider call.

-- DDL should fail fast instead of waiting indefinitely behind application traffic.
-- This does not replace the stable lock order used below.
set lock_timeout = '10s';

do $$
begin
  if to_regclass('public.business_storefronts') is null then raise exception 'Missing dependency: public.business_storefronts'; end if;
  if to_regclass('public.business_catalog_items') is null then raise exception 'Missing dependency: public.business_catalog_items'; end if;
  if to_regclass('public.business_sales') is null then raise exception 'Missing dependency: public.business_sales'; end if;
  if to_regclass('public.business_sale_items') is null then raise exception 'Missing dependency: public.business_sale_items'; end if;
  if to_regclass('public.business_inventory_movements') is null then raise exception 'Missing dependency: public.business_inventory_movements'; end if;
  if to_regclass('public.products') is null then raise exception 'Missing dependency: public.products'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if to_regprocedure('public.is_admin(uuid)') is null then raise exception 'Missing dependency: public.is_admin(uuid)'; end if;
  if to_regprocedure('public.set_updated_at()') is null then raise exception 'Missing dependency: public.set_updated_at()'; end if;
  if to_regprocedure('public.adjust_product_stock(uuid,integer,text,text,text,uuid)') is null then
    raise exception 'Missing dependency: public.adjust_product_stock(uuid, integer, text, text, text, uuid)';
  end if;
end
$$;

create table if not exists public.business_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  provider text not null default 'mercado_pago',
  provider_user_id text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  public_key text,
  scope text,
  live_mode boolean not null default false,
  status text not null default 'disconnected',
  token_expires_at timestamptz,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_payment_accounts_provider_check check (provider = 'mercado_pago'),
  constraint business_payment_accounts_status_check check (status in ('connected', 'disconnected', 'error')),
  constraint business_payment_accounts_connected_check check (
    status <> 'connected' or (
      provider_user_id is not null and access_token_encrypted is not null
      and refresh_token_encrypted is not null and token_expires_at is not null
    )
  )
);

create table if not exists public.business_payment_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null default 'mercado_pago',
  state_hash text not null unique,
  code_verifier_encrypted text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint business_payment_oauth_states_provider_check check (provider = 'mercado_pago'),
  constraint business_payment_oauth_states_hash_check check (state_hash ~ '^[a-f0-9]{64}$'),
  constraint business_payment_oauth_states_expiry_check check (expires_at > created_at)
);

create table if not exists public.business_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  order_number bigint not null,
  public_token uuid not null default gen_random_uuid(),
  status text not null default 'awaiting_payment',
  payment_status text not null default 'pending',
  currency text not null default 'ARS',
  subtotal numeric(14,2) not null,
  total numeric(14,2) not null,
  marketplace_fee_amount numeric(14,2) not null default 0,
  buyer_name text not null,
  buyer_email text not null,
  buyer_phone text,
  delivery_method text not null default 'coordinate',
  idempotency_key uuid not null,
  request_fingerprint_hash text not null,
  provider text not null default 'mercado_pago',
  provider_external_reference text not null,
  provider_preference_id text,
  provider_checkout_url text,
  provider_checkout_status text not null default 'ready',
  provider_error text,
  sale_id uuid,
  expires_at timestamptz not null,
  paid_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_orders_number_check check (order_number > 0),
  constraint business_orders_status_check check (status in ('awaiting_payment', 'paid', 'cancelled', 'expired', 'refunded', 'partially_refunded', 'payment_review')),
  constraint business_orders_payment_status_check check (payment_status in ('pending', 'in_process', 'approved', 'rejected', 'cancelled', 'refunded', 'partially_refunded', 'unknown')),
  constraint business_orders_currency_check check (currency = 'ARS'),
  constraint business_orders_amounts_check check (subtotal >= 0 and total >= 0 and marketplace_fee_amount >= 0 and marketplace_fee_amount <= total),
  constraint business_orders_buyer_name_check check (length(btrim(buyer_name)) between 2 and 120),
  constraint business_orders_buyer_email_check check (length(btrim(buyer_email)) between 3 and 254),
  constraint business_orders_buyer_phone_check check (buyer_phone is null or length(btrim(buyer_phone)) between 8 and 30),
  constraint business_orders_delivery_check check (delivery_method = 'coordinate'),
  constraint business_orders_provider_check check (provider = 'mercado_pago'),
  constraint business_orders_checkout_status_check check (provider_checkout_status in ('ready', 'creating', 'ambiguous', 'created', 'failed')),
  constraint business_orders_expiry_check check (expires_at > created_at)
);

create table if not exists public.business_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  user_id uuid not null,
  catalog_item_id uuid not null,
  source_type text not null,
  product_name_snapshot text not null,
  sku_snapshot text,
  image_url_snapshot text,
  unit_price numeric(14,2) not null,
  quantity integer not null,
  subtotal numeric(14,2) not null,
  created_at timestamptz not null default now(),
  constraint business_order_items_source_check check (source_type in ('manufactured', 'resale')),
  constraint business_order_items_quantity_check check (quantity between 1 and 100000),
  constraint business_order_items_amounts_check check (unit_price >= 0 and subtotal >= 0)
);

create table if not exists public.business_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  user_id uuid not null,
  catalog_item_id uuid not null,
  source_product_id uuid,
  quantity integer not null,
  status text not null default 'reserved',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_stock_reservations_quantity_check check (quantity > 0),
  constraint business_stock_reservations_status_check check (status in ('reserved', 'consumed', 'released'))
);

create table if not exists public.business_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  order_id uuid not null,
  provider text not null,
  provider_payment_id text not null,
  status text not null,
  status_detail text,
  amount numeric(14,2) not null,
  currency text not null,
  external_reference text,
  collector_id text,
  raw_data jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_payments_provider_check check (provider = 'mercado_pago'),
  constraint business_payments_status_check check (status in ('pending', 'in_process', 'approved', 'rejected', 'cancelled', 'refunded', 'partially_refunded', 'unknown')),
  constraint business_payments_amount_check check (amount >= 0),
  constraint business_payments_currency_check check (currency = 'ARS')
);

create table if not exists public.business_payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  request_id text,
  event_type text,
  action text,
  data_id text,
  status text not null default 'received',
  processing_attempts integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint business_payment_webhook_provider_check check (provider = 'mercado_pago'),
  constraint business_payment_webhook_status_check check (status in ('received', 'processing', 'processed', 'ignored', 'error')),
  constraint business_payment_webhook_attempts_check check (processing_attempts > 0)
);

-- Add the legacy-side pointer only when it is genuinely absent. An unconditional
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS still takes a strong table lock.
do $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.business_sales'::regclass
      and attname = 'order_id' and not attisdropped
  ) then
    lock table public.business_orders, public.business_sales in share row exclusive mode;
    alter table public.business_sales add column order_id uuid;
  end if;
end
$$;

create unique index if not exists business_orders_user_idempotency_uidx on public.business_orders(user_id, idempotency_key);
create unique index if not exists business_payment_accounts_provider_user_uidx on public.business_payment_accounts(provider, provider_user_id) where provider_user_id is not null;
create unique index if not exists business_orders_user_number_uidx on public.business_orders(user_id, order_number);
create unique index if not exists business_orders_public_token_uidx on public.business_orders(public_token);
create unique index if not exists business_orders_external_reference_uidx on public.business_orders(provider, provider_external_reference);
create unique index if not exists business_orders_preference_uidx on public.business_orders(provider, provider_preference_id) where provider_preference_id is not null;
create unique index if not exists business_orders_sale_uidx on public.business_orders(sale_id) where sale_id is not null;
create unique index if not exists business_order_items_order_catalog_uidx on public.business_order_items(order_id, catalog_item_id);
create unique index if not exists business_stock_reservations_order_catalog_uidx on public.business_stock_reservations(order_id, catalog_item_id);
create unique index if not exists business_payments_provider_payment_uidx on public.business_payments(provider, provider_payment_id);
create unique index if not exists business_payment_webhook_event_uidx on public.business_payment_webhook_events(provider, provider_event_id);
create index if not exists business_orders_user_created_idx on public.business_orders(user_id, created_at desc);
create index if not exists business_orders_expiry_idx on public.business_orders(expires_at) where status = 'awaiting_payment';
create index if not exists business_reservations_active_idx on public.business_stock_reservations(catalog_item_id, expires_at) where status = 'reserved';
create index if not exists business_payments_order_idx on public.business_payments(order_id, created_at desc);
create index if not exists business_oauth_states_expiry_idx on public.business_payment_oauth_states(expires_at) where consumed_at is null;
create unique index if not exists business_sales_order_uidx on public.business_sales(order_id) where order_id is not null;

-- Foreign keys are deliberately added only after every table and supporting
-- index exists. NOT VALID avoids scanning existing rows while the constraint is
-- installed; validation is performed in a separate, idempotent phase below.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_payment_accounts'::regclass and conname = 'business_payment_accounts_user_id_fkey') then
    alter table public.business_payment_accounts add constraint business_payment_accounts_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_payment_oauth_states'::regclass and conname = 'business_payment_oauth_states_user_id_fkey') then
    alter table public.business_payment_oauth_states add constraint business_payment_oauth_states_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_orders'::regclass and conname = 'business_orders_user_id_fkey') then
    alter table public.business_orders add constraint business_orders_user_id_fkey foreign key (user_id) references auth.users(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_order_items'::regclass and conname = 'business_order_items_order_id_fkey') then
    alter table public.business_order_items add constraint business_order_items_order_id_fkey foreign key (order_id) references public.business_orders(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_order_items'::regclass and conname = 'business_order_items_user_id_fkey') then
    alter table public.business_order_items add constraint business_order_items_user_id_fkey foreign key (user_id) references auth.users(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_order_items'::regclass and conname = 'business_order_items_catalog_item_id_fkey') then
    alter table public.business_order_items add constraint business_order_items_catalog_item_id_fkey foreign key (catalog_item_id) references public.business_catalog_items(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_stock_reservations'::regclass and conname = 'business_stock_reservations_order_id_fkey') then
    alter table public.business_stock_reservations add constraint business_stock_reservations_order_id_fkey foreign key (order_id) references public.business_orders(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_stock_reservations'::regclass and conname = 'business_stock_reservations_user_id_fkey') then
    alter table public.business_stock_reservations add constraint business_stock_reservations_user_id_fkey foreign key (user_id) references auth.users(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_stock_reservations'::regclass and conname = 'business_stock_reservations_catalog_item_id_fkey') then
    alter table public.business_stock_reservations add constraint business_stock_reservations_catalog_item_id_fkey foreign key (catalog_item_id) references public.business_catalog_items(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_stock_reservations'::regclass and conname = 'business_stock_reservations_source_product_id_fkey') then
    alter table public.business_stock_reservations add constraint business_stock_reservations_source_product_id_fkey foreign key (source_product_id) references public.products(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_payments'::regclass and conname = 'business_payments_user_id_fkey') then
    alter table public.business_payments add constraint business_payments_user_id_fkey foreign key (user_id) references auth.users(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_payments'::regclass and conname = 'business_payments_order_id_fkey') then
    alter table public.business_payments add constraint business_payments_order_id_fkey foreign key (order_id) references public.business_orders(id) on delete restrict not valid;
  end if;
end
$$;

-- The two cross-links are retained for compatibility but are installed together
-- and in one documented order: business_orders first, business_sales second.
do $$
begin
  lock table public.business_orders, public.business_sales in share row exclusive mode;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_orders'::regclass and conname = 'business_orders_sale_id_fkey') then
    alter table public.business_orders add constraint business_orders_sale_id_fkey foreign key (sale_id) references public.business_sales(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.business_sales'::regclass and conname = 'business_sales_order_id_fkey') then
    alter table public.business_sales add constraint business_sales_order_id_fkey foreign key (order_id) references public.business_orders(id) on delete restrict not valid;
  end if;
end
$$;

-- Existing inline constraints from an earlier partial execution already have
-- these names and are normally validated. Skip their ALTER TABLE entirely.
do $$
declare constraint_to_validate record;
begin
  if exists (
    select 1 from pg_constraint
    where not convalidated and (
      (conrelid = 'public.business_orders'::regclass and conname = 'business_orders_sale_id_fkey')
      or (conrelid = 'public.business_sales'::regclass and conname = 'business_sales_order_id_fkey')
    )
  ) then
    lock table public.business_orders, public.business_sales in share row exclusive mode;
  end if;
  for constraint_to_validate in
    select namespace.nspname as schema_name, relation.relname as table_name, constraint_row.conname
    from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where constraint_row.contype = 'f' and not constraint_row.convalidated
      and (relation.oid, constraint_row.conname) in (
        ('public.business_payment_accounts'::regclass, 'business_payment_accounts_user_id_fkey'),
        ('public.business_payment_oauth_states'::regclass, 'business_payment_oauth_states_user_id_fkey'),
        ('public.business_orders'::regclass, 'business_orders_user_id_fkey'),
        ('public.business_order_items'::regclass, 'business_order_items_order_id_fkey'),
        ('public.business_order_items'::regclass, 'business_order_items_user_id_fkey'),
        ('public.business_order_items'::regclass, 'business_order_items_catalog_item_id_fkey'),
        ('public.business_stock_reservations'::regclass, 'business_stock_reservations_order_id_fkey'),
        ('public.business_stock_reservations'::regclass, 'business_stock_reservations_user_id_fkey'),
        ('public.business_stock_reservations'::regclass, 'business_stock_reservations_catalog_item_id_fkey'),
        ('public.business_stock_reservations'::regclass, 'business_stock_reservations_source_product_id_fkey'),
        ('public.business_payments'::regclass, 'business_payments_user_id_fkey'),
        ('public.business_payments'::regclass, 'business_payments_order_id_fkey'),
        ('public.business_orders'::regclass, 'business_orders_sale_id_fkey'),
        ('public.business_sales'::regclass, 'business_sales_order_id_fkey')
      )
    order by case relation.relname
      when 'business_payment_accounts' then 1
      when 'business_payment_oauth_states' then 2
      when 'business_orders' then 3
      when 'business_order_items' then 4
      when 'business_stock_reservations' then 5
      when 'business_payments' then 6
      when 'business_sales' then 7
      else 8 end,
      constraint_row.conname
  loop
    execute format('alter table %I.%I validate constraint %I', constraint_to_validate.schema_name, constraint_to_validate.table_name, constraint_to_validate.conname);
  end loop;
end
$$;

drop trigger if exists business_payment_accounts_set_updated_at on public.business_payment_accounts;
create trigger business_payment_accounts_set_updated_at before update on public.business_payment_accounts for each row execute function public.set_updated_at();
drop trigger if exists business_orders_set_updated_at on public.business_orders;
create trigger business_orders_set_updated_at before update on public.business_orders for each row execute function public.set_updated_at();
drop trigger if exists business_stock_reservations_set_updated_at on public.business_stock_reservations;
create trigger business_stock_reservations_set_updated_at before update on public.business_stock_reservations for each row execute function public.set_updated_at();
drop trigger if exists business_payments_set_updated_at on public.business_payments;
create trigger business_payments_set_updated_at before update on public.business_payments for each row execute function public.set_updated_at();
drop trigger if exists business_payment_webhook_events_set_updated_at on public.business_payment_webhook_events;
create trigger business_payment_webhook_events_set_updated_at before update on public.business_payment_webhook_events for each row execute function public.set_updated_at();

alter table public.business_payment_accounts enable row level security;
alter table public.business_payment_oauth_states enable row level security;
alter table public.business_orders enable row level security;
alter table public.business_order_items enable row level security;
alter table public.business_stock_reservations enable row level security;
alter table public.business_payments enable row level security;
alter table public.business_payment_webhook_events enable row level security;

drop policy if exists business_orders_select_own on public.business_orders;
create policy business_orders_select_own on public.business_orders for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));
drop policy if exists business_order_items_select_own on public.business_order_items;
create policy business_order_items_select_own on public.business_order_items for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));
drop policy if exists business_reservations_select_own on public.business_stock_reservations;
create policy business_reservations_select_own on public.business_stock_reservations for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));
drop policy if exists business_payments_select_own on public.business_payments;
create policy business_payments_select_own on public.business_payments for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists business_orders_admin_all on public.business_orders;
create policy business_orders_admin_all on public.business_orders for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
drop policy if exists business_order_items_admin_all on public.business_order_items;
create policy business_order_items_admin_all on public.business_order_items for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
drop policy if exists business_reservations_admin_all on public.business_stock_reservations;
create policy business_reservations_admin_all on public.business_stock_reservations for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
drop policy if exists business_payments_admin_all on public.business_payments;
create policy business_payments_admin_all on public.business_payments for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

revoke all on table public.business_payment_accounts from public, anon, authenticated;
revoke all on table public.business_payment_oauth_states from public, anon, authenticated;
revoke all on table public.business_payment_webhook_events from public, anon, authenticated;
revoke all on table public.business_orders from public, anon, authenticated;
revoke all on table public.business_order_items from public, anon, authenticated;
revoke all on table public.business_stock_reservations from public, anon, authenticated;
revoke all on table public.business_payments from public, anon, authenticated;
grant select on table public.business_orders, public.business_order_items, public.business_stock_reservations, public.business_payments to authenticated;

create or replace function public.get_business_payment_connection()
returns table (provider text, status text, provider_user_id text, live_mode boolean, token_expires_at timestamptz, connected_at timestamptz, last_error text)
language sql stable security definer set search_path = '' as $$
  select account.provider, account.status, account.provider_user_id, account.live_mode,
    account.token_expires_at, account.connected_at, account.last_error
  from public.business_payment_accounts account
  where account.user_id = auth.uid() and public.has_platform_access(auth.uid());
$$;

create or replace function public.create_public_business_order(
  p_store_slug text,
  p_idempotency_key uuid,
  p_items jsonb,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone text,
  p_request_fingerprint_hash text,
  p_marketplace_fee_percent numeric default 0,
  p_allow_live boolean default false
)
returns table (success boolean, order_id uuid, public_token uuid, order_number bigint, total_amount numeric, expires_at timestamptz, checkout_status text, checkout_url text, replayed boolean, error_code text, message text)
language plpgsql security definer set search_path = public as $$
declare
  store public.business_storefronts%rowtype;
  account public.business_payment_accounts%rowtype;
  existing_order public.business_orders%rowtype;
  requested record;
  item public.business_catalog_items%rowtype;
  product public.products%rowtype;
  reserved_count integer;
  on_hand integer;
  already_reserved integer;
  computed_total numeric(14,2) := 0;
  created_order_id uuid := gen_random_uuid();
  created_public_token uuid := gen_random_uuid();
  created_order_number bigint;
  order_expiry timestamptz := now() + interval '30 minutes';
  fee_amount numeric(14,2);
begin
  if p_idempotency_key is null or coalesce(p_request_fingerprint_hash, '') !~ '^[a-f0-9]{64}$' then
    return query select false, null::uuid, null::uuid, null::bigint, null::numeric, null::timestamptz, null::text, null::text, false, 'invalid_request'::text, 'La solicitud de compra no es válida.'::text; return;
  end if;
  if p_marketplace_fee_percent < 0 or p_marketplace_fee_percent > 100 then
    raise exception 'Invalid marketplace fee configuration';
  end if;
  select s.* into store from public.business_storefronts s
  where s.slug = public.normalize_business_storefront_slug(p_store_slug) and s.is_active = true;
  if not found then
    return query select false, null::uuid, null::uuid, null::bigint, null::numeric, null::timestamptz, null::text, null::text, false, 'store_not_found'::text, 'La tienda no está disponible.'::text; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('business-order:' || store.user_id::text || ':' || p_idempotency_key::text, 0));
  select o.* into existing_order from public.business_orders o
  where o.user_id = store.user_id and o.idempotency_key = p_idempotency_key for update;
  if found then
    return query select true, existing_order.id, existing_order.public_token, existing_order.order_number,
      existing_order.total, existing_order.expires_at, existing_order.provider_checkout_status,
      existing_order.provider_checkout_url, true, null::text, 'El pedido ya existía.'::text; return;
  end if;

  select a.* into account from public.business_payment_accounts a
  where a.user_id = store.user_id and a.status = 'connected';
  if not found or (account.live_mode and not p_allow_live) then
    return query select false, null::uuid, null::uuid, null::bigint, null::numeric, null::timestamptz, null::text, null::text, false, 'checkout_unavailable'::text, 'Esta tienda todavía no tiene pagos habilitados.'::text; return;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    return query select false, null::uuid, null::uuid, null::bigint, null::numeric, null::timestamptz, null::text, null::text, false, 'invalid_items'::text, 'El carrito debe contener entre 1 y 50 productos.'::text; return;
  end if;
  if btrim(coalesce(p_buyer_name, '')) !~ '.{2,}' or length(btrim(p_buyer_name)) > 120
    or btrim(coalesce(p_buyer_email, '')) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(btrim(p_buyer_email)) > 254
    or (nullif(btrim(coalesce(p_buyer_phone, '')), '') is not null and length(btrim(p_buyer_phone)) not between 8 and 30) then
    return query select false, null::uuid, null::uuid, null::bigint, null::numeric, null::timestamptz, null::text, null::text, false, 'invalid_buyer'::text, 'Revisá los datos de contacto.'::text; return;
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'object'
    or coalesce(e->>'productSlug','') !~ '^[a-z0-9][a-z0-9-]{1,59}$'
    or coalesce(e->>'quantity','') !~ '^[1-9][0-9]{0,2}$') then
    return query select false, null::uuid, null::uuid, null::bigint, null::numeric, null::timestamptz, null::text, null::text, false, 'invalid_items'::text, 'El carrito contiene productos o cantidades inválidas.'::text; return;
  end if;

  select count(*) into reserved_count from public.business_orders o
  where o.user_id = store.user_id and o.request_fingerprint_hash = p_request_fingerprint_hash
    and o.status = 'awaiting_payment' and o.expires_at > now() and o.created_at > now() - interval '1 hour';
  if reserved_count >= 5 then
    return query select false, null::uuid, null::uuid, null::bigint, null::numeric, null::timestamptz, null::text, null::text, false, 'rate_limited'::text, 'Esperá unos minutos antes de iniciar otra compra.'::text; return;
  end if;

  for requested in
    select public.normalize_business_storefront_slug(e->>'productSlug') product_slug,
      sum((e->>'quantity')::integer)::integer quantity
    from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    select c.* into item from public.business_catalog_items c
    where c.user_id = store.user_id and c.public_slug = requested.product_slug
      and c.is_active = true and c.is_published = true for update;
    if not found then
      return query select false, null::uuid, null::uuid, null::bigint, null::numeric, null::timestamptz, null::text, null::text, false, 'product_unavailable'::text, 'Un producto ya no está disponible.'::text; return;
    end if;
    if item.source_type = 'manufactured' then
      select p.* into product from public.products p where p.id = item.source_product_id and p.user_id = store.user_id and p.is_active = true for update;
      if not found then
        return query select false, null::uuid, null::uuid, null::bigint, null::numeric, null::timestamptz, null::text, null::text, false, 'product_unavailable'::text, 'Un producto ya no está disponible.'::text; return;
      end if;
      on_hand := coalesce(product.stock_quantity, 0);
    else
      on_hand := coalesce(item.resale_stock_quantity, 0);
    end if;
    select coalesce(sum(r.quantity),0)::integer into already_reserved from public.business_stock_reservations r
    where r.catalog_item_id = item.id and r.status = 'reserved' and r.expires_at > now();
    if on_hand - already_reserved < requested.quantity then
      return query select false, null::uuid, null::uuid, null::bigint, null::numeric, null::timestamptz, null::text, null::text, false, 'insufficient_stock'::text, format('No hay stock suficiente de %s.', item.name)::text; return;
    end if;
    computed_total := computed_total + item.sale_price * requested.quantity;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('business-order-number:' || store.user_id::text, 0));
  select coalesce(max(o.order_number),0)+1 into created_order_number from public.business_orders o where o.user_id = store.user_id;
  fee_amount := round(computed_total * p_marketplace_fee_percent / 100, 2);
  insert into public.business_orders (
    id, user_id, order_number, public_token, subtotal, total, marketplace_fee_amount,
    buyer_name, buyer_email, buyer_phone, idempotency_key, request_fingerprint_hash,
    provider_external_reference, expires_at
  ) values (
    created_order_id, store.user_id, created_order_number, created_public_token, computed_total, computed_total, fee_amount,
    btrim(p_buyer_name), lower(btrim(p_buyer_email)), nullif(btrim(coalesce(p_buyer_phone,'')), ''),
    p_idempotency_key, p_request_fingerprint_hash, 'stampa-order-' || created_public_token::text, order_expiry
  );

  for requested in
    select public.normalize_business_storefront_slug(e->>'productSlug') product_slug,
      sum((e->>'quantity')::integer)::integer quantity
    from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    select c.* into item from public.business_catalog_items c where c.user_id = store.user_id and c.public_slug = requested.product_slug;
    insert into public.business_order_items (order_id,user_id,catalog_item_id,source_type,product_name_snapshot,sku_snapshot,image_url_snapshot,unit_price,quantity,subtotal)
    values (created_order_id,store.user_id,item.id,item.source_type,item.name,item.sku,item.image_urls[1],item.sale_price,requested.quantity,item.sale_price*requested.quantity);
    insert into public.business_stock_reservations (order_id,user_id,catalog_item_id,source_product_id,quantity,expires_at)
    values (created_order_id,store.user_id,item.id,item.source_product_id,requested.quantity,order_expiry);
  end loop;
  return query select true, created_order_id, created_public_token, created_order_number, computed_total, order_expiry,
    'ready'::text, null::text, false, null::text, 'Pedido creado.'::text;
end;
$$;

create or replace function public.claim_business_order_checkout(p_order_id uuid)
returns table (success boolean, claimed boolean, operation text, user_id uuid, external_reference text, total_amount numeric, marketplace_fee_amount numeric, buyer_email text, expires_at timestamptz, preference_id text, checkout_url text, error_code text)
language plpgsql security definer set search_path = public as $$
declare o public.business_orders%rowtype;
begin
  select x.* into o from public.business_orders x where x.id = p_order_id for update;
  if not found then return query select false,false,null::text,null::uuid,null::text,null::numeric,null::numeric,null::text,null::timestamptz,null::text,null::text,'order_not_found'::text; return; end if;
  if o.status <> 'awaiting_payment' or o.expires_at <= now() then
    return query select false,false,null::text,o.user_id,o.provider_external_reference,o.total,o.marketplace_fee_amount,o.buyer_email,o.expires_at,o.provider_preference_id,o.provider_checkout_url,'order_not_payable'::text; return;
  end if;
  if o.provider_checkout_status = 'created' and o.provider_checkout_url is not null then
    return query select true,false,'existing'::text,o.user_id,o.provider_external_reference,o.total,o.marketplace_fee_amount,o.buyer_email,o.expires_at,o.provider_preference_id,o.provider_checkout_url,null::text; return;
  end if;
  if o.provider_checkout_status = 'creating' and o.updated_at > now() - interval '60 seconds' then
    return query select true,false,'wait'::text,o.user_id,o.provider_external_reference,o.total,o.marketplace_fee_amount,o.buyer_email,o.expires_at,o.provider_preference_id,o.provider_checkout_url,null::text; return;
  end if;
  update public.business_orders set provider_checkout_status = 'creating', provider_error = null where id = o.id;
  return query select true,true,
    case when o.provider_checkout_status in ('ambiguous','creating') then 'reconcile' else 'create' end,
    o.user_id,o.provider_external_reference,o.total,o.marketplace_fee_amount,o.buyer_email,o.expires_at,o.provider_preference_id,o.provider_checkout_url,null::text;
end;
$$;

create or replace function public.complete_business_order_checkout(p_order_id uuid, p_preference_id text, p_checkout_url text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.business_orders set provider_preference_id = btrim(p_preference_id), provider_checkout_url = btrim(p_checkout_url),
    provider_checkout_status = 'created', provider_error = null
  where id = p_order_id and status = 'awaiting_payment' and btrim(coalesce(p_preference_id,'')) <> '' and btrim(coalesce(p_checkout_url,'')) ~ '^https://';
  return found;
end;
$$;

create or replace function public.fail_business_order_checkout(p_order_id uuid, p_ambiguous boolean, p_error text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.business_orders set provider_checkout_status = case when p_ambiguous then 'ambiguous' else 'failed' end,
    provider_error = left(coalesce(p_error,'Provider error'),500) where id = p_order_id and status = 'awaiting_payment';
  return found;
end;
$$;

create or replace function public.process_business_payment(
  p_provider text, p_payment_id text, p_status text, p_status_detail text,
  p_amount numeric, p_currency text, p_external_reference text, p_collector_id text,
  p_approved_at timestamptz, p_raw_data jsonb
)
returns table (success boolean, order_id uuid, sale_id uuid, replayed boolean, requires_review boolean, error_code text, message text)
language plpgsql security definer set search_path = public as $$
declare
  o public.business_orders%rowtype;
  account public.business_payment_accounts%rowtype;
  existing_payment public.business_payments%rowtype;
  reservation record;
  item public.business_catalog_items%rowtype;
  product public.products%rowtype;
  previous_stock integer;
  new_stock integer;
  created_sale_id uuid;
  created_sale_number bigint;
  mapped_status text;
begin
  mapped_status := case
    when p_status = 'approved' then 'approved'
    when p_status in ('pending','in_process','in_mediation') then case when p_status='pending' then 'pending' else 'in_process' end
    when p_status = 'rejected' then 'rejected'
    when p_status in ('cancelled','canceled') then 'cancelled'
    when p_status = 'refunded' then 'refunded'
    when p_status = 'partially_refunded' then 'partially_refunded'
    else 'unknown' end;
  if p_provider <> 'mercado_pago' or btrim(coalesce(p_payment_id,'')) = '' or btrim(coalesce(p_external_reference,'')) = '' then
    return query select false,null::uuid,null::uuid,false,false,'invalid_payment'::text,'El pago verificado está incompleto.'::text; return;
  end if;
  select x.* into o from public.business_orders x where x.provider = p_provider and x.provider_external_reference = p_external_reference for update;
  if not found then return query select false,null::uuid,null::uuid,false,false,'order_not_found'::text,'No existe un pedido para este pago.'::text; return; end if;
  select a.* into account from public.business_payment_accounts a where a.user_id=o.user_id and a.provider=p_provider;
  if not found or account.provider_user_id is distinct from p_collector_id then
    return query select false,o.id,o.sale_id,false,false,'seller_mismatch'::text,'El cobro no pertenece al vendedor del pedido.'::text; return;
  end if;
  if p_currency <> o.currency or round(p_amount,2) <> o.total then
    return query select false,o.id,o.sale_id,false,false,'amount_mismatch'::text,'El importe verificado no coincide con el pedido.'::text; return;
  end if;
  select p.* into existing_payment from public.business_payments p where p.provider=p_provider and p.provider_payment_id=p_payment_id for update;
  if found and existing_payment.order_id <> o.id then
    return query select false,o.id,o.sale_id,false,false,'payment_reused'::text,'El pago ya está asociado a otro pedido.'::text; return;
  end if;
  insert into public.business_payments (user_id,order_id,provider,provider_payment_id,status,status_detail,amount,currency,external_reference,collector_id,raw_data,approved_at)
  values (o.user_id,o.id,p_provider,p_payment_id,mapped_status,p_status_detail,p_amount,p_currency,p_external_reference,p_collector_id,coalesce(p_raw_data,'{}'::jsonb),p_approved_at)
  on conflict (provider,provider_payment_id) do update set status=excluded.status,status_detail=excluded.status_detail,
    amount=excluded.amount,currency=excluded.currency,external_reference=excluded.external_reference,
    collector_id=excluded.collector_id,raw_data=excluded.raw_data,approved_at=excluded.approved_at;

  if mapped_status = 'refunded' then
    update public.business_orders set status='refunded',payment_status='refunded',refunded_at=coalesce(p_approved_at,now()) where id=o.id;
    return query select true,o.id,o.sale_id,existing_payment.id is not null,false,null::text,'Reembolso registrado; el inventario requiere revisión manual.'::text; return;
  elsif mapped_status = 'partially_refunded' then
    update public.business_orders set status='partially_refunded',payment_status='partially_refunded' where id=o.id;
    return query select true,o.id,o.sale_id,existing_payment.id is not null,false,null::text,'Reembolso parcial registrado; el inventario requiere revisión manual.'::text; return;
  elsif mapped_status <> 'approved' then
    update public.business_orders set payment_status=mapped_status where id=o.id and status='awaiting_payment';
    return query select true,o.id,o.sale_id,existing_payment.id is not null,false,null::text,'Estado de pago actualizado.'::text; return;
  end if;

  if o.status = 'paid' and o.sale_id is not null then
    return query select true,o.id,o.sale_id,true,false,null::text,'El pago ya había sido consolidado.'::text; return;
  end if;
  if o.status <> 'awaiting_payment' then
    update public.business_orders set status='payment_review',payment_status='approved' where id=o.id;
    return query select true,o.id,o.sale_id,false,true,'order_not_payable'::text,'Pago aprobado pendiente de revisión manual.'::text; return;
  end if;

  for reservation in
    select r.* from public.business_stock_reservations r where r.order_id=o.id order by r.catalog_item_id for update
  loop
    if reservation.status <> 'reserved' then
      update public.business_orders set status='payment_review',payment_status='approved' where id=o.id;
      return query select true,o.id,o.sale_id,false,true,'reservation_missing'::text,'Pago aprobado pendiente de revisión de stock.'::text; return;
    end if;
    select c.* into item from public.business_catalog_items c where c.id=reservation.catalog_item_id and c.user_id=o.user_id for update;
    if item.source_type='manufactured' then
      select p.* into product from public.products p where p.id=item.source_product_id and p.user_id=o.user_id for update;
      previous_stock := coalesce(product.stock_quantity,0);
    else previous_stock := coalesce(item.resale_stock_quantity,0); end if;
    if previous_stock < reservation.quantity then
      update public.business_orders set status='payment_review',payment_status='approved' where id=o.id;
      return query select true,o.id,o.sale_id,false,true,'stock_conflict'::text,'Pago aprobado pendiente de revisión de stock.'::text; return;
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('business-sale-number:' || o.user_id::text,0));
  select coalesce(max(s.sale_number),0)+1 into created_sale_number from public.business_sales s where s.user_id=o.user_id;
  insert into public.business_sales (user_id,sale_number,status,currency,subtotal,total,idempotency_key,order_id)
  values (o.user_id,created_sale_number,'completed',o.currency,o.subtotal,o.total,o.id,o.id) returning id into created_sale_id;
  insert into public.business_sale_items (sale_id,user_id,catalog_item_id,source_type,product_name_snapshot,sku_snapshot,unit_price,quantity,subtotal)
  select created_sale_id,i.user_id,i.catalog_item_id,i.source_type,i.product_name_snapshot,i.sku_snapshot,i.unit_price,i.quantity,i.subtotal
  from public.business_order_items i where i.order_id=o.id;

  for reservation in select r.* from public.business_stock_reservations r where r.order_id=o.id order by r.catalog_item_id for update
  loop
    select c.* into item from public.business_catalog_items c where c.id=reservation.catalog_item_id;
    if item.source_type='manufactured' then
      select coalesce(p.stock_quantity,0) into previous_stock from public.products p where p.id=item.source_product_id;
      perform public.adjust_product_stock(item.source_product_id,-reservation.quantity,'manual_subtract',format('Pedido online N.º %s',o.order_number),'business_sale',created_sale_id);
      select coalesce(p.stock_quantity,0) into new_stock from public.products p where p.id=item.source_product_id;
      if new_stock is distinct from previous_stock-reservation.quantity then raise exception 'Product stock mutation did not produce expected value'; end if;
    else
      previous_stock := item.resale_stock_quantity; new_stock := previous_stock-reservation.quantity;
      update public.business_catalog_items set resale_stock_quantity=new_stock where id=item.id and user_id=o.user_id;
      if not found then raise exception 'Resale stock mutation failed'; end if;
    end if;
    insert into public.business_inventory_movements (user_id,catalog_item_id,sale_id,movement_type,quantity_delta,previous_quantity,new_quantity,reason,reference,operation_key)
    values (o.user_id,item.id,created_sale_id,'sale',-reservation.quantity,previous_stock,new_stock,
      format('Pedido online N.º %s',o.order_number),'ORDER-'||lpad(o.order_number::text,6,'0'),o.id);
  end loop;
  update public.business_stock_reservations set status='consumed',consumed_at=now() where order_id=o.id and status='reserved';
  update public.business_orders set status='paid',payment_status='approved',paid_at=coalesce(p_approved_at,now()),sale_id=created_sale_id where id=o.id;
  return query select true,o.id,created_sale_id,false,false,null::text,'Pago consolidado y venta creada.'::text;
end;
$$;

create or replace function public.expire_business_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  with expired as (
    update public.business_orders set status='expired',payment_status=case when payment_status='approved' then payment_status else 'cancelled' end
    where status='awaiting_payment' and expires_at<=now() returning id
  ), released as (
    update public.business_stock_reservations r set status='released',released_at=now()
    where r.status='reserved' and r.order_id in (select id from expired) returning r.id
  ) select count(*) into affected from expired;
  return affected;
end;
$$;

create or replace function public.get_public_business_order(p_store_slug text,p_public_token uuid)
returns table (order_number bigint,order_status text,payment_status text,total_amount numeric,currency text,buyer_name text,created_at timestamptz,expires_at timestamptz,items jsonb)
language sql stable security definer set search_path = '' as $$
  select o.order_number,o.status,o.payment_status,o.total,o.currency,o.buyer_name,o.created_at,o.expires_at,
    coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',i.quantity,'unitPrice',i.unit_price,'subtotal',i.subtotal) order by i.product_name_snapshot)
      from public.business_order_items i where i.order_id=o.id),'[]'::jsonb)
  from public.business_orders o join public.business_storefronts s on s.user_id=o.user_id
  where s.slug=public.normalize_business_storefront_slug(p_store_slug) and o.public_token=p_public_token;
$$;

create or replace function public.get_public_business_storefront_checkout_status(p_store_slug text)
returns table (checkout_enabled boolean,test_mode boolean)
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.business_payment_accounts a where a.user_id=s.user_id and a.status='connected'
    and not a.live_mode),
    not coalesce((select a.live_mode from public.business_payment_accounts a where a.user_id=s.user_id and a.status='connected' limit 1),false)
  from public.business_storefronts s where s.slug=public.normalize_business_storefront_slug(p_store_slug) and s.is_active=true;
$$;

create or replace function public.get_public_business_storefront_products(p_store_slug text)
returns table (product_slug text,product_name text,product_category text,product_description text,product_price numeric,product_image_url text,product_available boolean)
language sql stable security definer set search_path = '' as $$
  select item.public_slug,item.name,item.category,item.description,item.sale_price,item.image_urls[1],
    (case when item.source_type='resale' then item.resale_stock_quantity else coalesce(product.stock_quantity,0) end)
      - coalesce((select sum(r.quantity) from public.business_stock_reservations r where r.catalog_item_id=item.id and r.status='reserved' and r.expires_at>now()),0) > 0
  from public.business_storefronts store join public.business_catalog_items item on item.user_id=store.user_id
  left join public.products product on product.id=item.source_product_id and product.user_id=store.user_id
  where store.slug=public.normalize_business_storefront_slug(p_store_slug) and store.is_active=true
    and item.is_active=true and item.is_published=true and item.public_slug is not null
    and (item.source_type='resale' or product.is_active=true) order by item.category,item.name;
$$;

create or replace function public.get_public_business_storefront_product(p_store_slug text,p_product_slug text)
returns table (product_slug text,product_name text,product_category text,product_description text,product_price numeric,product_image_url text,product_available boolean)
language sql stable security definer set search_path = '' as $$
  select item.public_slug,item.name,item.category,item.description,item.sale_price,item.image_urls[1],
    (case when item.source_type='resale' then item.resale_stock_quantity else coalesce(product.stock_quantity,0) end)
      - coalesce((select sum(r.quantity) from public.business_stock_reservations r where r.catalog_item_id=item.id and r.status='reserved' and r.expires_at>now()),0) > 0
  from public.business_storefronts store join public.business_catalog_items item on item.user_id=store.user_id
  left join public.products product on product.id=item.source_product_id and product.user_id=store.user_id
  where store.slug=public.normalize_business_storefront_slug(p_store_slug)
    and item.public_slug=public.normalize_business_storefront_slug(p_product_slug)
    and store.is_active=true and item.is_active=true and item.is_published=true
    and (item.source_type='resale' or product.is_active=true) limit 1;
$$;

revoke all on function public.get_business_payment_connection() from public,anon;
grant execute on function public.get_business_payment_connection() to authenticated;
revoke all on function public.create_public_business_order(text,uuid,jsonb,text,text,text,text,numeric,boolean) from public,anon,authenticated;
revoke all on function public.claim_business_order_checkout(uuid) from public,anon,authenticated;
revoke all on function public.complete_business_order_checkout(uuid,text,text) from public,anon,authenticated;
revoke all on function public.fail_business_order_checkout(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.process_business_payment(text,text,text,text,numeric,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.expire_business_orders() from public,anon,authenticated;
grant execute on function public.create_public_business_order(text,uuid,jsonb,text,text,text,text,numeric,boolean) to service_role;
grant execute on function public.claim_business_order_checkout(uuid) to service_role;
grant execute on function public.complete_business_order_checkout(uuid,text,text) to service_role;
grant execute on function public.fail_business_order_checkout(uuid,boolean,text) to service_role;
grant execute on function public.process_business_payment(text,text,text,text,numeric,text,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.expire_business_orders() to service_role;
revoke all on function public.get_public_business_order(text,uuid) from public;
grant execute on function public.get_public_business_order(text,uuid) to anon,authenticated;
revoke all on function public.get_public_business_storefront_checkout_status(text) from public;
grant execute on function public.get_public_business_storefront_checkout_status(text) to anon,authenticated;

notify pgrst,'reload schema';
reset lock_timeout;
