begin;

do $$
begin
  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid)';
  end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.has_platform_access(uuid)';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Missing dependency: public.set_updated_at()';
  end if;
  if to_regclass('public.stampy_knowledge_chunks') is null then
    raise exception 'Missing dependency: public.stampy_knowledge_chunks';
  end if;
  if to_regprocedure('public.cosine_distance(public.vector,public.vector)') is null then
    raise exception 'Missing dependency: public.cosine_distance(public.vector,public.vector)';
  end if;
end
$$;

create table if not exists public.stampy_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  source_type text not null default 'pdf',
  file_name text,
  file_path text,
  mime_type text,
  file_size bigint,
  status text not null default 'draft',
  is_active boolean not null default true,
  extracted_text text,
  extraction_error text,
  chunks_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint stampy_knowledge_documents_file_path_key unique (file_path),
  constraint stampy_knowledge_documents_source_type_check
    check (source_type = 'pdf'),
  constraint stampy_knowledge_documents_status_check
    check (status in ('draft', 'processing', 'ready', 'error', 'archived')),
  constraint stampy_knowledge_documents_file_size_check
    check (file_size is null or (file_size > 0 and file_size <= 20971520)),
  constraint stampy_knowledge_documents_mime_type_check
    check (mime_type is null or mime_type = 'application/pdf'),
  constraint stampy_knowledge_documents_chunks_count_check
    check (chunks_count >= 0)
);

alter table public.stampy_knowledge_documents
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists source_type text default 'pdf',
  add column if not exists file_name text,
  add column if not exists file_path text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint,
  add column if not exists status text default 'draft',
  add column if not exists is_active boolean default true,
  add column if not exists extracted_text text,
  add column if not exists extraction_error text,
  add column if not exists chunks_count integer default 0,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists processed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stampy_knowledge_documents'::regclass
      and contype = 'p'
  ) then
    alter table public.stampy_knowledge_documents
      add constraint stampy_knowledge_documents_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'stampy_knowledge_documents_created_by_fkey'
      and conrelid = 'public.stampy_knowledge_documents'::regclass
  ) then
    alter table public.stampy_knowledge_documents
      add constraint stampy_knowledge_documents_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'stampy_knowledge_documents_file_path_key'
      and conrelid = 'public.stampy_knowledge_documents'::regclass
  ) then
    alter table public.stampy_knowledge_documents
      add constraint stampy_knowledge_documents_file_path_key unique (file_path);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'stampy_knowledge_documents_source_type_check'
      and conrelid = 'public.stampy_knowledge_documents'::regclass
  ) then
    alter table public.stampy_knowledge_documents
      add constraint stampy_knowledge_documents_source_type_check
      check (source_type = 'pdf');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'stampy_knowledge_documents_status_check'
      and conrelid = 'public.stampy_knowledge_documents'::regclass
  ) then
    alter table public.stampy_knowledge_documents
      add constraint stampy_knowledge_documents_status_check
      check (status in ('draft', 'processing', 'ready', 'error', 'archived'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'stampy_knowledge_documents_file_size_check'
      and conrelid = 'public.stampy_knowledge_documents'::regclass
  ) then
    alter table public.stampy_knowledge_documents
      add constraint stampy_knowledge_documents_file_size_check
      check (file_size is null or (file_size > 0 and file_size <= 20971520));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'stampy_knowledge_documents_mime_type_check'
      and conrelid = 'public.stampy_knowledge_documents'::regclass
  ) then
    alter table public.stampy_knowledge_documents
      add constraint stampy_knowledge_documents_mime_type_check
      check (mime_type is null or mime_type = 'application/pdf');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'stampy_knowledge_documents_chunks_count_check'
      and conrelid = 'public.stampy_knowledge_documents'::regclass
  ) then
    alter table public.stampy_knowledge_documents
      add constraint stampy_knowledge_documents_chunks_count_check
      check (chunks_count >= 0);
  end if;
end
$$;

create index if not exists stampy_knowledge_documents_status_active_idx
  on public.stampy_knowledge_documents (status, is_active);
create index if not exists stampy_knowledge_documents_created_at_idx
  on public.stampy_knowledge_documents (created_at desc);
create index if not exists stampy_knowledge_documents_created_by_idx
  on public.stampy_knowledge_documents (created_by, created_at desc);
create index if not exists stampy_knowledge_chunks_document_idx
  on public.stampy_knowledge_chunks (source_id, source_key)
  where source_type = 'knowledge_document';

drop trigger if exists stampy_knowledge_documents_set_updated_at
  on public.stampy_knowledge_documents;
create trigger stampy_knowledge_documents_set_updated_at
before update on public.stampy_knowledge_documents
for each row execute function public.set_updated_at();

alter table public.stampy_knowledge_documents enable row level security;

drop policy if exists stampy_knowledge_documents_admin_all
  on public.stampy_knowledge_documents;
create policy stampy_knowledge_documents_admin_all
on public.stampy_knowledge_documents for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stampy-knowledge-documents',
  'stampy-knowledge-documents',
  false,
  20971520,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists stampy_knowledge_documents_storage_admin_select
  on storage.objects;
create policy stampy_knowledge_documents_storage_admin_select
on storage.objects for select to authenticated
using (
  bucket_id = 'stampy-knowledge-documents'
  and public.is_admin(auth.uid())
);

drop policy if exists stampy_knowledge_documents_storage_admin_insert
  on storage.objects;
create policy stampy_knowledge_documents_storage_admin_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'stampy-knowledge-documents'
  and public.is_admin(auth.uid())
);

drop policy if exists stampy_knowledge_documents_storage_admin_update
  on storage.objects;
create policy stampy_knowledge_documents_storage_admin_update
on storage.objects for update to authenticated
using (
  bucket_id = 'stampy-knowledge-documents'
  and public.is_admin(auth.uid())
)
with check (
  bucket_id = 'stampy-knowledge-documents'
  and public.is_admin(auth.uid())
);

drop policy if exists stampy_knowledge_documents_storage_admin_delete
  on storage.objects;
create policy stampy_knowledge_documents_storage_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'stampy-knowledge-documents'
  and public.is_admin(auth.uid())
);

create or replace function public.replace_stampy_knowledge_document_chunks(
  p_document_id uuid,
  p_extracted_text text,
  p_chunks jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_document public.stampy_knowledge_documents%rowtype;
  inserted_count integer;
begin
  if auth.uid() is null or public.is_admin(auth.uid()) is distinct from true then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception 'At least one knowledge chunk is required' using errcode = '22023';
  end if;

  select * into current_document
  from public.stampy_knowledge_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'Knowledge document not found' using errcode = 'P0002';
  end if;

  if current_document.status <> 'processing' then
    raise exception 'Knowledge document is not processing' using errcode = '55000';
  end if;

  delete from public.stampy_knowledge_chunks
  where source_type = 'knowledge_document'
    and source_id = p_document_id;

  insert into public.stampy_knowledge_chunks (
    source_type,
    source_id,
    source_key,
    title,
    content,
    route,
    category,
    tags,
    course_id,
    module_id,
    lesson_id,
    metadata,
    embedding,
    is_active,
    last_indexed_at
  )
  select
    'knowledge_document',
    p_document_id,
    chunk.value->>'source_key',
    chunk.value->>'title',
    chunk.value->>'content',
    '/stampy',
    'knowledge_document',
    array['documento', 'pdf']::text[],
    null,
    null,
    null,
    coalesce(chunk.value->'metadata', '{}'::jsonb),
    ((chunk.value->'embedding')::text)::public.vector(1536),
    true,
    now()
  from jsonb_array_elements(p_chunks) as chunk(value);

  get diagnostics inserted_count = row_count;

  update public.stampy_knowledge_documents
  set extracted_text = p_extracted_text,
      extraction_error = null,
      chunks_count = inserted_count,
      status = 'ready',
      processed_at = now(),
      updated_at = now()
  where id = p_document_id;

  return inserted_count;
end;
$$;

-- Document content remains unavailable through direct table reads. Platform
-- users only receive semantically matched snippets through the controlled RPC.
drop policy if exists stampy_knowledge_chunks_select_active
  on public.stampy_knowledge_chunks;
create policy stampy_knowledge_chunks_select_active
on public.stampy_knowledge_chunks for select to authenticated
using (
  is_active = true
  and source_type <> 'knowledge_document'
  and public.has_platform_access(auth.uid())
);

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
as $$
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
  order by public.cosine_distance(chunk.embedding, query_embedding)
  limit greatest(least(coalesce(match_count, 8), 50), 0);
$$;

revoke all on table public.stampy_knowledge_documents from public, anon;
grant select, insert, update, delete on table public.stampy_knowledge_documents to authenticated;
grant all on table public.stampy_knowledge_documents to service_role;

revoke all on function public.replace_stampy_knowledge_document_chunks(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_stampy_knowledge_document_chunks(uuid, text, jsonb)
  to authenticated, service_role;

revoke all on function public.match_stampy_knowledge_chunks(public.vector, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.match_stampy_knowledge_chunks(public.vector, double precision, integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
