-- Visibilidad de cursos y talleres de Academia: published | coming_soon | hidden.
--
-- * Reutiliza la columna existente public.courses.status (NO crea columnas). Valores canónicos:
--   'published', 'coming_soon', 'hidden'. Los valores históricos 'draft' y 'archived' se siguen aceptando y la
--   aplicación los interpreta como 'hidden'. Esta migration NO reescribe ninguna fila: ningún curso cambia de
--   estado al aplicarla (no convierte borradores/ocultos en publicados).
-- * Las policies nuevas son RESTRICTIVE (se combinan con AND con las existentes): solo pueden recortar acceso, nunca
--   ampliarlo. Los administradores (public.is_admin) conservan acceso completo. Las policies permissive existentes
--   no se modifican ni se eliminan (el schema base de Academia no está versionado en este repo).
-- * Única policy permissive nueva: lectura de la ficha de cursos 'coming_soon' (catálogo «Próximamente») para
--   usuarios con acceso a la plataforma. Los módulos, clases y recursos de esos cursos quedan bloqueados.
-- * lesson_progress: se bloquean INSERT/UPDATE/DELETE de usuarios comunes sobre cursos no publicados. SELECT queda
--   intacto: el progreso histórico se conserva.
-- * Stampy: los chunks y transcripciones de cursos no publicados dejan de recuperarse para usuarios comunes.
--
-- Depende de: public.courses, course_modules, lessons, lesson_progress, public.is_admin(uuid) y
-- public.has_platform_access(uuid). Segura de re-ejecutar (idempotente). Ver docs/DEPLOY_FEATURE_FLAGS_COURSE_VISIBILITY.md
-- para el orden de aplicación y la reversión.

do $academy_visibility_dependencies$
begin
  if to_regclass('public.courses') is null
     or to_regclass('public.course_modules') is null
     or to_regclass('public.lessons') is null
     or to_regclass('public.lesson_progress') is null then
    raise exception 'Missing dependency: courses, course_modules, lessons and lesson_progress must exist';
  end if;
  if to_regprocedure('public.is_admin(uuid)') is null
     or to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid) and public.has_platform_access(uuid)';
  end if;
end;
$academy_visibility_dependencies$;

-- 1. Valores permitidos de courses.status ---------------------------------------------------------------------
-- Si la columna es un enum se agregan los valores; si hay un CHECK sobre status se reemplaza por uno que acepta
-- los históricos y los nuevos. NOT VALID: no revalida filas existentes (no puede fallar por datos antiguos) y
-- aplica a toda escritura nueva.
do $academy_visibility_status$
declare
  v_udt_schema text;
  v_udt_name text;
  v_data_type text;
  v_constraint record;
begin
  select c.data_type, c.udt_schema, c.udt_name
    into v_data_type, v_udt_schema, v_udt_name
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'courses' and c.column_name = 'status';

  if v_data_type is null then
    raise exception 'Missing column public.courses.status';
  end if;

  if v_data_type = 'USER-DEFINED' then
    execute format('alter type %I.%I add value if not exists %L', v_udt_schema, v_udt_name, 'coming_soon');
    execute format('alter type %I.%I add value if not exists %L', v_udt_schema, v_udt_name, 'hidden');
  end if;

  for v_constraint in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.courses'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
      and con.conname <> 'courses_status_visibility_check'
  loop
    execute format('alter table public.courses drop constraint %I', v_constraint.conname);
  end loop;

  alter table public.courses drop constraint if exists courses_status_visibility_check;
  alter table public.courses
    add constraint courses_status_visibility_check
    check (status::text in ('draft', 'published', 'archived', 'coming_soon', 'hidden')) not valid;
end;
$academy_visibility_status$;

-- 2. Helpers (SECURITY DEFINER, solo lectura, sin recursión de RLS) ---------------------------------------------
create or replace function public.academy_course_is_open(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.status::text = 'published'
  );
$$;

create or replace function public.academy_module_is_open(p_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.course_modules m
    join public.courses c on c.id = m.course_id
    where m.id = p_module_id and c.status::text = 'published'
  );
$$;

create or replace function public.academy_lesson_is_open(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lessons l
    join public.course_modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    where l.id = p_lesson_id and c.status::text = 'published'
  );
$$;

-- Chunk de conocimiento de Stampy: abierto si no depende de un curso o si su curso/clase está publicado.
create or replace function public.academy_chunk_is_open(p_course_id uuid, p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_lesson_id is not null then public.academy_lesson_is_open(p_lesson_id)
    when p_course_id is not null then public.academy_course_is_open(p_course_id)
    else true
  end;
$$;

revoke all on function public.academy_course_is_open(uuid) from public, anon;
revoke all on function public.academy_module_is_open(uuid) from public, anon;
revoke all on function public.academy_lesson_is_open(uuid) from public, anon;
revoke all on function public.academy_chunk_is_open(uuid, uuid) from public, anon;
grant execute on function public.academy_course_is_open(uuid) to authenticated, service_role;
grant execute on function public.academy_module_is_open(uuid) to authenticated, service_role;
grant execute on function public.academy_lesson_is_open(uuid) to authenticated, service_role;
grant execute on function public.academy_chunk_is_open(uuid, uuid) to authenticated, service_role;

-- 3. courses: ficha de «Próximamente» + los ocultos nunca se leen -----------------------------------------------
drop policy if exists courses_coming_soon_catalog_select on public.courses;
create policy courses_coming_soon_catalog_select
on public.courses for select to authenticated
using (status::text = 'coming_soon' and public.has_platform_access(auth.uid()));

drop policy if exists courses_visibility_restrict_select on public.courses;
create policy courses_visibility_restrict_select
on public.courses as restrictive for select to anon, authenticated
using (status::text in ('published', 'coming_soon') or public.is_admin(auth.uid()));

-- Solo administradores cambian la visibilidad (defensa en profundidad: además de la RLS de escritura de courses).
create or replace function public.courses_status_admin_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin(auth.uid()) then
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      raise exception 'Solo los administradores pueden cambiar la visibilidad de un curso'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists courses_status_admin_guard on public.courses;
create trigger courses_status_admin_guard
before insert or update of status on public.courses
for each row execute function public.courses_status_admin_guard();

-- 4. Contenido: módulos, clases y recursos solo de cursos publicados -----------------------------------------------
drop policy if exists course_modules_open_course_restrict_select on public.course_modules;
create policy course_modules_open_course_restrict_select
on public.course_modules as restrictive for select to anon, authenticated
using (public.is_admin(auth.uid()) or public.academy_course_is_open(course_id));

drop policy if exists lessons_open_course_restrict_select on public.lessons;
create policy lessons_open_course_restrict_select
on public.lessons as restrictive for select to anon, authenticated
using (public.is_admin(auth.uid()) or public.academy_module_is_open(module_id));

do $academy_visibility_optional$
begin
  if to_regclass('public.lesson_resources') is not null then
    execute 'drop policy if exists lesson_resources_open_course_restrict_select on public.lesson_resources';
    execute 'create policy lesson_resources_open_course_restrict_select on public.lesson_resources as restrictive for select to anon, authenticated using (public.is_admin(auth.uid()) or public.academy_lesson_is_open(lesson_id))';
  end if;

  if to_regclass('public.lesson_transcripts') is not null then
    execute 'drop policy if exists lesson_transcripts_open_course_restrict_select on public.lesson_transcripts';
    execute 'create policy lesson_transcripts_open_course_restrict_select on public.lesson_transcripts as restrictive for select to anon, authenticated using (public.is_admin(auth.uid()) or public.academy_lesson_is_open(lesson_id))';
  end if;

  if to_regclass('public.lesson_transcript_segments') is not null
     and to_regclass('public.lesson_transcripts') is not null then
    execute 'drop policy if exists lesson_transcript_segments_open_course_restrict_select on public.lesson_transcript_segments';
    execute 'create policy lesson_transcript_segments_open_course_restrict_select on public.lesson_transcript_segments as restrictive for select to anon, authenticated using (public.is_admin(auth.uid()) or exists (select 1 from public.lesson_transcripts t where t.id = transcript_id and public.academy_lesson_is_open(t.lesson_id)))';
  end if;

  if to_regclass('public.stampy_knowledge_chunks') is not null then
    execute 'drop policy if exists stampy_knowledge_chunks_open_course_restrict_select on public.stampy_knowledge_chunks';
    execute 'create policy stampy_knowledge_chunks_open_course_restrict_select on public.stampy_knowledge_chunks as restrictive for select to authenticated using (public.is_admin(auth.uid()) or public.academy_chunk_is_open(course_id, lesson_id))';
  end if;
end;
$academy_visibility_optional$;

-- 5. Progreso: sin escrituras nuevas sobre cursos no publicados; el historial (SELECT) no se toca ---------------------
drop policy if exists lesson_progress_open_course_restrict_insert on public.lesson_progress;
create policy lesson_progress_open_course_restrict_insert
on public.lesson_progress as restrictive for insert to authenticated
with check (public.is_admin(auth.uid()) or public.academy_lesson_is_open(lesson_id));

drop policy if exists lesson_progress_open_course_restrict_update on public.lesson_progress;
create policy lesson_progress_open_course_restrict_update
on public.lesson_progress as restrictive for update to authenticated
using (public.is_admin(auth.uid()) or public.academy_lesson_is_open(lesson_id))
with check (public.is_admin(auth.uid()) or public.academy_lesson_is_open(lesson_id));

drop policy if exists lesson_progress_open_course_restrict_delete on public.lesson_progress;
create policy lesson_progress_open_course_restrict_delete
on public.lesson_progress as restrictive for delete to authenticated
using (public.is_admin(auth.uid()) or public.academy_lesson_is_open(lesson_id));

-- 6. Stampy: la búsqueda semántica excluye chunks de cursos no publicados (usuarios comunes) -----------------------
do $academy_visibility_match$
begin
  if to_regprocedure('public.match_stampy_knowledge_chunks(public.vector, double precision, integer)') is null
     or to_regclass('public.stampy_knowledge_documents') is null then
    raise notice 'match_stampy_knowledge_chunks (versión con documentos) no existe: se omite el filtro de visibilidad de Stampy (migrations de Stampy sin aplicar)';
    return;
  end if;

  execute $fn$
create or replace function public.match_stampy_knowledge_chunks(
  query_embedding public.vector(1536),
  match_threshold double precision,
  match_count integer
)
returns table (
  id uuid,
  source_type text,
  source_id uuid,
  source_key text,
  title text,
  content text,
  route text,
  category text,
  tags text[],
  course_id uuid,
  module_id uuid,
  lesson_id uuid,
  metadata jsonb,
  is_active boolean,
  last_indexed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  similarity double precision
)
language sql
stable
security definer
set search_path = ''
as $body$
  select
    chunk.id,
    chunk.source_type,
    chunk.source_id,
    chunk.source_key,
    chunk.title,
    chunk.content,
    chunk.route,
    chunk.category,
    chunk.tags,
    chunk.course_id,
    chunk.module_id,
    chunk.lesson_id,
    chunk.metadata,
    chunk.is_active,
    chunk.last_indexed_at,
    chunk.created_at,
    chunk.updated_at,
    1 - public.cosine_distance(chunk.embedding, query_embedding) as similarity
  from public.stampy_knowledge_chunks as chunk
  where auth.uid() is not null
    and public.has_platform_access(auth.uid())
    and chunk.is_active = true
    and chunk.embedding is not null
    and 1 - public.cosine_distance(chunk.embedding, query_embedding) >= match_threshold
    and (
      chunk.source_type <> 'knowledge_document'
      or exists (
        select 1
        from public.stampy_knowledge_documents as document
        where document.id = chunk.source_id
          and document.status = 'ready'
          and document.is_active = true
      )
    )
    and (
      public.is_admin(auth.uid())
      or public.academy_chunk_is_open(chunk.course_id, chunk.lesson_id)
    )
  order by public.cosine_distance(chunk.embedding, query_embedding)
  limit greatest(least(coalesce(match_count, 8), 50), 0);
$body$;
$fn$;

  revoke all on function public.match_stampy_knowledge_chunks(public.vector, double precision, integer)
    from public, anon, authenticated;
  grant execute on function public.match_stampy_knowledge_chunks(public.vector, double precision, integer)
    to authenticated, service_role;
end;
$academy_visibility_match$;

notify pgrst, 'reload schema';
