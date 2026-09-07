-- Sprint 1/4: commercial catalog foundation for Mi Negocio.
-- This migration does not move or copy production data. Manufactured stock
-- remains authoritative in public.products.stock_quantity.

do $$
begin
  if to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.has_platform_access(uuid)';
  end if;

  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid)';
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Missing dependency: public.set_updated_at()';
  end if;

  if to_regclass('public.products') is null then
    raise exception 'Missing dependency: public.products';
  end if;
end
$$;

create table if not exists public.business_catalog_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_product_id uuid references public.products(id) on delete restrict,
  name text not null,
  category text not null,
  brand text,
  description text,
  purchase_cost numeric(14, 2),
  sale_price numeric(14, 2) not null default 0,
  resale_stock_quantity integer not null default 0,
  sku text,
  barcode text,
  supplier text,
  image_urls text[] not null default '{}'::text[],
  is_active boolean not null default true,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint business_catalog_items_source_type_check
    check (source_type in ('manufactured', 'resale')),
  constraint business_catalog_items_name_check
    check (length(btrim(name)) between 1 and 160),
  constraint business_catalog_items_category_check
    check (length(btrim(category)) between 1 and 100),
  constraint business_catalog_items_purchase_cost_check
    check (purchase_cost is null or purchase_cost >= 0),
  constraint business_catalog_items_sale_price_check
    check (sale_price >= 0),
  constraint business_catalog_items_resale_stock_check
    check (resale_stock_quantity >= 0),
  constraint business_catalog_items_source_consistency_check
    check (
      (
        source_type = 'manufactured'
        and source_product_id is not null
        and purchase_cost is null
        and resale_stock_quantity = 0
      )
      or
      (
        source_type = 'resale'
        and source_product_id is null
      )
    )
);

comment on table public.business_catalog_items is
  'Commercial catalog. Manufactured items reference public.products; resale items own their commercial stock.';
comment on column public.business_catalog_items.source_product_id is
  'Production product used as the authority for recipe, production cost and finished stock.';
comment on column public.business_catalog_items.resale_stock_quantity is
  'Commercial unit stock used only when source_type = resale.';
comment on column public.business_catalog_items.is_published is
  'Reserved for a future public store; this sprint does not publish products.';

create unique index if not exists business_catalog_items_user_source_product_uidx
  on public.business_catalog_items (user_id, source_product_id)
  where source_product_id is not null;

create unique index if not exists business_catalog_items_user_sku_uidx
  on public.business_catalog_items (user_id, lower(btrim(sku)))
  where sku is not null and btrim(sku) <> '';

create unique index if not exists business_catalog_items_user_barcode_uidx
  on public.business_catalog_items (user_id, lower(btrim(barcode)))
  where barcode is not null and btrim(barcode) <> '';

create index if not exists business_catalog_items_user_created_idx
  on public.business_catalog_items (user_id, created_at desc);

create index if not exists business_catalog_items_user_active_idx
  on public.business_catalog_items (user_id, is_active, source_type);

create index if not exists business_catalog_items_source_product_idx
  on public.business_catalog_items (source_product_id)
  where source_product_id is not null;

drop trigger if exists business_catalog_items_set_updated_at on public.business_catalog_items;
create trigger business_catalog_items_set_updated_at
before update on public.business_catalog_items
for each row execute function public.set_updated_at();

alter table public.business_catalog_items enable row level security;

drop policy if exists business_catalog_items_select_own on public.business_catalog_items;
create policy business_catalog_items_select_own
on public.business_catalog_items
for select
to authenticated
using (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
);

drop policy if exists business_catalog_items_insert_own on public.business_catalog_items;
create policy business_catalog_items_insert_own
on public.business_catalog_items
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
  and (
    (
      source_type = 'manufactured'
      and exists (
        select 1
        from public.products product
        where product.id = source_product_id
          and product.user_id = auth.uid()
      )
    )
    or (source_type = 'resale' and source_product_id is null)
  )
);

drop policy if exists business_catalog_items_update_own on public.business_catalog_items;
create policy business_catalog_items_update_own
on public.business_catalog_items
for update
to authenticated
using (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
)
with check (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
  and (
    (
      source_type = 'manufactured'
      and exists (
        select 1
        from public.products product
        where product.id = source_product_id
          and product.user_id = auth.uid()
      )
    )
    or (source_type = 'resale' and source_product_id is null)
  )
);

drop policy if exists business_catalog_items_delete_own on public.business_catalog_items;
create policy business_catalog_items_delete_own
on public.business_catalog_items
for delete
to authenticated
using (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
);

drop policy if exists business_catalog_items_admin_all on public.business_catalog_items;
create policy business_catalog_items_admin_all
on public.business_catalog_items
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

revoke all on table public.business_catalog_items from anon;
grant select, insert, update, delete on table public.business_catalog_items to authenticated;

notify pgrst, 'reload schema';
