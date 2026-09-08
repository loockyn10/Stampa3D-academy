-- Sprint 3/4: public business storefront. Apply after the Sprint 1 and 2 migrations.

do $$
begin
  if to_regclass('public.business_catalog_items') is null then
    raise exception 'Missing dependency: public.business_catalog_items';
  end if;
  if to_regclass('public.products') is null then
    raise exception 'Missing dependency: public.products';
  end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.has_platform_access(uuid)';
  end if;
  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid)';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Missing dependency: public.set_updated_at()';
  end if;
end
$$;

create or replace function public.normalize_business_storefront_slug(p_value text)
returns text language sql immutable set search_path = '' as $$
  select trim(both '-' from left(regexp_replace(
    translate(lower(coalesce(p_value, '')), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+', '-', 'g'
  ), 60));
$$;

create table if not exists public.business_storefronts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  logo_url text,
  banner_url text,
  whatsapp text,
  public_email text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_storefronts_name_check check (length(btrim(name)) between 1 and 120),
  constraint business_storefronts_slug_check check (
    slug = public.normalize_business_storefront_slug(slug)
    and length(slug) between 3 and 60
    and slug not in ('admin', 'api', 'auth', 'landing', 'login', 'registro', 'stampy', 'tienda', 'mi-negocio')
  ),
  constraint business_storefronts_description_check check (description is null or length(description) <= 600),
  constraint business_storefronts_whatsapp_check check (whatsapp is null or whatsapp ~ '^[0-9]{8,20}$'),
  constraint business_storefronts_email_check check (public_email is null or length(public_email) <= 254),
  constraint business_storefronts_logo_url_check check (logo_url is null or logo_url ~ '^https?://'),
  constraint business_storefronts_banner_url_check check (banner_url is null or banner_url ~ '^https?://')
);

alter table public.business_catalog_items add column if not exists public_slug text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_catalog_items_public_slug_check' and conrelid = 'public.business_catalog_items'::regclass) then
    alter table public.business_catalog_items add constraint business_catalog_items_public_slug_check
      check (public_slug is null or (public_slug = public.normalize_business_storefront_slug(public_slug) and length(public_slug) between 2 and 60));
  end if;
end
$$;

create unique index if not exists business_storefronts_slug_uidx on public.business_storefronts (lower(slug));
create unique index if not exists business_catalog_items_user_public_slug_uidx
  on public.business_catalog_items (user_id, lower(public_slug)) where public_slug is not null;
create index if not exists business_catalog_items_public_listing_idx
  on public.business_catalog_items (user_id, category, name) where is_active = true and is_published = true;

drop trigger if exists business_storefronts_set_updated_at on public.business_storefronts;
create trigger business_storefronts_set_updated_at before update on public.business_storefronts
for each row execute function public.set_updated_at();

create or replace function public.ensure_business_catalog_public_slug()
returns trigger language plpgsql set search_path = public as $$
declare
  base_slug text;
  candidate text;
  suffix integer := 2;
begin
  if new.is_published and new.public_slug is null then
    perform pg_advisory_xact_lock(hashtextextended('business-product-slug:' || new.user_id::text, 0));
    base_slug := public.normalize_business_storefront_slug(new.name);
    if length(base_slug) < 2 then base_slug := 'producto'; end if;
    candidate := base_slug;
    while exists (
      select 1 from public.business_catalog_items item
      where item.user_id = new.user_id and lower(item.public_slug) = lower(candidate) and item.id <> new.id
    ) loop
      candidate := left(base_slug, 60 - length(suffix::text) - 1) || '-' || suffix::text;
      suffix := suffix + 1;
    end loop;
    new.public_slug := candidate;
  end if;
  return new;
end;
$$;

drop trigger if exists business_catalog_items_public_slug on public.business_catalog_items;
create trigger business_catalog_items_public_slug before insert or update of is_published, public_slug, name
on public.business_catalog_items for each row execute function public.ensure_business_catalog_public_slug();

-- Backfill only previously-published rows, if any. The trigger assigns a stable
-- public slug without changing publication state or business data.
update public.business_catalog_items set public_slug = null
where is_published = true and public_slug is null;

alter table public.business_storefronts enable row level security;

drop policy if exists business_storefronts_select_own on public.business_storefronts;
create policy business_storefronts_select_own on public.business_storefronts for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));
drop policy if exists business_storefronts_insert_own on public.business_storefronts;
create policy business_storefronts_insert_own on public.business_storefronts for insert to authenticated
with check (user_id = auth.uid() and public.has_platform_access(auth.uid()));
drop policy if exists business_storefronts_update_own on public.business_storefronts;
create policy business_storefronts_update_own on public.business_storefronts for update to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()))
with check (user_id = auth.uid() and public.has_platform_access(auth.uid()));
drop policy if exists business_storefronts_admin_all on public.business_storefronts;
create policy business_storefronts_admin_all on public.business_storefronts for all to authenticated
using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
drop policy if exists business_storefronts_public_active on public.business_storefronts;
create policy business_storefronts_public_active on public.business_storefronts for select to anon using (is_active = true);

drop policy if exists business_catalog_items_public_storefront on public.business_catalog_items;
create policy business_catalog_items_public_storefront on public.business_catalog_items for select to anon using (
  is_active = true and is_published = true and public_slug is not null
  and exists (select 1 from public.business_storefronts store where store.user_id = business_catalog_items.user_id and store.is_active = true)
);

revoke all on table public.business_storefronts from anon, authenticated;
grant select, insert, update on table public.business_storefronts to authenticated;
grant select (name, slug, description, logo_url, banner_url, whatsapp, public_email)
  on public.business_storefronts to anon;
grant select (name, category, description, sale_price, image_urls, public_slug)
  on public.business_catalog_items to anon;

create or replace function public.get_public_business_storefront(p_store_slug text)
returns table (store_slug text, store_name text, store_description text, store_logo_url text, store_banner_url text, store_whatsapp text, store_public_email text)
language sql stable security definer set search_path = '' as $$
  select store.slug, store.name, store.description, store.logo_url, store.banner_url, store.whatsapp, store.public_email
  from public.business_storefronts store
  where store.slug = public.normalize_business_storefront_slug(p_store_slug) and store.is_active = true
  limit 1;
$$;

create or replace function public.get_public_business_storefront_products(p_store_slug text)
returns table (product_slug text, product_name text, product_category text, product_description text, product_price numeric, product_image_url text, product_available boolean)
language sql stable security definer set search_path = '' as $$
  select item.public_slug, item.name, item.category, item.description, item.sale_price, item.image_urls[1],
    case when item.source_type = 'resale' then item.resale_stock_quantity > 0 else coalesce(product.stock_quantity, 0) > 0 end
  from public.business_storefronts store
  join public.business_catalog_items item on item.user_id = store.user_id
  left join public.products product on product.id = item.source_product_id and product.user_id = store.user_id
  where store.slug = public.normalize_business_storefront_slug(p_store_slug)
    and store.is_active = true and item.is_active = true and item.is_published = true and item.public_slug is not null
    and (item.source_type = 'resale' or product.is_active = true)
  order by item.category, item.name;
$$;

create or replace function public.get_public_business_storefront_product(p_store_slug text, p_product_slug text)
returns table (product_slug text, product_name text, product_category text, product_description text, product_price numeric, product_image_url text, product_available boolean)
language sql stable security definer set search_path = '' as $$
  select item.public_slug, item.name, item.category, item.description, item.sale_price, item.image_urls[1],
    case when item.source_type = 'resale' then item.resale_stock_quantity > 0 else coalesce(product.stock_quantity, 0) > 0 end
  from public.business_storefronts store
  join public.business_catalog_items item on item.user_id = store.user_id
  left join public.products product on product.id = item.source_product_id and product.user_id = store.user_id
  where store.slug = public.normalize_business_storefront_slug(p_store_slug)
    and item.public_slug = public.normalize_business_storefront_slug(p_product_slug)
    and store.is_active = true and item.is_active = true and item.is_published = true
    and (item.source_type = 'resale' or product.is_active = true)
  limit 1;
$$;

revoke all on function public.get_public_business_storefront(text) from public;
revoke all on function public.get_public_business_storefront_products(text) from public;
revoke all on function public.get_public_business_storefront_product(text, text) from public;
grant execute on function public.get_public_business_storefront(text) to anon, authenticated;
grant execute on function public.get_public_business_storefront_products(text) to anon, authenticated;
grant execute on function public.get_public_business_storefront_product(text, text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-storefront-assets', 'business-storefront-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists business_storefront_assets_public_read on storage.objects;
create policy business_storefront_assets_public_read on storage.objects for select to public
using (bucket_id = 'business-storefront-assets');
drop policy if exists business_storefront_assets_insert_own on storage.objects;
create policy business_storefront_assets_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'business-storefront-assets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists business_storefront_assets_update_own on storage.objects;
create policy business_storefront_assets_update_own on storage.objects for update to authenticated
using (bucket_id = 'business-storefront-assets' and owner_id = auth.uid()::text)
with check (bucket_id = 'business-storefront-assets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists business_storefront_assets_delete_own on storage.objects;
create policy business_storefront_assets_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'business-storefront-assets' and owner_id = auth.uid()::text);

notify pgrst, 'reload schema';
