-- Versionado de tutoriales (docs/TUTORIALS.md).
--
-- `seen_version` guarda la versión del tutorial que la persona ya vio. Las filas existentes quedan en 1, que es la
-- versión inicial de todos los tutoriales: nadie que ya cerró una guía la vuelve a ver por este cambio. Subir la versión
-- de un tutorial en `src/lib/tutorials/definitions` la vuelve a mostrar solo a quienes vieron una anterior.
--
-- La tabla `user_tool_tutorial_views` se creó fuera de las migrations del repo; por eso la columna se agrega solo si la
-- tabla existe (en una base nueva sin ella no hace nada). El código tolera que esta migration no esté aplicada todavía
-- (lee/escribe sin la columna y usa un respaldo local por usuario).
-- No modifica RLS: la columna hereda las políticas de la tabla.

do $$
begin
  if to_regclass('public.user_tool_tutorial_views') is not null then
    alter table public.user_tool_tutorial_views
      add column if not exists seen_version integer not null default 1;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.user_tool_tutorial_views'::regclass
        and conname = 'user_tool_tutorial_views_seen_version_positive'
    ) then
      alter table public.user_tool_tutorial_views
        add constraint user_tool_tutorial_views_seen_version_positive check (seen_version >= 1);
    end if;
  end if;
end
$$;
