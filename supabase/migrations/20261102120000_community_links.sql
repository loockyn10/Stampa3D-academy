-- Redes y canales de Stampa: fuente única de los enlaces de comunidad que administra el Admin.
--
-- * public.community_links: una fila por red social (kind = 'social') o canal/comunidad (kind = 'channel').
--   Las redes sociales son siempre públicas; los canales tienen nivel de acceso:
--     'public'     -> cualquiera (incluye visitantes sin sesión)
--     'registered' -> cualquier usuario con sesión (authenticated)
--     'premium'    -> usuarios con acceso de plataforma (public.has_platform_access) y administradores
--   "Premium" reutiliza la misma función de acceso que el resto de la plataforma (Stampy, RLS de contenido); no se
--   crea una segunda lógica de membresías.
-- * RLS: un usuario común solo LEE filas activas a las que su nivel le da acceso. La URL de invitación de un canal
--   Premium no es legible para nadie más (ni por PostgREST ni por consultas públicas). Solo los administradores
--   (public.is_admin) leen todo y escriben.
-- * public.list_community_links(): RPC de lectura para la aplicación. Devuelve las filas activas y deja url = NULL
--   (locked = true) cuando quien consulta no tiene acceso, para poder mostrar una tarjeta bloqueada sin exponer el
--   enlace. Los visitantes sin sesión solo reciben filas públicas.
-- * Seed: si la tabla está vacía se cargan los 4 enlaces que antes estaban fijos en el código (Instagram, YouTube,
--   WhatsApp, Telegram), todos públicos, para que aplicar la migration no cambie lo que ve hoy cada usuario.
--
-- Depende de public.is_admin(uuid) y public.has_platform_access(uuid) (no versionadas en este repo, igual que en el
-- resto de las migrations). Segura de re-ejecutar (idempotente).

do $community_links_dependencies$
begin
  if to_regprocedure('public.is_admin(uuid)') is null
     or to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid) and public.has_platform_access(uuid)';
  end if;
end;
$community_links_dependencies$;

create table if not exists public.community_links (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  platform text not null,
  name text not null,
  channel_type text,
  description text,
  url text not null,
  icon_key text,
  access_level text not null default 'public',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint community_links_kind_check check (kind in ('social', 'channel')),
  constraint community_links_platform_format check (platform ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint community_links_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint community_links_description_length check (description is null or char_length(description) <= 280),
  constraint community_links_channel_type_check check (
    (kind = 'social' and channel_type is null)
    or (kind = 'channel' and channel_type is not null and channel_type in ('channel', 'group', 'community', 'server'))
  ),
  -- Solo https, sin credenciales embebidas (usuario:clave@host) ni espacios.
  constraint community_links_url_https check (
    char_length(url) <= 500 and url ~ '^https://[^\s@/?#]+([/?#]\S*)?$'
  ),
  constraint community_links_icon_key_format check (icon_key is null or icon_key ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint community_links_access_level_check check (access_level in ('public', 'registered', 'premium')),
  constraint community_links_social_is_public check (kind <> 'social' or access_level = 'public'),
  constraint community_links_sort_order_check check (sort_order >= 0)
);

comment on table public.community_links is
  'Redes sociales y canales/comunidades oficiales de Stampa. Administradas desde /admin/redes-canales. La URL de los canales Premium solo la leen administradores y usuarios con acceso de plataforma.';

create index if not exists community_links_kind_order_idx
  on public.community_links (kind, sort_order, created_at);

-- Privilegios: la lectura directa pasa por RLS (filas visibles según el nivel); escritura solo authenticated,
-- filtrada por RLS a administradores.
revoke all on table public.community_links from public;
revoke all on table public.community_links from anon, authenticated;
grant select on table public.community_links to anon, authenticated;
grant insert, update, delete on table public.community_links to authenticated;
grant select, insert, update, delete on table public.community_links to service_role;

alter table public.community_links enable row level security;

-- Helper: ¿quien consulta puede ver un enlace de este nivel? SECURITY DEFINER para que `anon` pueda evaluar la
-- policy sin EXECUTE sobre has_platform_access/is_admin (mismo patrón que las policies de visibilidad de Academia).
-- Solo responde un booleano sobre el propio llamador; no expone filas.
create or replace function public.community_viewer_can_access(p_access_level text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_access_level
    when 'public' then true
    when 'registered' then auth.uid() is not null
    when 'premium' then
      auth.uid() is not null
      and (public.is_admin(auth.uid()) or public.has_platform_access(auth.uid()))
    else false
  end;
$$;

revoke all on function public.community_viewer_can_access(text) from public;
grant execute on function public.community_viewer_can_access(text) to anon, authenticated, service_role;

drop policy if exists community_links_select_visible on public.community_links;
create policy community_links_select_visible
on public.community_links for select to anon, authenticated
using (is_active and public.community_viewer_can_access(access_level));

drop policy if exists community_links_admin_select on public.community_links;
create policy community_links_admin_select
on public.community_links for select to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists community_links_admin_insert on public.community_links;
create policy community_links_admin_insert
on public.community_links for insert to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists community_links_admin_update on public.community_links;
create policy community_links_admin_update
on public.community_links for update to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists community_links_admin_delete on public.community_links;
create policy community_links_admin_delete
on public.community_links for delete to authenticated
using (public.is_admin(auth.uid()));

-- updated_by / updated_at los fija el servidor desde la sesión, no lo que envíe el cliente.
create or replace function public.community_links_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists community_links_stamp on public.community_links;
create trigger community_links_stamp
before insert or update on public.community_links
for each row execute function public.community_links_stamp();

-- Lectura para la aplicación: filas activas; url NULL + locked cuando no hay acceso. Los visitantes sin sesión solo
-- reciben filas a las que sí pueden acceder (no se anuncian canales bloqueados a quien no inició sesión).
-- Nota: nombre y descripción de un canal bloqueado sí llegan a usuarios con sesión (alimentan la tarjeta bloqueada);
-- no escribir allí nada que deba mantenerse privado: lo privado es la URL.
create or replace function public.list_community_links()
returns table (
  id uuid,
  kind text,
  platform text,
  name text,
  channel_type text,
  description text,
  icon_key text,
  access_level text,
  sort_order integer,
  url text,
  locked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.id,
    l.kind,
    l.platform,
    l.name,
    l.channel_type,
    l.description,
    l.icon_key,
    l.access_level,
    l.sort_order,
    case when v.allowed then l.url else null end as url,
    not v.allowed as locked
  from public.community_links as l
  cross join lateral (select public.community_viewer_can_access(l.access_level) as allowed) as v
  where l.is_active
    and (v.allowed or auth.uid() is not null)
  order by l.kind, l.sort_order, l.created_at;
$$;

revoke all on function public.list_community_links() from public;
grant execute on function public.list_community_links() to anon, authenticated, service_role;

-- Reordenamiento atómico dentro de un tipo: p_ids define el orden final (posición 0, 1, 2…). SECURITY INVOKER: la
-- RLS de UPDATE exige administrador; además se comprueba explícitamente para fallar con un error claro.
create or replace function public.reorder_community_links(p_kind text, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'Solo los administradores pueden ordenar los enlaces' using errcode = '42501';
  end if;
  if p_kind not in ('social', 'channel') then
    raise exception 'Tipo de enlace inválido' using errcode = '22023';
  end if;

  update public.community_links as l
  set sort_order = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where l.id = o.id and l.kind = p_kind;
end;
$$;

revoke all on function public.reorder_community_links(text, uuid[]) from public, anon;
grant execute on function public.reorder_community_links(text, uuid[]) to authenticated, service_role;

-- Seed: solo si la tabla está vacía. Reproduce los enlaces que estaban fijos en el código.
insert into public.community_links (kind, platform, name, channel_type, description, url, access_level, sort_order)
select v.kind, v.platform, v.name, v.channel_type, v.description, v.url, 'public', v.sort_order
from (
  values
    ('social', 'instagram', 'Instagram', null, 'Contenido, novedades y avances de la comunidad.', 'https://instagram.com/extruye', 0),
    ('social', 'youtube', 'YouTube', null, 'Videos, tutoriales y contenido complementario de la academia.', 'https://youtube.com/extruye', 1),
    ('channel', 'whatsapp', 'WhatsApp', 'group', 'Canal o grupo para avisos, consultas rápidas y comunidad.', 'https://chat.whatsapp.com/extruye', 0),
    ('channel', 'telegram', 'Telegram', 'channel', 'Canal o grupo alternativo para novedades y comunidad.', 'https://t.me/extruye', 1)
) as v(kind, platform, name, channel_type, description, url, sort_order)
where not exists (select 1 from public.community_links);

notify pgrst, 'reload schema';
