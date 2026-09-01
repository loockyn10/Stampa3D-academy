begin;

do $$
begin
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
  if to_regprocedure('public.adjust_filament_stock(uuid,numeric,text,text,text,uuid)') is null then
    raise exception 'Missing dependency: public.adjust_filament_stock(uuid,numeric,text,text,text,uuid)';
  end if;
  if not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'adjust_component_stock'
  ) then
    raise exception 'Missing dependency: public.adjust_component_stock';
  end if;
  if not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'consume_filaments_for_products'
  ) then
    raise exception 'Missing dependency: public.consume_filaments_for_products';
  end if;
end;
$$;

create or replace function public.consume_filaments_for_components(
  p_items jsonb,
  p_reason text default 'Producción de componentes registrada desde stock',
  p_add_to_component_stock boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_items jsonb := '[]'::jsonb;
  consumption_totals jsonb := '{}'::jsonb;
  raw_item jsonb;
  item_record record;
  recipe_record record;
  consumption_record record;
  target_component public.product_components%rowtype;
  target_filament public.filaments%rowtype;
  product_id_text text;
  component_id_text text;
  quantity_text text;
  component_quantity integer;
  recipe_rows integer;
  required_grams numeric;
  previous_remaining numeric;
  expected_remaining numeric;
  resulting_remaining numeric;
  previous_component_stock integer;
  expected_component_stock integer;
  resulting_component_stock integer;
  processed_components integer := 0;
  processed_filaments integer := 0;
  consumed_grams numeric := 0;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if public.has_platform_access(current_user_id) is distinct from true then
    raise exception using errcode = '42501', message = 'Platform access required';
  end if;
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'No se recibieron componentes para producir.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception using errcode = '22023', message = 'Se recibieron demasiados componentes en una sola operación.';
  end if;

  -- Validate the untrusted JSON before casting it, then aggregate duplicate
  -- targets so each component stock is adjusted exactly once.
  for raw_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(raw_item) <> 'object' then
      raise exception using errcode = '22023', message = 'El formato de un componente no es válido.';
    end if;
    product_id_text := nullif(btrim(raw_item ->> 'product_id'), '');
    component_id_text := nullif(btrim(raw_item ->> 'component_id'), '');
    quantity_text := nullif(btrim(raw_item ->> 'quantity'), '');

    if product_id_text is null
       or product_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or component_id_text is null
       or component_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or quantity_text is null
       or quantity_text !~ '^\d+$' then
      raise exception using errcode = '22023', message = 'El producto, componente o cantidad no es válido.';
    end if;

    component_quantity := quantity_text::integer;
    if component_quantity <= 0 or component_quantity > 100000 then
      raise exception using errcode = '22023', message = 'La cantidad a producir está fuera del rango permitido.';
    end if;

    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object(
      'product_id', product_id_text,
      'component_id', component_id_text,
      'quantity', component_quantity
    ));
  end loop;

  -- Lock component/product and recipe rows in deterministic order, enforce
  -- ownership and build the total required stock before the first mutation.
  for item_record in
    select
      item.product_id,
      item.component_id,
      sum(item.quantity)::integer as quantity
    from jsonb_to_recordset(normalized_items) as item(
      product_id uuid,
      component_id uuid,
      quantity integer
    )
    group by item.product_id, item.component_id
    order by item.component_id
  loop
    select component.*
    into target_component
    from public.product_components as component
    join public.products as product on product.id = component.product_id
    where component.id = item_record.component_id
      and component.product_id = item_record.product_id
      and component.user_id = current_user_id
      and component.is_active = true
      and product.user_id = current_user_id
      and product.is_active = true
    for update of component, product;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'El componente no existe, no está activo, no pertenece al producto o no pertenece al usuario.';
    end if;

    perform recipe.id
    from public.product_component_filaments as recipe
    where recipe.component_id = target_component.id
      and recipe.user_id = current_user_id
    order by recipe.id
    for update;

    recipe_rows := 0;
    for recipe_record in
      select recipe.id, recipe.filament_id, recipe.grams
      from public.product_component_filaments as recipe
      where recipe.component_id = target_component.id
        and recipe.user_id = current_user_id
      order by recipe.id
    loop
      recipe_rows := recipe_rows + 1;
      if recipe_record.filament_id is null
         or recipe_record.grams is null
         or recipe_record.grams::numeric <= 0 then
        raise exception using
          errcode = '22023',
          message = format('La receta de %s contiene un filamento o cantidad inválida.', target_component.name);
      end if;

      required_grams := recipe_record.grams::numeric * item_record.quantity;
      consumption_totals := jsonb_set(
        consumption_totals,
        array[recipe_record.filament_id::text],
        to_jsonb(
          coalesce((consumption_totals ->> recipe_record.filament_id::text)::numeric, 0)
          + required_grams
        ),
        true
      );
    end loop;

    if recipe_rows = 0 then
      raise exception using
        errcode = '22023',
        message = format('La parte %s no tiene una receta de filamentos configurada.', target_component.name);
    end if;
  end loop;

  -- Lock every affected filament in deterministic order and validate the
  -- aggregate requirement before any stock movement is made.
  for consumption_record in
    select key as filament_id, value::numeric as required_grams
    from jsonb_each_text(consumption_totals)
    order by key
  loop
    select filament.*
    into target_filament
    from public.filaments as filament
    where filament.id = consumption_record.filament_id::uuid
    for update;

    if not found
       or target_filament.user_id is distinct from current_user_id
       or target_filament.is_active is distinct from true then
      raise exception using
        errcode = '42501',
        message = 'Un filamento de la receta no existe, no está activo o no pertenece al usuario.';
    end if;
    if coalesce(target_filament.remaining_grams, 0)::numeric < consumption_record.required_grams then
      raise exception using
        errcode = 'P0001',
        message = format(
          'No alcanza el stock de %s: necesitás %sg y te quedan %sg.',
          coalesce(target_filament.name, target_filament.filament_type, 'filamento'),
          consumption_record.required_grams,
          coalesce(target_filament.remaining_grams, 0)
        );
    end if;
    processed_filaments := processed_filaments + 1;
    consumed_grams := consumed_grams + consumption_record.required_grams;
  end loop;

  -- Apply one traceable movement per component recipe line. Any exception in
  -- this function or the delegated RPCs rolls back every previous movement.
  for item_record in
    select
      item.product_id,
      item.component_id,
      sum(item.quantity)::integer as quantity
    from jsonb_to_recordset(normalized_items) as item(
      product_id uuid,
      component_id uuid,
      quantity integer
    )
    group by item.product_id, item.component_id
    order by item.component_id
  loop
    select component.*
    into target_component
    from public.product_components as component
    where component.id = item_record.component_id;

    for recipe_record in
      select recipe.filament_id, recipe.grams
      from public.product_component_filaments as recipe
      where recipe.component_id = target_component.id
        and recipe.user_id = current_user_id
      order by recipe.id
    loop
      required_grams := recipe_record.grams::numeric * item_record.quantity;
      select filament.remaining_grams::numeric
      into previous_remaining
      from public.filaments as filament
      where filament.id = recipe_record.filament_id;
      expected_remaining := previous_remaining - required_grams;

      perform public.adjust_filament_stock(
        p_filament_id => recipe_record.filament_id,
        p_grams_delta => -required_grams,
        p_movement_type => 'manual_subtract',
        p_reason => coalesce(nullif(btrim(p_reason), ''), 'Producción de componente')
          || format(': %s', target_component.name),
        p_source_type => 'product_component',
        p_source_id => target_component.id
      );

      select filament.remaining_grams::numeric
      into resulting_remaining
      from public.filaments as filament
      where filament.id = recipe_record.filament_id;
      if resulting_remaining is distinct from expected_remaining then
        raise exception using
          errcode = 'P0001',
          message = 'adjust_filament_stock no actualizó el stock esperado.';
      end if;
    end loop;

    if p_add_to_component_stock then
      previous_component_stock := coalesce(target_component.stock_quantity, 0);
      expected_component_stock := previous_component_stock + item_record.quantity;

      perform public.adjust_component_stock(
        p_component_id => target_component.id,
        p_quantity_delta => item_record.quantity,
        p_movement_type => 'manual_add',
        p_reason => coalesce(nullif(btrim(p_reason), ''), 'Producción de componente')
          || format(': %s', target_component.name),
        p_source_type => 'manual',
        p_source_id => null::uuid
      );

      select coalesce(component.stock_quantity, 0)
      into resulting_component_stock
      from public.product_components as component
      where component.id = target_component.id;
      if resulting_component_stock is distinct from expected_component_stock then
        raise exception using
          errcode = 'P0001',
          message = 'adjust_component_stock no actualizó el stock esperado.';
      end if;
    end if;

    processed_components := processed_components + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'componentsCount', processed_components,
    'filamentsCount', processed_filaments,
    'consumedGrams', consumed_grams
  );
end;
$$;

create or replace function public.consume_filaments_for_production_targets(
  p_product_items jsonb default '[]'::jsonb,
  p_component_items jsonb default '[]'::jsonb,
  p_reason text default 'Producción registrada desde stock',
  p_add_to_stock boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  component_result jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if jsonb_typeof(coalesce(p_product_items, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_component_items, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'El formato de producción no es válido.';
  end if;
  if jsonb_array_length(coalesce(p_product_items, '[]'::jsonb)) = 0
     and jsonb_array_length(coalesce(p_component_items, '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'No se recibieron productos ni componentes para producir.';
  end if;

  if jsonb_array_length(coalesce(p_product_items, '[]'::jsonb)) > 0 then
    perform public.consume_filaments_for_products(
      p_items => p_product_items,
      p_reason => p_reason,
      p_add_to_product_stock => p_add_to_stock
    );
  end if;

  if jsonb_array_length(coalesce(p_component_items, '[]'::jsonb)) > 0 then
    component_result := public.consume_filaments_for_components(
      p_items => p_component_items,
      p_reason => p_reason,
      p_add_to_component_stock => p_add_to_stock
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'productTargets', jsonb_array_length(coalesce(p_product_items, '[]'::jsonb)),
    'componentTargets', jsonb_array_length(coalesce(p_component_items, '[]'::jsonb)),
    'componentResult', component_result
  );
end;
$$;

revoke all on function public.consume_filaments_for_components(jsonb, text, boolean)
from public, anon;
grant execute on function public.consume_filaments_for_components(jsonb, text, boolean)
to authenticated;

revoke all on function public.consume_filaments_for_production_targets(jsonb, jsonb, text, boolean)
from public, anon;
grant execute on function public.consume_filaments_for_production_targets(jsonb, jsonb, text, boolean)
to authenticated;

notify pgrst, 'reload schema';

commit;
