-- Restore the minimum table privileges required by the server-only calculator catalog API.
-- The service_role key remains server-side and the API returns a narrow DTO.

do $calculator_catalog_dependencies$
begin
  if to_regclass('public.printer_templates') is null then
    raise exception 'Missing dependency: public.printer_templates';
  end if;
  if to_regclass('public.filament_templates') is null then
    raise exception 'Missing dependency: public.filament_templates';
  end if;
end;
$calculator_catalog_dependencies$;

grant select on table public.printer_templates to service_role;
grant select on table public.filament_templates to service_role;

notify pgrst, 'reload schema';
