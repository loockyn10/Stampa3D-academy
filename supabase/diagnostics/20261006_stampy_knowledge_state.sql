-- STAMPY KNOWLEDGE / RETRIEVAL — READ-ONLY DIAGNOSTIC (2026-10-06)
--
-- Pegá el archivo COMPLETO en el SQL Editor de Supabase y ejecutalo. Es un único SELECT:
-- no crea, modifica ni borra nada. Devuelve una grilla (section | item | detail) con conteos,
-- estados y metadatos. No devuelve texto de transcripciones, documentos, memorias ni mensajes.
--
-- Columnas que pueden no existir (p. ej. lessons.is_published) se leen vía to_jsonb(row)->>'col'
-- para que el script no falle. Tablas que pueden no existir se chequean sólo con to_regclass.

with
lesson_rows as (
  select
    l.id,
    l.module_id,
    coalesce((to_jsonb(l)->>'is_active')::boolean, false) as is_active,
    to_jsonb(l)->>'is_published' as is_published,
    coalesce((to_jsonb(l)->>'is_ai_recommendable')::boolean, true) as is_ai_recommendable,
    nullif(btrim(coalesce(to_jsonb(l)->>'ai_summary', '')), '') is not null as has_summary,
    case when jsonb_typeof(to_jsonb(l)->'ai_topics') = 'array'
      then jsonb_array_length(to_jsonb(l)->'ai_topics') > 0 else false end as has_topics,
    case when jsonb_typeof(to_jsonb(l)->'ai_problems') = 'array'
      then jsonb_array_length(to_jsonb(l)->'ai_problems') > 0 else false end as has_problems,
    to_jsonb(l)->>'ai_level' as ai_level,
    nullif(btrim(coalesce(to_jsonb(l)->>'ai_related_tool', '')), '') is not null as has_related_tool,
    nullif(btrim(coalesce(to_jsonb(l)->>'video_url', '')), '') is not null as has_video,
    length(btrim(coalesce(to_jsonb(l)->>'description', ''))) as description_chars
  from public.lessons l
),
lesson_ctx as (
  select
    lr.*,
    (lr.is_active and coalesce(m.is_active, false) and c.status = 'published') as reachable,
    c.status as course_status
  from lesson_rows lr
  left join public.course_modules m on m.id = lr.module_id
  left join public.courses c on c.id = m.course_id
),
chunks as (
  select
    k.id, k.source_type, k.source_id, k.lesson_id, k.course_id, k.is_active,
    k.embedding is not null as has_embedding,
    case when k.embedding is null then null else vector_dims(k.embedding) end as dims,
    length(k.content) as content_chars,
    k.last_indexed_at
  from public.stampy_knowledge_chunks k
),
ready_transcripts as (
  select t.lesson_id
  from public.lesson_transcripts t
  where t.status = 'ready' and nullif(btrim(coalesce(t.transcript_text, '')), '') is not null
),
rows_all as (

  -- A) Esquema y funciones
  select 'A_schema' as section, 'extension vector' as item,
    coalesce((select 'installed v' || extversion || ' in schema ' || extnamespace::regnamespace::text from pg_extension where extname = 'vector'), 'NOT INSTALLED') as detail
  union all
  select 'A_schema', 'table ' || t.name,
    case when to_regclass('public.' || t.name) is null then 'MISSING' else 'exists' end
  from (values ('lessons'), ('lesson_transcripts'), ('lesson_transcript_segments'), ('stampy_knowledge_chunks'),
               ('stampy_knowledge_documents'), ('stampy_page_contexts'), ('stampy_user_memory')) as t(name)
  union all
  select 'A_schema', 'lessons column ' || col,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'lessons' and column_name = col
    ) then 'exists' else 'MISSING' end
  from unnest(array['is_published', 'is_active', 'ai_summary', 'ai_topics', 'ai_problems', 'ai_level',
                    'ai_related_tool', 'is_ai_recommendable', 'video_url', 'description']) as col
  union all
  select 'A_schema', 'courses column slug',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'courses' and column_name = 'slug'
    ) then 'exists' else 'MISSING' end
  union all
  select 'A_schema', 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end
      || ' | uses <=> operator: ' || (pg_get_functiondef(p.oid) like '%<=>%')::text
      || ' | requires auth.uid(): ' || (pg_get_functiondef(p.oid) ilike '%auth.uid() is not null%')::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('match_stampy_knowledge_chunks', 'replace_stampy_knowledge_document_chunks', 'save_stampy_user_memory')
  union all
  select 'A_schema', 'index ' || indexname, indexdef
  from pg_indexes
  where schemaname = 'public' and tablename = 'stampy_knowledge_chunks'

  -- B) Clases y metadata IA
  union all select 'B_lessons', 'total', count(*)::text from lesson_ctx
  union all select 'B_lessons', 'is_active', count(*) filter (where is_active)::text from lesson_ctx
  union all select 'B_lessons', 'reachable (active + module active + course published)', count(*) filter (where reachable)::text from lesson_ctx
  union all select 'B_lessons', 'is_published distribution', coalesce(string_agg(v || '=' || n, ', '), 'n/a') from (
    select coalesce(is_published, 'null/missing') as v, count(*)::text as n from lesson_ctx group by 1) s
  union all select 'B_lessons', 'is_ai_recommendable=false', count(*) filter (where not is_ai_recommendable)::text from lesson_ctx
  union all select 'B_lessons', 'reachable with ai_summary', count(*) filter (where reachable and has_summary)::text from lesson_ctx
  union all select 'B_lessons', 'reachable with ai_topics', count(*) filter (where reachable and has_topics)::text from lesson_ctx
  union all select 'B_lessons', 'reachable with ai_problems', count(*) filter (where reachable and has_problems)::text from lesson_ctx
  union all select 'B_lessons', 'reachable with ai_related_tool', count(*) filter (where reachable and has_related_tool)::text from lesson_ctx
  union all select 'B_lessons', 'reachable with video_url', count(*) filter (where reachable and has_video)::text from lesson_ctx
  union all select 'B_lessons', 'reachable with description >= 40 chars', count(*) filter (where reachable and description_chars >= 40)::text from lesson_ctx
  union all select 'B_lessons', 'reachable with NO ai field and NO description', count(*) filter (where reachable and not has_summary and not has_topics and not has_problems and description_chars <= 10)::text from lesson_ctx
  union all select 'B_lessons', 'ai_level distribution', coalesce(string_agg(v || '=' || n, ', '), '') from (
    select coalesce(ai_level, 'null') as v, count(*)::text as n from lesson_ctx group by 1) s
  union all select 'B_lessons', 'eligible for lesson recommendations (active+published+recommendable+module+course)',
    count(*) filter (where reachable and is_ai_recommendable and is_published = 'true')::text from lesson_ctx

  -- C) Transcripciones
  union all select 'C_transcripts', 'total rows', count(*)::text from public.lesson_transcripts
  union all select 'C_transcripts', 'by status', coalesce(string_agg(status || '=' || n, ', '), '') from (
    select status, count(*)::text as n from public.lesson_transcripts group by 1) s
  union all select 'C_transcripts', 'by source_type', coalesce(string_agg(source_type || '=' || n, ', '), '') from (
    select source_type, count(*)::text as n from public.lesson_transcripts group by 1) s
  union all select 'C_transcripts', 'by provider', coalesce(string_agg(coalesce(provider, 'null') || '=' || n, ', '), '') from (
    select provider, count(*)::text as n from public.lesson_transcripts group by 1) s
  union all select 'C_transcripts', 'with transcript_text (chars min/avg/max)',
    count(*) filter (where nullif(btrim(coalesce(transcript_text, '')), '') is not null)::text
      || ' (' || coalesce(min(length(transcript_text))::text, '-') || '/' || coalesce(round(avg(length(transcript_text)))::text, '-') || '/' || coalesce(max(length(transcript_text))::text, '-') || ')'
    from public.lesson_transcripts
  union all select 'C_transcripts', 'ready on reachable lessons',
    count(*)::text from public.lesson_transcripts t join lesson_ctx l on l.id = t.lesson_id where t.status = 'ready' and l.reachable
  union all select 'C_transcripts', 'with segments_count > 0', count(*) filter (where segments_count > 0)::text from public.lesson_transcripts
  union all select 'C_transcripts', 'with duration_seconds', count(*) filter (where duration_seconds is not null)::text from public.lesson_transcripts
  union all select 'C_transcripts', 'segments total / with start_seconds',
    count(*)::text || ' / ' || count(*) filter (where start_seconds is not null)::text from public.lesson_transcript_segments
  union all select 'C_transcripts', 'segments_count mismatch vs real segments',
    count(*)::text from public.lesson_transcripts t
    where t.segments_count <> (select count(*) from public.lesson_transcript_segments s where s.transcript_id = t.id)

  -- D) Chunks y embeddings
  union all select 'D_chunks', 'total', count(*)::text from chunks
  union all select 'D_chunks', 'by source_type (active/total)', coalesce(string_agg(source_type || '=' || a || '/' || n, ', '), '') from (
    select source_type, count(*) filter (where is_active)::text as a, count(*)::text as n from chunks group by 1) s
  union all select 'D_chunks', 'without embedding', count(*) filter (where not has_embedding)::text from chunks
  union all select 'D_chunks', 'embedding dims', coalesce(string_agg(distinct dims::text, ', '), '-') from chunks
  union all select 'D_chunks', 'content chars by type (min/avg/max)', coalesce(string_agg(source_type || ' ' || mn || '/' || av || '/' || mx, ', '), '') from (
    select source_type, min(content_chars)::text mn, round(avg(content_chars))::text av, max(content_chars)::text mx from chunks group by 1) s
  union all select 'D_chunks', 'last_indexed_at range by type', coalesce(string_agg(source_type || ' ' || mn || ' -> ' || mx, ' | '), '') from (
    select source_type, min(last_indexed_at)::date::text mn, max(last_indexed_at)::date::text mx from chunks group by 1) s
  union all select 'D_chunks', 'reachable lessons with a lesson chunk',
    count(distinct l.id)::text from lesson_ctx l join chunks k on k.source_type = 'lesson' and k.lesson_id = l.id where l.reachable
  union all select 'D_chunks', 'reachable lessons with transcript chunks',
    count(distinct l.id)::text from lesson_ctx l join chunks k on k.source_type = 'lesson_transcript' and k.lesson_id = l.id where l.reachable

  -- E) Desincronización (chunks activos que ya no deberían recuperarse, y faltantes)
  union all select 'E_stale', 'active lesson/transcript chunks of NON-reachable lessons',
    count(*)::text from chunks k join lesson_ctx l on l.id = k.lesson_id
    where k.is_active and k.source_type in ('lesson', 'lesson_transcript') and not l.reachable
  union all select 'E_stale', 'active lesson chunks of lessons with is_ai_recommendable=false',
    count(*)::text from chunks k join lesson_ctx l on l.id = k.lesson_id
    where k.is_active and k.source_type = 'lesson' and not l.is_ai_recommendable
  union all select 'E_stale', 'active transcript chunks of lessons with is_published<>true',
    count(*)::text from chunks k join lesson_ctx l on l.id = k.lesson_id
    where k.is_active and k.source_type = 'lesson_transcript' and coalesce(l.is_published, 'false') <> 'true'
  union all select 'E_stale', 'active transcript chunks WITHOUT a ready transcript',
    count(*)::text from chunks k
    where k.is_active and k.source_type = 'lesson_transcript' and k.lesson_id not in (select lesson_id from ready_transcripts)
  union all select 'E_stale', 'ready transcripts WITHOUT transcript chunks',
    count(*)::text from ready_transcripts r
    where not exists (select 1 from chunks k where k.source_type = 'lesson_transcript' and k.lesson_id = r.lesson_id)
  union all select 'E_stale', 'transcripts updated after their newest chunk was indexed',
    count(*)::text from public.lesson_transcripts t
    where t.status = 'ready'
      and t.updated_at > coalesce((select max(k.last_indexed_at) from chunks k where k.source_type = 'lesson_transcript' and k.lesson_id = t.lesson_id), '-infinity')
  union all select 'E_stale', 'active course/workshop chunks of unpublished courses',
    count(*)::text from chunks k left join public.courses c on c.id = k.source_id
    where k.is_active and k.source_type in ('course', 'workshop') and coalesce(c.status, 'missing') <> 'published'

  -- F) Documentos, contextos y memoria
  union all select 'F_documents', 'by status (active)', coalesce(string_agg(status || '=' || n || ' (' || a || ' active)', ', '), '') from (
    select status, count(*)::text n, count(*) filter (where is_active)::text a from public.stampy_knowledge_documents group by 1) s
  union all select 'F_contexts', 'stampy_page_contexts active/total',
    count(*) filter (where is_active)::text || '/' || count(*)::text from public.stampy_page_contexts
  union all select 'F_contexts', 'contexts mentioning "N palabras"',
    coalesce(string_agg(route_pattern, ', '), 'none') from public.stampy_page_contexts where context ~* '\m\d{2,3}\s*palabras'
  union all select 'F_memory', 'stampy_user_memory table',
    case when to_regclass('public.stampy_user_memory') is null then 'MISSING (migration 20260826182313 not applied)' else 'exists' end
  union all select 'F_memory', 'save_stampy_user_memory function',
    case when to_regprocedure('public.save_stampy_user_memory(uuid,text,text,text,double precision,uuid)') is null then 'MISSING' else 'exists' end

  -- G) Privilegios efectivos (Stampy usa la sesión del usuario: authenticated + RLS)
  union all select 'G_privileges', r.role_name || ' SELECT ' || t.name,
    case when to_regclass('public.' || t.name) is null then 'table missing'
         else has_table_privilege(r.role_name, 'public.' || t.name, 'SELECT')::text end
  from (values ('authenticated'), ('service_role')) as r(role_name)
  cross join (values ('lessons'), ('courses'), ('course_modules'), ('lesson_transcripts'), ('lesson_transcript_segments'),
                     ('stampy_knowledge_chunks'), ('stampy_page_contexts'), ('stampy_messages')) as t(name)
)
select section, item, detail
from rows_all
order by section, item;
