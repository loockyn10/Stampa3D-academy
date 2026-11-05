-- Sprint 3 — Inventario de contenido de Academia (SOLO LECTURA; no devuelve datos de alumnos).
-- Correr en el SQL Editor del proyecto. Cada bloque es independiente: el SQL Editor muestra solo el último
-- resultado, así que conviene ejecutarlos de a uno. Nada de este archivo modifica filas, policies ni privilegios.
--
-- Criterio de "lista para V1.0": curso `published` con al menos una clase activa (en módulo activo) y todas sus
-- clases activas con un video reconocido por el reproductor (Bunny Stream, YouTube, Vimeo o archivo .mp4/.webm).

-- A. Inventario por curso / taller.
with lesson_facts as (
  select
    m.course_id,
    l.id as lesson_id,
    (coalesce(l.is_active, true) and coalesce(m.is_active, true)) as visible,
    nullif(trim(coalesce(l.video_url, '')), '') as video,
    coalesce(l.duration_minutes, 0) as minutes
  from public.lessons l
  join public.course_modules m on m.id = l.module_id
),
classified as (
  select *,
    case
      when video is null then 'sin_video'
      when video ~* '(iframe|player)\.mediadelivery\.net/(embed|play)/[0-9]+/' then 'bunny'
      when video ~* '(youtube\.com|youtu\.be)' then 'youtube'
      when video ~* 'vimeo\.com' then 'vimeo'
      when video ~* '^https://.*\.(mp4|webm|ogg|mov)(\?|$)' then 'archivo'
      else 'no_reconocido'
    end as provider
  from lesson_facts
)
select
  c.title,
  c.course_kind,
  c.status,
  (select count(*) from public.course_modules m where m.course_id = c.id and coalesce(m.is_active, true)) as modulos_activos,
  count(*) filter (where cl.visible) as clases_visibles,
  count(*) filter (where cl.visible and cl.provider in ('bunny', 'youtube', 'vimeo', 'archivo')) as clases_con_video,
  count(*) filter (where cl.visible and cl.provider = 'sin_video') as clases_sin_video,
  count(*) filter (where cl.visible and cl.provider = 'no_reconocido') as clases_video_no_reconocido,
  count(*) filter (where cl.visible and cl.provider = 'bunny') as clases_bunny,
  count(*) filter (where not cl.visible) as clases_inactivas,
  sum(cl.minutes) filter (where cl.visible) as minutos_visibles,
  case
    when c.status <> 'published' then 'no publicado (' || coalesce(c.status, 'sin estado') || ')'
    when count(*) filter (where cl.visible) = 0 then 'PUBLICADO SIN CLASES'
    when count(*) filter (where cl.visible and cl.provider in ('sin_video', 'no_reconocido')) > 0 then 'publicado con clases sin video'
    else 'lista para V1.0'
  end as veredicto
from public.courses c
left join classified cl on cl.course_id = c.id
group by c.id, c.title, c.course_kind, c.status
order by c.status, c.course_kind, c.title;

-- B. Totales por estado y tipo.
select coalesce(status, 'sin estado') as status, coalesce(course_kind, 'sin tipo') as tipo, count(*) as cursos
from public.courses
group by 1, 2
order by 1, 2;

-- C. Clases visibles sin video o con un enlace que el reproductor no reconoce, en cursos publicados.
select c.title as curso, m.title as modulo, l.title as clase,
       case when nullif(trim(coalesce(l.video_url, '')), '') is null then 'sin video' else 'enlace no reconocido' end as problema
from public.lessons l
join public.course_modules m on m.id = l.module_id
join public.courses c on c.id = m.course_id
where c.status = 'published'
  and coalesce(l.is_active, true) and coalesce(m.is_active, true)
  and (
    nullif(trim(coalesce(l.video_url, '')), '') is null
    or not (l.video_url ~* '(mediadelivery\.net/(embed|play)/[0-9]+/|youtube\.com|youtu\.be|vimeo\.com|\.(mp4|webm|ogg|mov)(\?|$))')
  )
order by c.title, m.sort_order, l.sort_order;

-- D. Recursos descargables: cuántos hay y dónde están (almacenamiento privado vs enlace externo).
select
  case when r.url ~* '^https?://' then 'enlace externo' else 'storage' end as origen,
  case when r.url ~* '^https?://' then null else split_part(r.url, '/', 1) end as bucket,
  count(*) filter (where coalesce(r.is_active, true)) as activos,
  count(*) filter (where not coalesce(r.is_active, true)) as inactivos
from public.lesson_resources r
group by 1, 2
order by 1, 2;

-- E. Protección del contenido: policies vigentes y privilegios de anon/authenticated sobre las tablas de Academia.
select tablename, policyname, permissive, cmd, roles::text, left(coalesce(qual, ''), 160) as condicion
from pg_policies
where schemaname = 'public' and tablename in ('courses', 'course_modules', 'lessons', 'lesson_resources', 'lesson_progress')
order by tablename, cmd, policyname;

select t.table_name,
       has_table_privilege('anon', 'public.' || t.table_name, 'SELECT') as anon_select,
       has_table_privilege('authenticated', 'public.' || t.table_name, 'SELECT') as authenticated_select,
       has_table_privilege('authenticated', 'public.' || t.table_name, 'INSERT') as authenticated_insert
from (values ('courses'), ('course_modules'), ('lessons'), ('lesson_resources'), ('lesson_progress')) as t(table_name)
where to_regclass('public.' || t.table_name) is not null;
