-- Calculadora V2 · D058: contingencias opcionales sobre insumos.
--
-- El recargo automático del 30 % sobre insumos se eliminó del motor de precios (src/lib/calculator/pricing.ts).
-- En su lugar cada usuario puede configurar un porcentaje opcional de contingencias (0 % por defecto) que se
-- aplica SOLO sobre los insumos (insumos extra del tipo + catálogo de componentes/embalaje).
--
-- Aditiva e idempotente: agrega una columna con default 0 a public.calculator_settings (tabla previa al
-- historial versionado). No cambia RLS, policies ni datos existentes: las filas actuales quedan en 0 %.
-- No recalcula productos, presupuestos ni ventas guardados.

do $calculator_contingency_dependencies$
begin
  if to_regclass('public.calculator_settings') is null then
    raise exception 'Missing dependency: public.calculator_settings';
  end if;
end;
$calculator_contingency_dependencies$;

alter table public.calculator_settings
  add column if not exists supplies_contingency_percent numeric(5, 2) not null default 0;

do $calculator_contingency_range$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'calculator_settings_supplies_contingency_percent_range'
      and conrelid = 'public.calculator_settings'::regclass
  ) then
    alter table public.calculator_settings
      add constraint calculator_settings_supplies_contingency_percent_range
      check (supplies_contingency_percent >= 0 and supplies_contingency_percent <= 100);
  end if;
end;
$calculator_contingency_range$;

comment on column public.calculator_settings.supplies_contingency_percent is
  'Contingencias opcionales (0–100 %) sobre insumos extra y catálogo de insumos. Reemplaza el recargo fijo del 30 % (D058).';

-- La tabla ya concede select/insert/update a authenticated; el grant por columna es redundante pero explícito
-- por si la tabla usa grants por columna. Las policies propias + la restrictiva de acceso pago siguen vigentes.
grant select, insert, update (supplies_contingency_percent) on public.calculator_settings to authenticated;

notify pgrst, 'reload schema';
