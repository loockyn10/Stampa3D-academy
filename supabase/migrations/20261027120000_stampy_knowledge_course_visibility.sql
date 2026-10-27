-- Stampy: visibilidad de cursos también en la búsqueda de conocimiento con filtros (sobrecarga de 5 argumentos).
--
-- La base remota tiene dos sobrecargas de public.match_stampy_knowledge_chunks:
--   (query_embedding, match_threshold, match_count)                                        -- usada por retrieval.ts
--   (query_embedding, match_count, filter_source_type, filter_course_id, filter_lesson_id) -- no versionada hasta hoy
-- La segunda es SECURITY DEFINER, la ejecutaban anon y authenticated y no verificaba el estado del curso: devolvía
-- fragmentos de cursos coming_soon / hidden / draft / archived. Esta migration:
--   * crea el helper academy_chunk_is_visible(source_type, course_id, module_id, lesson_id) con una regla única;
--   * reemplaza la sobrecarga de 5 argumentos conservando firma, defaults, columnas devueltas, similitud y orden;
--   * alinea la de 3 argumentos y la policy RESTRICTIVE de stampy_knowledge_chunks con la misma regla;
--   * revoca EXECUTE de PUBLIC y anon sobre la de 5 argumentos (ningún código de la app la llama).
-- No borra ni modifica chunks, embeddings, cursos ni clases. Idempotente. Requiere 20261026120000_academy_course_visibility.sql
-- (helpers academy_course_is_open / academy_module_is_open / academy_lesson_is_open).
--
-- Regla de visibilidad de un chunk para usuarios comunes:
--   * sin course_id, module_id ni lesson_id: solo si es no académico (source_type 'stampy_context' o 'knowledge_document');
--     cualquier otro tipo sin curso verificable (course, workshop, module, lesson, lesson_transcript o desconocido) se bloquea;
--   * con vínculos: la clase/módulo/curso vinculados deben existir, ser coherentes entre sí y pertenecer a un curso
--     'published'. coming_soon, hidden, draft, archived y cualquier otro valor se bloquean.
-- Administradores (public.is_admin) y service_role conservan acceso completo.

do $stampy_visibility_dependencies$
begin
  if to_regprocedure('public.academy_course_is_open(uuid)') is null
     or to_regprocedure('public.academy_module_is_open(uuid)') is null
     or to_regprocedure('public.academy_lesson_is_open(uuid)') is null then
    raise exception 'Missing dependency: apply 20261026120000_academy_course_visibility.sql first';
  end if;
  if to_regprocedure('public.is_admin(uuid)') is null
     or to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid) and public.has_platform_access(uuid)';
  end if;
end;
$stampy_visibility_dependencies$;

-- 1. Regla única -------------------------------------------------------------------------------------------------
create or replace function public.academy_chunk_is_visible(
  p_source_type text,
  p_course_id uuid,
  p_module_id uuid,
  p_lesson_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_course_id is null and p_module_id is null and p_lesson_id is null
      then coalesce(p_source_type, '') in ('stampy_context', 'knowledge_document')
    when p_lesson_id is not null
      then exists (
        select 1
        from public.lessons l
        join public.course_modules m on m.id = l.module_id
        join public.courses c on c.id = m.course_id
        where l.id = p_lesson_id
          and c.status::text = 'published'
          and (p_module_id is null or m.id = p_module_id)
          and (p_course_id is null or c.id = p_course_id)
      )
    when p_module_id is not null
      then exists (
        select 1
        from public.course_modules m
        join public.courses c on c.id = m.course_id
        where m.id = p_module_id
          and c.status::text = 'published'
          and (p_course_id is null or c.id = p_course_id)
      )
    else public.academy_course_is_open(p_course_id)
  end;
$$;

revoke all on function public.academy_chunk_is_visible(text, uuid, uuid, uuid) from public, anon;
grant execute on function public.academy_chunk_is_visible(text, uuid, uuid, uuid) to authenticated, service_role;

-- 2. Policy RESTRICTIVE de stampy_knowledge_chunks con la regla única ---------------------------------------------------
do $stampy_visibility_policy$
begin
  if to_regclass('public.stampy_knowledge_chunks') is not null then
    execute 'drop policy if exists stampy_knowledge_chunks_open_course_restrict_select on public.stampy_knowledge_chunks';
    execute 'create policy stampy_knowledge_chunks_open_course_restrict_select on public.stampy_knowledge_chunks as restrictive for select to authenticated using (public.is_admin(auth.uid()) or public.academy_chunk_is_visible(source_type, course_id, module_id, lesson_id))';
  end if;
end;
$stampy_visibility_policy$;

-- 3. Sobrecarga de 3 argumentos (retrieval.ts): misma regla -------------------------------------------------------------
do $stampy_visibility_match3$
declare
  v_signature text;
begin
  select p.oid::regprocedure::text into v_signature
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'match_stampy_knowledge_chunks'
    and p.pronargs = 3
    and p.proargnames[1:3] = array['query_embedding', 'match_threshold', 'match_count'];

  if v_signature is null or to_regclass('public.stampy_knowledge_documents') is null then
    raise notice 'match_stampy_knowledge_chunks (3 argumentos, con documentos) no existe: se omite su alineacion';
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
      or public.academy_chunk_is_visible(chunk.source_type, chunk.course_id, chunk.module_id, chunk.lesson_id)
    )
  order by public.cosine_distance(chunk.embedding, query_embedding)
  limit greatest(least(coalesce(match_count, 8), 50), 0);
$body$;
$fn$;

  execute format('revoke all on function %s from public, anon, authenticated', v_signature);
  execute format('grant execute on function %s to authenticated, service_role', v_signature);
end;
$stampy_visibility_match3$;

-- 4. Sobrecarga de 5 argumentos: filtros opcionales + visibilidad -------------------------------------------------------
-- Conserva nombres de parametros, defaults y columnas devueltas (CREATE OR REPLACE falla si no coinciden en vez de
-- crear una sobrecarga nueva). Similitud y orden: 1 - distancia coseno (operador <=>) y orden por distancia.
-- Quien llama debe ser service_role, administrador o usuario con acceso a la plataforma (como la de 3 argumentos).
do $stampy_visibility_match5$
declare
  v_signature text;
begin
  select p.oid::regprocedure::text into v_signature
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'match_stampy_knowledge_chunks'
    and p.pronargs = 5
    and p.proargnames[1:5] = array['query_embedding', 'match_count', 'filter_source_type', 'filter_course_id', 'filter_lesson_id'];

  if v_signature is null then
    raise notice 'match_stampy_knowledge_chunks (5 argumentos) no existe en esta base: nada que proteger';
    return;
  end if;

  execute $fn$
create or replace function public.match_stampy_knowledge_chunks(
  query_embedding vector,
  match_count integer default 8,
  filter_source_type text default null,
  filter_course_id uuid default null,
  filter_lesson_id uuid default null
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
  similarity double precision
)
language sql
stable
security definer
set search_path to 'public'
as $body$
  with caller as materialized (
    select
      coalesce(auth.role(), '') = 'service_role' as is_service,
      coalesce(public.is_admin(auth.uid()), false) as is_admin,
      (auth.uid() is not null and coalesce(public.has_platform_access(auth.uid()), false)) as has_access
  )
  select
    skc.id,
    skc.source_type,
    skc.source_id,
    skc.source_key,
    skc.title,
    skc.content,
    skc.route,
    skc.category,
    skc.tags,
    skc.course_id,
    skc.module_id,
    skc.lesson_id,
    skc.metadata,
    1 - (skc.embedding <=> query_embedding) as similarity
  from public.stampy_knowledge_chunks as skc
  cross join caller
  where skc.is_active = true
    and skc.embedding is not null
    and (filter_source_type is null or skc.source_type = filter_source_type)
    and (filter_course_id is null or skc.course_id = filter_course_id)
    and (filter_lesson_id is null or skc.lesson_id = filter_lesson_id)
    and (caller.is_service or caller.is_admin or caller.has_access)
    and (
      caller.is_service
      or caller.is_admin
      or public.academy_chunk_is_visible(skc.source_type, skc.course_id, skc.module_id, skc.lesson_id)
    )
  order by skc.embedding <=> query_embedding
  limit coalesce(match_count, 8);
$body$;
$fn$;

  -- Ninguna llamada de la app usa esta sobrecarga con anon; PUBLIC tambien se revoca (EXECUTE se concede a PUBLIC
  -- por defecto, revocar solo a anon no alcanza).
  execute format('revoke all on function %s from public, anon', v_signature);
  execute format('grant execute on function %s to authenticated, service_role', v_signature);
end;
$stampy_visibility_match5$;

notify pgrst, 'reload schema';
