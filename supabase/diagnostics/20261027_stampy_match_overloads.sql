-- SOLO LECTURA. Lista las sobrecargas de public.match_stampy_knowledge_chunks y su definición completa, para
-- decidir cómo filtrar por visibilidad de curso la que no está versionada en el repo
-- (query_embedding, match_count, filter_source_type, filter_course_id, filter_lesson_id).
select
  p.oid::regprocedure::text as signature,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
  pg_get_function_result(p.oid) as returns,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'match_stampy_knowledge_chunks'
order by p.pronargs;

-- Chunks asociados a cursos que no están publicados (exposición actual vía la sobrecarga sin filtro).
select c.status::text as course_status, count(*) as chunks
from public.stampy_knowledge_chunks k
join public.courses c on c.id = k.course_id
where k.is_active = true
group by 1
order by 1;
