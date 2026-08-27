begin;

do $$
begin
  if to_regclass('public.stampy_action_requests') is null then
    raise exception 'Missing dependency: public.stampy_action_requests';
  end if;
  if to_regclass('public.products') is null then
    raise exception 'Missing dependency: public.products';
  end if;
  if to_regclass('public.product_components') is null then
    raise exception 'Missing dependency: public.product_components';
  end if;
  if to_regclass('public.product_component_filaments') is null then
    raise exception 'Missing dependency: public.product_component_filaments';
  end if;
  if to_regclass('public.filaments') is null then
    raise exception 'Missing dependency: public.filaments';
  end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.has_platform_access(uuid)';
  end if;
  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid)';
  end if;
end;
$$;

-- The product editor already models recipes through product_components and
-- product_component_filaments. These nullable snapshots let Stampy preserve a
-- recipe item even when no active filament can be matched yet.
alter table public.product_component_filaments
  add column if not exists filament_type text,
  add column if not exists brand text,
  add column if not exists name text,
  add column if not exists color text;

alter table public.product_component_filaments
  alter column filament_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.product_component_filaments'::regclass
      and conname = 'product_component_filaments_grams_positive_check'
  ) then
    alter table public.product_component_filaments
      add constraint product_component_filaments_grams_positive_check
      check (grams > 0) not valid;
  end if;
end;
$$;

create index if not exists product_components_product_id_idx
  on public.product_components (product_id);
create index if not exists product_components_user_id_idx
  on public.product_components (user_id);
create index if not exists product_component_filaments_component_id_idx
  on public.product_component_filaments (component_id);
create index if not exists product_component_filaments_user_id_idx
  on public.product_component_filaments (user_id);
create index if not exists product_component_filaments_filament_id_idx
  on public.product_component_filaments (filament_id)
  where filament_id is not null;

alter table public.product_components enable row level security;
alter table public.product_component_filaments enable row level security;

drop policy if exists stampy_product_components_select_own
on public.product_components;
create policy stampy_product_components_select_own
on public.product_components for select to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.products as product
    where product.id = product_components.product_id
      and product.user_id = auth.uid()
  )
);

drop policy if exists stampy_product_components_insert_own
on public.product_components;
create policy stampy_product_components_insert_own
on public.product_components for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.products as product
    where product.id = product_components.product_id
      and product.user_id = auth.uid()
  )
);

drop policy if exists stampy_product_components_update_own
on public.product_components;
create policy stampy_product_components_update_own
on public.product_components for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.products as product
    where product.id = product_components.product_id
      and product.user_id = auth.uid()
  )
);

drop policy if exists stampy_product_components_delete_own
on public.product_components;
create policy stampy_product_components_delete_own
on public.product_components for delete to authenticated
using (user_id = auth.uid());

drop policy if exists stampy_product_components_admin_all
on public.product_components;
create policy stampy_product_components_admin_all
on public.product_components for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists stampy_product_component_filaments_select_own
on public.product_component_filaments;
create policy stampy_product_component_filaments_select_own
on public.product_component_filaments for select to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.product_components as component
    where component.id = product_component_filaments.component_id
      and component.user_id = auth.uid()
  )
);

drop policy if exists stampy_product_component_filaments_insert_own
on public.product_component_filaments;
create policy stampy_product_component_filaments_insert_own
on public.product_component_filaments for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.product_components as component
    where component.id = product_component_filaments.component_id
      and component.user_id = auth.uid()
  )
  and (
    filament_id is null
    or exists (
      select 1 from public.filaments as filament
      where filament.id = product_component_filaments.filament_id
        and filament.user_id = auth.uid()
    )
  )
);

drop policy if exists stampy_product_component_filaments_update_own
on public.product_component_filaments;
create policy stampy_product_component_filaments_update_own
on public.product_component_filaments for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.product_components as component
    where component.id = product_component_filaments.component_id
      and component.user_id = auth.uid()
  )
  and (
    filament_id is null
    or exists (
      select 1 from public.filaments as filament
      where filament.id = product_component_filaments.filament_id
        and filament.user_id = auth.uid()
    )
  )
);

drop policy if exists stampy_product_component_filaments_delete_own
on public.product_component_filaments;
create policy stampy_product_component_filaments_delete_own
on public.product_component_filaments for delete to authenticated
using (user_id = auth.uid());

drop policy if exists stampy_product_component_filaments_admin_all
on public.product_component_filaments;
create policy stampy_product_component_filaments_admin_all
on public.product_component_filaments for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

revoke all on table public.product_components from public, anon;
revoke all on table public.product_component_filaments from public, anon;
grant select, insert, update, delete on table public.product_components
to authenticated;
grant select, insert, update, delete on table public.product_component_filaments
to authenticated;

create or replace function public.confirm_stampy_create_product(
  p_action_request_id uuid
)
returns table (
  success boolean,
  action_request_id uuid,
  product_id uuid,
  product_name text,
  components_count integer,
  unmatched_components_count integer,
  error_code text,
  message text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  action_request public.stampy_action_requests%rowtype;
  product_name_value text;
  normalized_product_name text;
  initial_stock_text text;
  price_text text;
  initial_stock_value integer := 0;
  sale_price_value numeric := 0;
  components_value jsonb := '[]'::jsonb;
  component_value jsonb;
  component_grams_text text;
  component_grams numeric;
  component_material text;
  component_brand text;
  component_name text;
  component_color text;
  requested_filament_id_text text;
  requested_filament_id uuid;
  matched_filament_id uuid;
  matched_filament_type text;
  matched_filament_brand text;
  matched_filament_name text;
  matched_filament_color text;
  fallback_filament_id uuid;
  created_product_id uuid;
  created_component_id uuid;
  duplicate_product_id uuid;
  inserted_components integer := 0;
  unmatched_components integer := 0;
  total_recipe_grams numeric := 0;
  component_index integer := 0;
  updated_requests integer;
  result_message text;
begin
  if current_user_id is null then
    return query select false, p_action_request_id, null::uuid, null::text,
      0, 0, 'unauthenticated'::text,
      'Necesitás iniciar sesión para crear el producto.'::text;
    return;
  end if;

  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, p_action_request_id, null::uuid, null::text,
      0, 0, 'platform_access_required'::text,
      'No tenés acceso habilitado para usar Stampy.'::text;
    return;
  end if;

  select request.*
  into action_request
  from public.stampy_action_requests as request
  where request.id = p_action_request_id
  for update;

  if not found then
    return query select false, p_action_request_id, null::uuid, null::text,
      0, 0, 'action_request_not_found'::text,
      'No encontré una solicitud de creación válida.'::text;
    return;
  end if;

  if action_request.user_id is distinct from current_user_id then
    return query select false, action_request.id, null::uuid, null::text,
      0, 0, 'action_request_forbidden'::text,
      'La solicitud no pertenece al usuario actual.'::text;
    return;
  end if;

  if action_request.status = 'executed' then
    return query select false, action_request.id, null::uuid,
      action_request.extracted ->> 'productName', 0, 0,
      'already_executed'::text,
      'Este producto ya fue creado anteriormente.'::text;
    return;
  end if;

  if action_request.status is null
     or action_request.status not in ('suggested', 'opened_tool') then
    return query select false, action_request.id, null::uuid, null::text,
      0, 0, 'invalid_action_status'::text,
      'La solicitud ya no está pendiente de confirmación.'::text;
    return;
  end if;

  if action_request.can_execute is distinct from false then
    return query select false, action_request.id, null::uuid, null::text,
      0, 0, 'invalid_execution_policy'::text,
      'La solicitud no cumple la política segura de ejecución.'::text;
    return;
  end if;

  if action_request.action_type is distinct from 'create_product' then
    return query select false, action_request.id, null::uuid, null::text,
      0, 0, 'unsupported_action_type'::text,
      'Esta solicitud no corresponde a crear un producto.'::text;
    return;
  end if;

  product_name_value := nullif(btrim(action_request.extracted ->> 'productName'), '');
  if product_name_value is null
     or char_length(product_name_value) < 2
     or char_length(product_name_value) > 160
     or product_name_value !~ '[[:alnum:]]' then
    return query select false, action_request.id, null::uuid, product_name_value,
      0, 0, 'invalid_product_name'::text,
      'La solicitud no tiene un nombre de producto válido.'::text;
    return;
  end if;

  initial_stock_text := nullif(btrim(action_request.extracted ->> 'initialStock'), '');
  if initial_stock_text is not null then
    if initial_stock_text !~ '^\d+$' then
      return query select false, action_request.id, null::uuid, product_name_value,
        0, 0, 'invalid_initial_stock'::text,
        'El stock inicial no es válido.'::text;
      return;
    end if;
    initial_stock_value := initial_stock_text::integer;
  end if;

  if initial_stock_value < 0 or initial_stock_value > 100000000 then
    return query select false, action_request.id, null::uuid, product_name_value,
      0, 0, 'invalid_initial_stock'::text,
      'El stock inicial está fuera del rango permitido.'::text;
    return;
  end if;

  price_text := nullif(btrim(action_request.extracted ->> 'price'), '');
  if price_text is not null then
    if price_text !~ '^\d+(\.\d+)?$' then
      return query select false, action_request.id, null::uuid, product_name_value,
        0, 0, 'invalid_price'::text,
        'El precio indicado no es válido.'::text;
      return;
    end if;
    sale_price_value := price_text::numeric;
  end if;

  if sale_price_value < 0 or sale_price_value > 1000000000000 then
    return query select false, action_request.id, null::uuid, product_name_value,
      0, 0, 'invalid_price'::text,
      'El precio indicado está fuera del rango permitido.'::text;
    return;
  end if;

  if action_request.extracted ? 'components' then
    if jsonb_typeof(action_request.extracted -> 'components') <> 'array' then
      return query select false, action_request.id, null::uuid, product_name_value,
        0, 0, 'invalid_components'::text,
        'La receta de filamentos no tiene un formato válido.'::text;
      return;
    end if;
    components_value := action_request.extracted -> 'components';
  end if;

  if jsonb_array_length(components_value) > 20 then
    return query select false, action_request.id, null::uuid, product_name_value,
      0, 0, 'too_many_components'::text,
      'La receta supera el máximo de 20 componentes.'::text;
    return;
  end if;

  normalized_product_name := btrim(regexp_replace(
    translate(lower(product_name_value), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+', ' ', 'g'
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(current_user_id::text),
    pg_catalog.hashtext('stampy_create_product')
  );

  select product.id
  into duplicate_product_id
  from public.products as product
  where product.user_id = current_user_id
    and product.is_active = true
    and (
      btrim(regexp_replace(
        translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
        '[^a-z0-9]+', ' ', 'g'
      )) = normalized_product_name
      or position(
        normalized_product_name in btrim(regexp_replace(
          translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
          '[^a-z0-9]+', ' ', 'g'
        ))
      ) > 0
      or position(
        btrim(regexp_replace(
          translate(lower(product.name), 'áéíóúüñ', 'aeiouun'),
          '[^a-z0-9]+', ' ', 'g'
        )) in normalized_product_name
      ) > 0
    )
  order by product.created_at asc
  limit 1
  for update;

  if duplicate_product_id is not null then
    return query select false, action_request.id, duplicate_product_id,
      product_name_value, 0, 0, 'duplicate_product'::text,
      'Ya existe un producto parecido. Abrí Productos o Stock para revisarlo.'::text;
    return;
  end if;

  -- Revalidate every pre-resolved filament against the authenticated owner.
  for component_value in
    select value from jsonb_array_elements(components_value)
  loop
    component_grams_text := nullif(btrim(component_value ->> 'grams'), '');
    component_material := nullif(btrim(component_value ->> 'material'), '');
    component_brand := nullif(btrim(component_value ->> 'brand'), '');
    component_name := nullif(btrim(component_value ->> 'name'), '');
    component_color := nullif(btrim(component_value ->> 'color'), '');

    if component_grams_text is null
       or component_grams_text !~ '^\d+(\.\d+)?$' then
      return query select false, action_request.id, null::uuid,
        product_name_value, 0, 0, 'invalid_component_grams'::text,
        'Uno de los componentes no tiene gramos válidos.'::text;
      return;
    end if;
    component_grams := component_grams_text::numeric;
    if component_grams <= 0 or component_grams > 99999999.99 then
      return query select false, action_request.id, null::uuid,
        product_name_value, 0, 0, 'invalid_component_grams'::text,
        'Los gramos de la receta están fuera del rango permitido.'::text;
      return;
    end if;
    if component_material is null or char_length(component_material) > 100 then
      return query select false, action_request.id, null::uuid,
        product_name_value, 0, 0, 'invalid_component_material'::text,
        'Uno de los componentes no tiene un material válido.'::text;
      return;
    end if;
    if char_length(coalesce(component_brand, '')) > 100
       or char_length(coalesce(component_name, '')) > 100
       or char_length(coalesce(component_color, '')) > 100 then
      return query select false, action_request.id, null::uuid,
        product_name_value, 0, 0, 'invalid_component_fields'::text,
        'Los datos de uno de los componentes son demasiado largos.'::text;
      return;
    end if;

    requested_filament_id_text := nullif(btrim(component_value ->> 'filamentId'), '');
    requested_filament_id := null;
    matched_filament_id := null;
    matched_filament_type := null;
    matched_filament_brand := null;
    matched_filament_name := null;
    matched_filament_color := null;

    if requested_filament_id_text is not null
       and requested_filament_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      requested_filament_id := requested_filament_id_text::uuid;
      select
        filament.id,
        filament.filament_type,
        filament.brand,
        filament.name,
        filament.color
      into
        matched_filament_id,
        matched_filament_type,
        matched_filament_brand,
        matched_filament_name,
        matched_filament_color
      from public.filaments as filament
      where filament.id = requested_filament_id
        and filament.user_id = current_user_id
        and filament.is_active = true
      for update;
    end if;

    if matched_filament_id is null then
      unmatched_components := unmatched_components + 1;
    elsif fallback_filament_id is null then
      fallback_filament_id := matched_filament_id;
    end if;
    total_recipe_grams := total_recipe_grams + component_grams;
  end loop;

  insert into public.products as product (
    user_id,
    name,
    description,
    image_url,
    filament_id,
    grams,
    print_time_minutes,
    base_cost,
    sale_price,
    stock_quantity,
    is_active
  ) values (
    current_user_id,
    product_name_value,
    '',
    '',
    fallback_filament_id,
    total_recipe_grams,
    0,
    0,
    sale_price_value,
    initial_stock_value,
    true
  )
  returning product.id into created_product_id;

  if jsonb_array_length(components_value) > 0 then
    insert into public.product_components as component (
      user_id,
      product_id,
      name,
      quantity_per_product,
      stock_quantity,
      sort_order,
      is_active
    ) values (
      current_user_id,
      created_product_id,
      'Producto completo',
      1,
      0,
      0,
      true
    )
    returning component.id into created_component_id;

    for component_value in
      select value from jsonb_array_elements(components_value)
    loop
      component_grams := (component_value ->> 'grams')::numeric;
      component_material := nullif(btrim(component_value ->> 'material'), '');
      component_brand := nullif(btrim(component_value ->> 'brand'), '');
      component_name := nullif(btrim(component_value ->> 'name'), '');
      component_color := nullif(btrim(component_value ->> 'color'), '');
      requested_filament_id_text := nullif(btrim(component_value ->> 'filamentId'), '');
      matched_filament_id := null;

      if requested_filament_id_text is not null
         and requested_filament_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        select filament.id
        into matched_filament_id
        from public.filaments as filament
        where filament.id = requested_filament_id_text::uuid
          and filament.user_id = current_user_id
          and filament.is_active = true;
      end if;

      insert into public.product_component_filaments (
        user_id,
        component_id,
        filament_id,
        filament_type,
        brand,
        name,
        color,
        grams,
        sort_order
      ) values (
        current_user_id,
        created_component_id,
        matched_filament_id,
        component_material,
        component_brand,
        component_name,
        component_color,
        component_grams,
        component_index
      );

      component_index := component_index + 1;
      inserted_components := inserted_components + 1;
    end loop;
  end if;

  update public.stampy_action_requests as request
  set
    status = 'executed',
    executed_at = now(),
    updated_at = now(),
    can_execute = false
  where request.id = action_request.id
    and request.user_id = current_user_id
    and request.status in ('suggested', 'opened_tool')
    and request.can_execute = false;

  get diagnostics updated_requests = row_count;
  if updated_requests <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'Could not mark the Stampy action request as executed';
  end if;

  result_message := format('Listo, creé el producto %s.', product_name_value);
  if inserted_components > 0 then
    result_message := result_message || format(
      ' También guardé %s componente(s) de filamento.',
      inserted_components
    );
  end if;
  if unmatched_components > 0 then
    result_message := result_message || format(
      ' %s componente(s) quedaron sin filamento exacto asociado.',
      unmatched_components
    );
  end if;

  return query select true, action_request.id, created_product_id,
    product_name_value, inserted_components, unmatched_components,
    null::text, result_message;
end;
$$;

revoke all on function public.confirm_stampy_create_product(uuid)
from public, anon, authenticated;

grant execute on function public.confirm_stampy_create_product(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
