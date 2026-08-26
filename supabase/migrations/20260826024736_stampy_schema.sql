begin;

create extension if not exists vector;

-- Stampy relies on these shared authorization/timestamp helpers. They are
-- intentionally not redefined here because they belong to the platform schema.
do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.courses') is null
     or to_regclass('public.course_modules') is null
     or to_regclass('public.lessons') is null then
    raise exception 'Missing dependency: profiles, courses, course_modules, and lessons must exist';
  end if;

  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid)';
  end if;

  if to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.has_platform_access(uuid)';
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Missing dependency: public.set_updated_at()';
  end if;
end;
$$;

-- AI metadata consumed by Stampy recommendations and the knowledge indexer.
alter table public.lessons
  add column if not exists ai_summary text,
  add column if not exists ai_topics text[] not null default '{}',
  add column if not exists ai_problems text[] not null default '{}',
  add column if not exists ai_level text not null default 'beginner',
  add column if not exists ai_related_tool text,
  add column if not exists is_ai_recommendable boolean not null default true;

create index if not exists lessons_ai_recommendable_idx
  on public.lessons (is_ai_recommendable)
  where is_ai_recommendable = true;

create table if not exists public.stampy_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stampy_conversations
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists title text,
  add column if not exists last_message_at timestamptz default now(),
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.stampy_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.stampy_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint stampy_messages_role_check check (role in ('user', 'assistant'))
);

alter table public.stampy_messages
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists conversation_id uuid,
  add column if not exists user_id uuid,
  add column if not exists role text,
  add column if not exists content text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now();

create table if not exists public.stampy_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.stampy_conversations(id) on delete set null,
  model text,
  mode text not null,
  status text not null,
  message_chars integer not null default 0,
  prompt_chars integer,
  completion_chars integer,
  latency_ms integer,
  error_message text,
  created_at timestamptz not null default now(),
  constraint stampy_usage_logs_mode_check
    check (mode in ('direct', 'openai', 'blocked', 'error')),
  constraint stampy_usage_logs_status_check
    check (status in ('success', 'blocked', 'error')),
  constraint stampy_usage_logs_counts_check
    check (
      message_chars >= 0
      and (prompt_chars is null or prompt_chars >= 0)
      and (completion_chars is null or completion_chars >= 0)
      and (latency_ms is null or latency_ms >= 0)
    )
);

alter table public.stampy_usage_logs
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists conversation_id uuid,
  add column if not exists model text,
  add column if not exists mode text,
  add column if not exists status text,
  add column if not exists message_chars integer default 0,
  add column if not exists prompt_chars integer,
  add column if not exists completion_chars integer,
  add column if not exists latency_ms integer,
  add column if not exists error_message text,
  add column if not exists created_at timestamptz default now();

create table if not exists public.stampy_message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.stampy_messages(id) on delete cascade,
  conversation_id uuid not null references public.stampy_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating text not null,
  reason text,
  comment text,
  source text not null default 'stampy',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stampy_message_feedback_message_user_key unique (message_id, user_id),
  constraint stampy_message_feedback_rating_check
    check (rating in ('positive', 'negative')),
  constraint stampy_message_feedback_reason_check
    check (
      reason is null
      or reason in (
        'helpful',
        'incorrect',
        'too_generic',
        'did_not_understand',
        'did_not_use_context',
        'bad_tool_recommendation',
        'other'
      )
    ),
  constraint stampy_message_feedback_comment_length_check
    check (comment is null or char_length(comment) <= 1000)
);

alter table public.stampy_message_feedback
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists message_id uuid,
  add column if not exists conversation_id uuid,
  add column if not exists user_id uuid,
  add column if not exists rating text,
  add column if not exists reason text,
  add column if not exists comment text,
  add column if not exists source text default 'stampy',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.stampy_action_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.stampy_conversations(id) on delete cascade,
  message_id uuid not null references public.stampy_messages(id) on delete cascade,
  action_type text not null,
  status text not null default 'suggested',
  confidence double precision not null,
  extracted jsonb not null default '{}'::jsonb,
  tool_href text,
  tool_label text,
  source text not null default 'stampy',
  can_execute boolean not null default false,
  executed_at timestamptz,
  cancelled_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stampy_action_requests_action_type_check
    check (
      action_type in (
        'discount_filament',
        'add_filament',
        'increase_filament_stock',
        'add_printer',
        'create_product',
        'create_quote',
        'calculate_price',
        'update_stock',
        'unknown_action'
      )
    ),
  constraint stampy_action_requests_status_check
    check (status in ('suggested', 'opened_tool', 'cancelled', 'executed', 'error')),
  constraint stampy_action_requests_confidence_check
    check (confidence >= 0 and confidence <= 1)
);

alter table public.stampy_action_requests
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists conversation_id uuid,
  add column if not exists message_id uuid,
  add column if not exists action_type text,
  add column if not exists status text default 'suggested',
  add column if not exists confidence double precision,
  add column if not exists extracted jsonb default '{}'::jsonb,
  add column if not exists tool_href text,
  add column if not exists tool_label text,
  add column if not exists source text default 'stampy',
  add column if not exists can_execute boolean default false,
  add column if not exists executed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists error_message text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.stampy_action_requests
  alter column can_execute set default false;

create table if not exists public.stampy_page_contexts (
  id uuid primary key default gen_random_uuid(),
  route_pattern text not null,
  match_type text not null default 'exact',
  title text not null,
  context text not null,
  priority integer not null default 0,
  suggested_questions text[] not null default '{}',
  related_tools text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stampy_page_contexts_match_type_check
    check (match_type in ('exact', 'prefix')),
  constraint stampy_page_contexts_route_check
    check (route_pattern like '/%')
);

alter table public.stampy_page_contexts
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists route_pattern text,
  add column if not exists match_type text default 'exact',
  add column if not exists title text,
  add column if not exists context text,
  add column if not exists priority integer default 0,
  add column if not exists suggested_questions text[] default '{}',
  add column if not exists related_tools text[] default '{}',
  add column if not exists is_active boolean default true,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.stampy_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid,
  source_key text,
  title text not null,
  content text not null,
  route text not null,
  category text,
  tags text[] not null default '{}',
  course_id uuid references public.courses(id) on delete cascade,
  module_id uuid references public.course_modules(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  is_active boolean not null default true,
  last_indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stampy_knowledge_chunks_source_identity_key
    unique nulls not distinct (source_type, source_id, source_key)
);

alter table public.stampy_knowledge_chunks
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists source_key text,
  add column if not exists title text,
  add column if not exists content text,
  add column if not exists route text,
  add column if not exists category text,
  add column if not exists tags text[] default '{}',
  add column if not exists course_id uuid,
  add column if not exists module_id uuid,
  add column if not exists lesson_id uuid,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists embedding vector(1536),
  add column if not exists is_active boolean default true,
  add column if not exists last_indexed_at timestamptz default now(),
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.lesson_transcripts (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  source_type text not null default 'manual',
  language text not null default 'es',
  status text not null default 'draft',
  transcript_text text,
  raw_payload jsonb,
  provider text,
  external_id text,
  source_url text,
  duration_seconds double precision,
  segments_count integer not null default 0,
  imported_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_transcripts_lesson_id_key unique (lesson_id),
  constraint lesson_transcripts_status_check
    check (status in ('draft', 'processing', 'ready', 'error')),
  constraint lesson_transcripts_duration_check
    check (duration_seconds is null or duration_seconds >= 0),
  constraint lesson_transcripts_segments_count_check
    check (segments_count >= 0)
);

alter table public.lesson_transcripts
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists lesson_id uuid,
  add column if not exists source_type text default 'manual',
  add column if not exists language text default 'es',
  add column if not exists status text default 'draft',
  add column if not exists transcript_text text,
  add column if not exists raw_payload jsonb,
  add column if not exists provider text,
  add column if not exists external_id text,
  add column if not exists source_url text,
  add column if not exists duration_seconds double precision,
  add column if not exists segments_count integer default 0,
  add column if not exists imported_by uuid,
  add column if not exists generated_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.lesson_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.lesson_transcripts(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  position integer not null,
  start_seconds double precision,
  end_seconds double precision,
  text text not null,
  confidence double precision,
  created_at timestamptz not null default now(),
  constraint lesson_transcript_segments_transcript_position_key
    unique (transcript_id, position),
  constraint lesson_transcript_segments_position_check
    check (position >= 0),
  constraint lesson_transcript_segments_times_check
    check (
      (start_seconds is null or start_seconds >= 0)
      and (end_seconds is null or end_seconds >= 0)
      and (
        start_seconds is null
        or end_seconds is null
        or end_seconds >= start_seconds
      )
    ),
  constraint lesson_transcript_segments_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

alter table public.lesson_transcript_segments
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists transcript_id uuid,
  add column if not exists lesson_id uuid,
  add column if not exists position integer,
  add column if not exists start_seconds double precision,
  add column if not exists end_seconds double precision,
  add column if not exists text text,
  add column if not exists confidence double precision,
  add column if not exists created_at timestamptz default now();

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS. These blocks make reruns safe
-- and also add constraints when an earlier, unversioned table already exists.
do $$
declare
  table_name text;
  constraint_to_add record;
begin
  foreach table_name in array array[
    'stampy_conversations',
    'stampy_messages',
    'stampy_usage_logs',
    'stampy_message_feedback',
    'stampy_action_requests',
    'stampy_page_contexts',
    'stampy_knowledge_chunks',
    'lesson_transcripts',
    'lesson_transcript_segments'
  ]
  loop
    if not exists (
      select 1
      from pg_constraint
      where conrelid = format('public.%I', table_name)::regclass
        and contype = 'p'
    ) then
      execute format(
        'alter table public.%I add constraint %I primary key (id)',
        table_name,
        table_name || '_pkey'
      );
    end if;
  end loop;

  for constraint_to_add in
    select *
    from (values
      ('stampy_conversations', 'stampy_conversations_user_id_fkey',
        'alter table public.stampy_conversations add constraint stampy_conversations_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade'),
      ('stampy_messages', 'stampy_messages_conversation_id_fkey',
        'alter table public.stampy_messages add constraint stampy_messages_conversation_id_fkey foreign key (conversation_id) references public.stampy_conversations(id) on delete cascade'),
      ('stampy_messages', 'stampy_messages_user_id_fkey',
        'alter table public.stampy_messages add constraint stampy_messages_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade'),
      ('stampy_usage_logs', 'stampy_usage_logs_user_id_fkey',
        'alter table public.stampy_usage_logs add constraint stampy_usage_logs_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade'),
      ('stampy_usage_logs', 'stampy_usage_logs_conversation_id_fkey',
        'alter table public.stampy_usage_logs add constraint stampy_usage_logs_conversation_id_fkey foreign key (conversation_id) references public.stampy_conversations(id) on delete set null'),
      ('stampy_message_feedback', 'stampy_message_feedback_message_id_fkey',
        'alter table public.stampy_message_feedback add constraint stampy_message_feedback_message_id_fkey foreign key (message_id) references public.stampy_messages(id) on delete cascade'),
      ('stampy_message_feedback', 'stampy_message_feedback_conversation_id_fkey',
        'alter table public.stampy_message_feedback add constraint stampy_message_feedback_conversation_id_fkey foreign key (conversation_id) references public.stampy_conversations(id) on delete cascade'),
      ('stampy_message_feedback', 'stampy_message_feedback_user_id_fkey',
        'alter table public.stampy_message_feedback add constraint stampy_message_feedback_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade'),
      ('stampy_action_requests', 'stampy_action_requests_user_id_fkey',
        'alter table public.stampy_action_requests add constraint stampy_action_requests_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade'),
      ('stampy_action_requests', 'stampy_action_requests_conversation_id_fkey',
        'alter table public.stampy_action_requests add constraint stampy_action_requests_conversation_id_fkey foreign key (conversation_id) references public.stampy_conversations(id) on delete cascade'),
      ('stampy_action_requests', 'stampy_action_requests_message_id_fkey',
        'alter table public.stampy_action_requests add constraint stampy_action_requests_message_id_fkey foreign key (message_id) references public.stampy_messages(id) on delete cascade'),
      ('stampy_knowledge_chunks', 'stampy_knowledge_chunks_course_id_fkey',
        'alter table public.stampy_knowledge_chunks add constraint stampy_knowledge_chunks_course_id_fkey foreign key (course_id) references public.courses(id) on delete cascade'),
      ('stampy_knowledge_chunks', 'stampy_knowledge_chunks_module_id_fkey',
        'alter table public.stampy_knowledge_chunks add constraint stampy_knowledge_chunks_module_id_fkey foreign key (module_id) references public.course_modules(id) on delete cascade'),
      ('stampy_knowledge_chunks', 'stampy_knowledge_chunks_lesson_id_fkey',
        'alter table public.stampy_knowledge_chunks add constraint stampy_knowledge_chunks_lesson_id_fkey foreign key (lesson_id) references public.lessons(id) on delete cascade'),
      ('lesson_transcripts', 'lesson_transcripts_lesson_id_fkey',
        'alter table public.lesson_transcripts add constraint lesson_transcripts_lesson_id_fkey foreign key (lesson_id) references public.lessons(id) on delete cascade'),
      ('lesson_transcripts', 'lesson_transcripts_imported_by_fkey',
        'alter table public.lesson_transcripts add constraint lesson_transcripts_imported_by_fkey foreign key (imported_by) references public.profiles(id) on delete set null'),
      ('lesson_transcript_segments', 'lesson_transcript_segments_transcript_id_fkey',
        'alter table public.lesson_transcript_segments add constraint lesson_transcript_segments_transcript_id_fkey foreign key (transcript_id) references public.lesson_transcripts(id) on delete cascade'),
      ('lesson_transcript_segments', 'lesson_transcript_segments_lesson_id_fkey',
        'alter table public.lesson_transcript_segments add constraint lesson_transcript_segments_lesson_id_fkey foreign key (lesson_id) references public.lessons(id) on delete cascade'),

      ('stampy_message_feedback', 'stampy_message_feedback_message_user_key',
        'alter table public.stampy_message_feedback add constraint stampy_message_feedback_message_user_key unique (message_id, user_id)'),
      ('stampy_knowledge_chunks', 'stampy_knowledge_chunks_source_identity_key',
        'alter table public.stampy_knowledge_chunks add constraint stampy_knowledge_chunks_source_identity_key unique nulls not distinct (source_type, source_id, source_key)'),
      ('lesson_transcripts', 'lesson_transcripts_lesson_id_key',
        'alter table public.lesson_transcripts add constraint lesson_transcripts_lesson_id_key unique (lesson_id)'),
      ('lesson_transcript_segments', 'lesson_transcript_segments_transcript_position_key',
        'alter table public.lesson_transcript_segments add constraint lesson_transcript_segments_transcript_position_key unique (transcript_id, position)'),

      ('stampy_messages', 'stampy_messages_role_check',
        $constraint$alter table public.stampy_messages add constraint stampy_messages_role_check check (role in ('user', 'assistant'))$constraint$),
      ('stampy_usage_logs', 'stampy_usage_logs_mode_check',
        $constraint$alter table public.stampy_usage_logs add constraint stampy_usage_logs_mode_check check (mode in ('direct', 'openai', 'blocked', 'error'))$constraint$),
      ('stampy_usage_logs', 'stampy_usage_logs_status_check',
        $constraint$alter table public.stampy_usage_logs add constraint stampy_usage_logs_status_check check (status in ('success', 'blocked', 'error'))$constraint$),
      ('stampy_usage_logs', 'stampy_usage_logs_counts_check',
        'alter table public.stampy_usage_logs add constraint stampy_usage_logs_counts_check check (message_chars >= 0 and (prompt_chars is null or prompt_chars >= 0) and (completion_chars is null or completion_chars >= 0) and (latency_ms is null or latency_ms >= 0))'),
      ('stampy_message_feedback', 'stampy_message_feedback_rating_check',
        $constraint$alter table public.stampy_message_feedback add constraint stampy_message_feedback_rating_check check (rating in ('positive', 'negative'))$constraint$),
      ('stampy_message_feedback', 'stampy_message_feedback_reason_check',
        $constraint$alter table public.stampy_message_feedback add constraint stampy_message_feedback_reason_check check (reason is null or reason in ('helpful', 'incorrect', 'too_generic', 'did_not_understand', 'did_not_use_context', 'bad_tool_recommendation', 'other'))$constraint$),
      ('stampy_message_feedback', 'stampy_message_feedback_comment_length_check',
        'alter table public.stampy_message_feedback add constraint stampy_message_feedback_comment_length_check check (comment is null or char_length(comment) <= 1000)'),
      ('stampy_action_requests', 'stampy_action_requests_action_type_check',
        $constraint$alter table public.stampy_action_requests add constraint stampy_action_requests_action_type_check check (action_type in ('discount_filament', 'add_filament', 'increase_filament_stock', 'add_printer', 'create_product', 'create_quote', 'calculate_price', 'update_stock', 'unknown_action'))$constraint$),
      ('stampy_action_requests', 'stampy_action_requests_status_check',
        $constraint$alter table public.stampy_action_requests add constraint stampy_action_requests_status_check check (status in ('suggested', 'opened_tool', 'cancelled', 'executed', 'error'))$constraint$),
      ('stampy_action_requests', 'stampy_action_requests_confidence_check',
        'alter table public.stampy_action_requests add constraint stampy_action_requests_confidence_check check (confidence >= 0 and confidence <= 1)'),
      ('stampy_page_contexts', 'stampy_page_contexts_match_type_check',
        $constraint$alter table public.stampy_page_contexts add constraint stampy_page_contexts_match_type_check check (match_type in ('exact', 'prefix'))$constraint$),
      ('stampy_page_contexts', 'stampy_page_contexts_route_check',
        $constraint$alter table public.stampy_page_contexts add constraint stampy_page_contexts_route_check check (route_pattern like '/%')$constraint$),
      ('lesson_transcripts', 'lesson_transcripts_status_check',
        $constraint$alter table public.lesson_transcripts add constraint lesson_transcripts_status_check check (status in ('draft', 'processing', 'ready', 'error'))$constraint$),
      ('lesson_transcripts', 'lesson_transcripts_duration_check',
        'alter table public.lesson_transcripts add constraint lesson_transcripts_duration_check check (duration_seconds is null or duration_seconds >= 0)'),
      ('lesson_transcripts', 'lesson_transcripts_segments_count_check',
        'alter table public.lesson_transcripts add constraint lesson_transcripts_segments_count_check check (segments_count >= 0)'),
      ('lesson_transcript_segments', 'lesson_transcript_segments_position_check',
        'alter table public.lesson_transcript_segments add constraint lesson_transcript_segments_position_check check (position >= 0)'),
      ('lesson_transcript_segments', 'lesson_transcript_segments_times_check',
        'alter table public.lesson_transcript_segments add constraint lesson_transcript_segments_times_check check ((start_seconds is null or start_seconds >= 0) and (end_seconds is null or end_seconds >= 0) and (start_seconds is null or end_seconds is null or end_seconds >= start_seconds))'),
      ('lesson_transcript_segments', 'lesson_transcript_segments_confidence_check',
        'alter table public.lesson_transcript_segments add constraint lesson_transcript_segments_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1))')
    ) as expected_constraints(table_name, constraint_name, definition)
  loop
    if not exists (
      select 1
      from pg_constraint
      where conrelid = format('public.%I', constraint_to_add.table_name)::regclass
        and conname = constraint_to_add.constraint_name
    ) then
      execute constraint_to_add.definition;
    end if;
  end loop;
end;
$$;

-- Read-path and observability indexes used by the current application.
create index if not exists stampy_conversations_user_last_message_idx
  on public.stampy_conversations (user_id, last_message_at desc);
create index if not exists stampy_conversations_created_at_idx
  on public.stampy_conversations (created_at desc);

create index if not exists stampy_messages_conversation_created_at_idx
  on public.stampy_messages (conversation_id, created_at);
create index if not exists stampy_messages_user_created_at_idx
  on public.stampy_messages (user_id, created_at desc);

create index if not exists stampy_usage_logs_user_created_at_idx
  on public.stampy_usage_logs (user_id, created_at desc);
create index if not exists stampy_usage_logs_status_created_at_idx
  on public.stampy_usage_logs (status, created_at desc);
create index if not exists stampy_usage_logs_conversation_idx
  on public.stampy_usage_logs (conversation_id);

create index if not exists stampy_message_feedback_conversation_created_at_idx
  on public.stampy_message_feedback (conversation_id, created_at desc);
create index if not exists stampy_message_feedback_user_created_at_idx
  on public.stampy_message_feedback (user_id, created_at desc);

create index if not exists stampy_action_requests_user_created_at_idx
  on public.stampy_action_requests (user_id, created_at desc);
create index if not exists stampy_action_requests_conversation_idx
  on public.stampy_action_requests (conversation_id);
create index if not exists stampy_action_requests_message_idx
  on public.stampy_action_requests (message_id);

create index if not exists stampy_page_contexts_active_priority_idx
  on public.stampy_page_contexts (is_active, priority desc);
create index if not exists stampy_page_contexts_route_match_idx
  on public.stampy_page_contexts (route_pattern, match_type);

create index if not exists stampy_knowledge_chunks_source_type_idx
  on public.stampy_knowledge_chunks (source_type);
create index if not exists stampy_knowledge_chunks_source_id_idx
  on public.stampy_knowledge_chunks (source_id);
create index if not exists stampy_knowledge_chunks_course_id_idx
  on public.stampy_knowledge_chunks (course_id);
create index if not exists stampy_knowledge_chunks_module_id_idx
  on public.stampy_knowledge_chunks (module_id);
create index if not exists stampy_knowledge_chunks_lesson_id_idx
  on public.stampy_knowledge_chunks (lesson_id);
create index if not exists stampy_knowledge_chunks_embedding_ivfflat_idx
  on public.stampy_knowledge_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100)
  where embedding is not null;

create index if not exists lesson_transcripts_status_idx
  on public.lesson_transcripts (status);
create index if not exists lesson_transcripts_imported_by_idx
  on public.lesson_transcripts (imported_by);

create index if not exists lesson_transcript_segments_lesson_idx
  on public.lesson_transcript_segments (lesson_id);
create index if not exists lesson_transcript_segments_transcript_idx
  on public.lesson_transcript_segments (transcript_id, position);

-- Keep updated_at aligned through the platform-wide trigger helper.
drop trigger if exists stampy_conversations_set_updated_at on public.stampy_conversations;
create trigger stampy_conversations_set_updated_at
before update on public.stampy_conversations
for each row execute function public.set_updated_at();

drop trigger if exists stampy_message_feedback_set_updated_at on public.stampy_message_feedback;
create trigger stampy_message_feedback_set_updated_at
before update on public.stampy_message_feedback
for each row execute function public.set_updated_at();

drop trigger if exists stampy_action_requests_set_updated_at on public.stampy_action_requests;
create trigger stampy_action_requests_set_updated_at
before update on public.stampy_action_requests
for each row execute function public.set_updated_at();

drop trigger if exists stampy_page_contexts_set_updated_at on public.stampy_page_contexts;
create trigger stampy_page_contexts_set_updated_at
before update on public.stampy_page_contexts
for each row execute function public.set_updated_at();

drop trigger if exists stampy_knowledge_chunks_set_updated_at on public.stampy_knowledge_chunks;
create trigger stampy_knowledge_chunks_set_updated_at
before update on public.stampy_knowledge_chunks
for each row execute function public.set_updated_at();

drop trigger if exists lesson_transcripts_set_updated_at on public.lesson_transcripts;
create trigger lesson_transcripts_set_updated_at
before update on public.lesson_transcripts
for each row execute function public.set_updated_at();

alter table public.stampy_conversations enable row level security;
alter table public.stampy_messages enable row level security;
alter table public.stampy_usage_logs enable row level security;
alter table public.stampy_message_feedback enable row level security;
alter table public.stampy_action_requests enable row level security;
alter table public.stampy_page_contexts enable row level security;
alter table public.stampy_knowledge_chunks enable row level security;
alter table public.lesson_transcripts enable row level security;
alter table public.lesson_transcript_segments enable row level security;

-- Conversations.
drop policy if exists stampy_conversations_select_own on public.stampy_conversations;
create policy stampy_conversations_select_own
on public.stampy_conversations for select to authenticated
using (user_id = auth.uid());

drop policy if exists stampy_conversations_insert_own on public.stampy_conversations;
create policy stampy_conversations_insert_own
on public.stampy_conversations for insert to authenticated
with check (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
);

drop policy if exists stampy_conversations_update_own on public.stampy_conversations;
create policy stampy_conversations_update_own
on public.stampy_conversations for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists stampy_conversations_admin_all on public.stampy_conversations;
create policy stampy_conversations_admin_all
on public.stampy_conversations for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Messages.
drop policy if exists stampy_messages_select_own on public.stampy_messages;
create policy stampy_messages_select_own
on public.stampy_messages for select to authenticated
using (user_id = auth.uid());

drop policy if exists stampy_messages_insert_own on public.stampy_messages;
create policy stampy_messages_insert_own
on public.stampy_messages for insert to authenticated
with check (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
  and exists (
    select 1
    from public.stampy_conversations as conversation
    where conversation.id = conversation_id
      and conversation.user_id = auth.uid()
  )
);

drop policy if exists stampy_messages_update_own on public.stampy_messages;
create policy stampy_messages_update_own
on public.stampy_messages for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.stampy_conversations as conversation
    where conversation.id = stampy_messages.conversation_id
      and conversation.user_id = auth.uid()
  )
);

drop policy if exists stampy_messages_admin_all on public.stampy_messages;
create policy stampy_messages_admin_all
on public.stampy_messages for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Usage logs.
drop policy if exists stampy_usage_logs_select_own on public.stampy_usage_logs;
create policy stampy_usage_logs_select_own
on public.stampy_usage_logs for select to authenticated
using (user_id = auth.uid());

drop policy if exists stampy_usage_logs_insert_own on public.stampy_usage_logs;
create policy stampy_usage_logs_insert_own
on public.stampy_usage_logs for insert to authenticated
with check (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
  and (
    conversation_id is null
    or exists (
      select 1
      from public.stampy_conversations as conversation
      where conversation.id = conversation_id
        and conversation.user_id = auth.uid()
    )
  )
);

drop policy if exists stampy_usage_logs_admin_all on public.stampy_usage_logs;
create policy stampy_usage_logs_admin_all
on public.stampy_usage_logs for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Feedback.
drop policy if exists stampy_message_feedback_select_own on public.stampy_message_feedback;
create policy stampy_message_feedback_select_own
on public.stampy_message_feedback for select to authenticated
using (user_id = auth.uid());

drop policy if exists stampy_message_feedback_insert_own on public.stampy_message_feedback;
create policy stampy_message_feedback_insert_own
on public.stampy_message_feedback for insert to authenticated
with check (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
  and exists (
    select 1
    from public.stampy_messages as message
    where message.id = stampy_message_feedback.message_id
      and message.conversation_id = stampy_message_feedback.conversation_id
      and message.user_id = auth.uid()
  )
);

drop policy if exists stampy_message_feedback_update_own on public.stampy_message_feedback;
create policy stampy_message_feedback_update_own
on public.stampy_message_feedback for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.stampy_messages as message
    where message.id = stampy_message_feedback.message_id
      and message.conversation_id = stampy_message_feedback.conversation_id
      and message.user_id = auth.uid()
  )
);

drop policy if exists stampy_message_feedback_admin_all on public.stampy_message_feedback;
create policy stampy_message_feedback_admin_all
on public.stampy_message_feedback for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Safe, non-executable action requests.
drop policy if exists stampy_action_requests_select_own on public.stampy_action_requests;
create policy stampy_action_requests_select_own
on public.stampy_action_requests for select to authenticated
using (user_id = auth.uid());

drop policy if exists stampy_action_requests_insert_own on public.stampy_action_requests;
create policy stampy_action_requests_insert_own
on public.stampy_action_requests for insert to authenticated
with check (
  user_id = auth.uid()
  and can_execute = false
  and public.has_platform_access(auth.uid())
  and exists (
    select 1
    from public.stampy_messages as message
    where message.id = stampy_action_requests.message_id
      and message.conversation_id = stampy_action_requests.conversation_id
      and message.user_id = auth.uid()
  )
);

drop policy if exists stampy_action_requests_update_own on public.stampy_action_requests;
create policy stampy_action_requests_update_own
on public.stampy_action_requests for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and can_execute = false
  and exists (
    select 1
    from public.stampy_messages as message
    where message.id = stampy_action_requests.message_id
      and message.conversation_id = stampy_action_requests.conversation_id
      and message.user_id = auth.uid()
  )
);

drop policy if exists stampy_action_requests_admin_all on public.stampy_action_requests;
create policy stampy_action_requests_admin_all
on public.stampy_action_requests for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Dynamic page context is readable only while active. Admins manage all rows.
drop policy if exists stampy_page_contexts_select_active on public.stampy_page_contexts;
create policy stampy_page_contexts_select_active
on public.stampy_page_contexts for select to authenticated
using (
  is_active = true
  and public.has_platform_access(auth.uid())
);

drop policy if exists stampy_page_contexts_admin_all on public.stampy_page_contexts;
create policy stampy_page_contexts_admin_all
on public.stampy_page_contexts for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Retrieved knowledge is read-only for platform users and managed by admins.
drop policy if exists stampy_knowledge_chunks_select_active on public.stampy_knowledge_chunks;
create policy stampy_knowledge_chunks_select_active
on public.stampy_knowledge_chunks for select to authenticated
using (
  is_active = true
  and public.has_platform_access(auth.uid())
);

drop policy if exists stampy_knowledge_chunks_admin_all on public.stampy_knowledge_chunks;
create policy stampy_knowledge_chunks_admin_all
on public.stampy_knowledge_chunks for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Ready transcripts support lesson chat; admins manage every state.
drop policy if exists lesson_transcripts_select_ready on public.lesson_transcripts;
create policy lesson_transcripts_select_ready
on public.lesson_transcripts for select to authenticated
using (
  status = 'ready'
  and public.has_platform_access(auth.uid())
);

drop policy if exists lesson_transcripts_admin_all on public.lesson_transcripts;
create policy lesson_transcripts_admin_all
on public.lesson_transcripts for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists lesson_transcript_segments_select_ready on public.lesson_transcript_segments;
create policy lesson_transcript_segments_select_ready
on public.lesson_transcript_segments for select to authenticated
using (
  public.has_platform_access(auth.uid())
  and exists (
    select 1
    from public.lesson_transcripts as transcript
    where transcript.id = lesson_transcript_segments.transcript_id
      and transcript.status = 'ready'
  )
);

drop policy if exists lesson_transcript_segments_admin_all on public.lesson_transcript_segments;
create policy lesson_transcript_segments_admin_all
on public.lesson_transcript_segments for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Exact RPC signature used by src/lib/stampy/retrieval.ts. The current caller
-- does not pass course, lesson, or path filters, so none are invented here.
create or replace function public.match_stampy_knowledge_chunks(
  query_embedding vector(1536),
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
security invoker
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
    1 - (chunk.embedding <=> query_embedding) as similarity
  from public.stampy_knowledge_chunks as chunk
  where chunk.is_active = true
    and chunk.embedding is not null
    and 1 - (chunk.embedding <=> query_embedding) >= match_threshold
  order by chunk.embedding <=> query_embedding
  limit greatest(least(coalesce(match_count, 8), 50), 0);
$$;

revoke all on table public.stampy_conversations from public, anon;
revoke all on table public.stampy_messages from public, anon;
revoke all on table public.stampy_usage_logs from public, anon;
revoke all on table public.stampy_message_feedback from public, anon;
revoke all on table public.stampy_action_requests from public, anon;
revoke all on table public.stampy_page_contexts from public, anon;
revoke all on table public.stampy_knowledge_chunks from public, anon;
revoke all on table public.lesson_transcripts from public, anon;
revoke all on table public.lesson_transcript_segments from public, anon;

grant select, insert, update, delete on table public.stampy_conversations to authenticated;
grant select, insert, update, delete on table public.stampy_messages to authenticated;
grant select, insert, update, delete on table public.stampy_usage_logs to authenticated;
grant select, insert, update, delete on table public.stampy_message_feedback to authenticated;
grant select, insert, update, delete on table public.stampy_action_requests to authenticated;
grant select, insert, update, delete on table public.stampy_page_contexts to authenticated;
grant select, insert, update, delete on table public.stampy_knowledge_chunks to authenticated;
grant select, insert, update, delete on table public.lesson_transcripts to authenticated;
grant select, insert, update, delete on table public.lesson_transcript_segments to authenticated;

grant all on table public.stampy_conversations to service_role;
grant all on table public.stampy_messages to service_role;
grant all on table public.stampy_usage_logs to service_role;
grant all on table public.stampy_message_feedback to service_role;
grant all on table public.stampy_action_requests to service_role;
grant all on table public.stampy_page_contexts to service_role;
grant all on table public.stampy_knowledge_chunks to service_role;
grant all on table public.lesson_transcripts to service_role;
grant all on table public.lesson_transcript_segments to service_role;

revoke all on function public.match_stampy_knowledge_chunks(
  vector, double precision, integer
) from public, anon, authenticated;
grant execute on function public.match_stampy_knowledge_chunks(
  vector, double precision, integer
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
