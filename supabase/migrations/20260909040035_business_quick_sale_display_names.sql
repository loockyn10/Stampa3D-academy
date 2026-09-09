-- Preserve a descriptive brand + product name snapshot for future quick sales.
-- Historical sale and order snapshots are intentionally left untouched.

do $$
begin
  if to_regclass('public.business_catalog_items') is null then
    raise exception 'Missing dependency: public.business_catalog_items';
  end if;
  if to_regclass('public.business_sales') is null then
    raise exception 'Missing dependency: public.business_sales';
  end if;
  if to_regclass('public.business_sale_items') is null then
    raise exception 'Missing dependency: public.business_sale_items';
  end if;
end
$$;

create or replace function public.business_catalog_display_name(p_name text, p_brand text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p_brand, '')), '') is null then btrim(coalesce(p_name, ''))
    when position(lower(btrim(p_brand)) in lower(btrim(coalesce(p_name, '')))) > 0 then btrim(p_name)
    else btrim(p_brand) || ' ' || btrim(coalesce(p_name, ''))
  end
$$;

create or replace function public.set_business_quick_sale_item_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_order_id uuid;
  catalog_name text;
  catalog_brand text;
begin
  select sale.order_id into source_order_id
  from public.business_sales sale
  where sale.id = new.sale_id;

  if not found or source_order_id is not null then
    return new;
  end if;

  select item.name, item.brand into catalog_name, catalog_brand
  from public.business_catalog_items item
  where item.id = new.catalog_item_id
    and item.user_id = new.user_id;

  if found then
    new.product_name_snapshot := public.business_catalog_display_name(catalog_name, catalog_brand);
  end if;

  return new;
end;
$$;

drop trigger if exists business_sale_items_quick_sale_display_name on public.business_sale_items;
create trigger business_sale_items_quick_sale_display_name
before insert on public.business_sale_items
for each row execute function public.set_business_quick_sale_item_display_name();

revoke all on function public.business_catalog_display_name(text, text) from public, anon, authenticated;
revoke all on function public.set_business_quick_sale_item_display_name() from public, anon, authenticated;

notify pgrst, 'reload schema';
