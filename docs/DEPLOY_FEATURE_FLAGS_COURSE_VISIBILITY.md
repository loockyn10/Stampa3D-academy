# Despliegue conjunto: Feature Flags + Visibilidad de cursos

Rama: `feature/universo-stampa-feature-flags`. **Nada de esto se ejecutó**: no hubo push, merge, deploy ni SQL remoto.

## 1. Qué se publica

| Pieza | Migration | Efecto al aplicarla |
|---|---|---|
| Feature flags | `20261024120000_platform_feature_flags.sql` | Crea `platform_feature_flags`. No inserta filas: todo sigue habilitado. |
| Visibilidad de cursos | `20261026120000_academy_course_visibility.sql` | Amplía el CHECK de `courses.status`, crea helpers, policies RESTRICTIVE, un trigger y reemplaza `match_stampy_knowledge_chunks`. **No cambia el estado de ningún curso.** |

Dependencias no versionadas en el repo (la migration aborta con `Missing dependency` si faltan): `courses`, `course_modules`, `lessons`, `lesson_progress`, `public.is_admin(uuid)`, `public.has_platform_access(uuid)`.

## 2. Orden y compatibilidad

1. **Backup / punto de restauración** de Supabase (o export de `courses`, `lesson_progress`).
2. **Diagnóstico read-only** en el SQL Editor (ver §3) y revisar resultados.
3. **Aplicar las migrations** en orden: `20261024120000` → `20261026120000`.
4. **Desplegar el código** (merge a `main` → deploy). Orden recomendado: migrations antes del código.
   - Código nuevo + migration sin aplicar: Academia funciona como hoy; guardar «En preparación»/«Oculto» falla con un mensaje claro (CHECK) o, si no hay CHECK, funciona pero la RLS restrictiva aún no protege. No lo uses hasta aplicar la migration.
   - Migration aplicada + código viejo: seguro. Los cursos `published` siguen igual; el código viejo solo pide `published`.
5. **Verificar** (§4) y recién después usar los controles.

Datos existentes: ningún curso cambia de estado. `draft`/`archived` se muestran como «Oculto» en administración (siguen sin ser visibles para alumnos); al guardar un curso desde el formulario, ese valor pasa a `hidden` (equivalente).

## 3. Diagnóstico previo (read-only)

```sql
-- Tipo y valores actuales de courses.status
select data_type, udt_name from information_schema.columns
 where table_schema='public' and table_name='courses' and column_name='status';
select status::text, count(*) from public.courses group by 1;

-- Constraints y policies existentes sobre las tablas de Academia
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.courses'::regclass and contype='c';
select tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
 where schemaname='public' and tablename in ('courses','course_modules','lessons','lesson_resources','lesson_progress','lesson_transcripts','lesson_transcript_segments','stampy_knowledge_chunks')
 order by tablename, policyname;

-- Funciones requeridas y firma de la búsqueda de Stampy
select to_regprocedure('public.is_admin(uuid)'), to_regprocedure('public.has_platform_access(uuid)'),
       to_regprocedure('public.match_stampy_knowledge_chunks(public.vector, double precision, integer)'),
       to_regclass('public.stampy_knowledge_documents');
```

Qué mirar: (a) si alguna policy permissive de `courses`/`lessons` es `using (true)` para `anon` (la restrictiva la recorta igual, pero conviene saberlo); (b) si `stampy_knowledge_documents` es `null` → la migration omite el reemplazo de `match_stampy_knowledge_chunks` (aviso `NOTICE`); (c) que `lesson_resources` y `lesson_transcripts` existan (si no, sus policies se omiten).

## 4. Verificación posterior

SQL (read-only):

```sql
select tablename, policyname, permissive, cmd from pg_policies where schemaname='public'
  and (policyname like '%open_course_restrict%' or policyname like 'courses_%visibility%' or policyname='courses_coming_soon_catalog_select');
select status::text, count(*) from public.courses group by 1;   -- debe ser idéntico al diagnóstico previo
select count(*) from public.lesson_progress;                      -- idéntico al previo
select feature_id, enabled from public.platform_feature_flags;    -- vacío hasta que un admin configure algo
```

Funcional (cuentas Free, Paid y Admin; usar un curso de prueba, no datos reales de alumnos):

| # | Caso | Esperado |
|---|---|---|
| 1 | Paid abre un curso `published` | Entra, ve clases, marca progreso |
| 2 | Admin pasa el curso a «En preparación» | Toast de confirmación; aparece en «Próximamente» en `/cursos`, `/academia` (curso) y `/talleres` (taller) |
| 3 | Paid abre `/cursos/<slug>` del curso en preparación | Pantalla «en preparación», sin clases ni video |
| 4 | Paid intenta marcar progreso por consola/REST sobre ese curso | Rechazado (Server Action y RLS) |
| 5 | Admin pasa el curso a «Oculto» | Desaparece de catálogo, buscador, Inicio y rutas; `/cursos/<slug>` → 404 para Paid |
| 6 | Admin abre ambos estados | Vista previa con banner ámbar; puede editar |
| 7 | Alumno con progreso en el curso bloqueado | Al volver a publicar conserva su progreso; «Continuar aprendiendo» no lo ofrece mientras esté bloqueado |
| 8 | Admin bloquea un curso con alumnos | Diálogo con la cantidad de alumnos y aclaración de que nada se borra |
| 9 | Free (sin membresía) | `/cursos/*` → `/sin-acceso`; no ve la ficha en preparación |
| 10 | Admin deshabilita «Academia» en `/admin/funcionalidades` | Paid ve «no disponible» (incluso en cursos publicados); Admin entra; navegación y buscador sin Academia |
| 11 | Stampy en una clase de un curso bloqueado | No usa contexto/transcripción de esa clase; no la recomienda |
| 12 | Móvil 320–430 px | Tarjetas y selector de visibilidad en una columna, sin scroll horizontal |

## 5. Cachés

- Cambiar la visibilidad revalida `/admin/cursos`, `/cursos` (layout), `/talleres`, `/academia` y `/` desde la Server Action; las pantallas del catálogo consultan Supabase en el cliente, así que no requieren deploy.
- `/cursos/[id]` es `force-dynamic`.
- Los flags de funcionalidades usan su propia caché breve (ver ARCHITECTURE §21); si un cambio no se refleja, esperar el TTL antes de diagnosticar.
- Tras el deploy: si el navegador conserva el bundle viejo del catálogo, un refresh forzado lo resuelve.
- Los chunks de conocimiento de Stampy de cursos bloqueados quedan en la tabla, pero `match_stampy_knowledge_chunks` y la policy restrictiva no los devuelven. Un reindex solo es higiene.

## 6. Reversión

Código: revertir el merge (`git revert -m 1 <merge>`) y redeployar. Es seguro con la migration aplicada.

Base de datos (solo si hace falta; no borra datos):

```sql
-- Visibilidad de cursos
drop trigger if exists courses_status_admin_guard on public.courses;
drop function if exists public.courses_status_admin_guard();
drop policy if exists courses_coming_soon_catalog_select on public.courses;
drop policy if exists courses_visibility_restrict_select on public.courses;
drop policy if exists course_modules_open_course_restrict_select on public.course_modules;
drop policy if exists lessons_open_course_restrict_select on public.lessons;
drop policy if exists lesson_resources_open_course_restrict_select on public.lesson_resources;
drop policy if exists lesson_transcripts_open_course_restrict_select on public.lesson_transcripts;
drop policy if exists lesson_transcript_segments_open_course_restrict_select on public.lesson_transcript_segments;
drop policy if exists stampy_knowledge_chunks_open_course_restrict_select on public.stampy_knowledge_chunks;
drop policy if exists lesson_progress_open_course_restrict_insert on public.lesson_progress;
drop policy if exists lesson_progress_open_course_restrict_update on public.lesson_progress;
drop policy if exists lesson_progress_open_course_restrict_delete on public.lesson_progress;
alter table public.courses drop constraint if exists courses_status_visibility_check;
-- Antes de volver al código viejo: los cursos en 'coming_soon'/'hidden' deben pasar a un valor que el código viejo
-- entienda ('draft' los oculta). Hacerlo solo si se revierte el código también:
-- update public.courses set status = 'draft' where status in ('coming_soon','hidden');
-- match_stampy_knowledge_chunks: volver a ejecutar su definición de 20260828103109_stampy_knowledge_documents.sql
-- Helpers (después de borrar las policies): drop function public.academy_chunk_is_open(uuid,uuid), academy_lesson_is_open(uuid), academy_module_is_open(uuid), academy_course_is_open(uuid);
```

Los valores añadidos a un enum (`coming_soon`, `hidden`), si la columna fuese un enum, no se pueden quitar; son inocuos.

Feature flags: `delete from public.platform_feature_flags;` (o dejar la tabla vacía) devuelve todo a «habilitado»; el panel permite volver a habilitar cada herramienta sin SQL.

## 7. Riesgos conocidos

- La RLS base de Academia no está versionada: las policies restrictivas se diseñaron para no depender de ella, pero conviene correr el diagnóstico (§3) antes.
- La migration no fue ejecutada contra un Postgres real; se validó por revisión y tests estáticos. El test opt-in con `embedded-postgres` (ver `tests/beta-access-db.test.mjs`) no se corrió porque requiere descargar paquetes.
- Escribir progreso y consultar el impacto de alumnos: el conteo usa `SUPABASE_SERVICE_ROLE_KEY` (solo lectura, tras verificar admin); sin esa variable el conteo puede ser parcial y el diálogo puede no aparecer.
- Cursos en preparación visibles para todo usuario con acceso a la plataforma: ficha (título, descripción, portada, instructor), nada más.
