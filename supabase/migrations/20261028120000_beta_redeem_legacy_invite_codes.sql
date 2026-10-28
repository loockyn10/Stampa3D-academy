-- Beta access: the canje (redeem_beta_access_code) also honours the LEGACY beta codes of public.invite_codes.
--
-- Why: /admin/codigos creates codes in public.invite_codes (code_type beta_tester / manual_free_access), but the
-- visible redemption points (signup "código de invitación", Perfil, Sin acceso, PendingBetaCodeRedeemer) only
-- called redeem_beta_access_code, which only knows hashed beta_access_codes. Every code created from the admin
-- panel was therefore answered with "Código inválido". The legacy codes could only be consumed by the email-confirm
-- callback through the "Código de referido" field.
--
-- What this does (additive; nothing is copied, deleted or rewritten):
--   * replaces public.redeem_beta_access_code(text) keeping its signature, statuses, rate limit, grants and
--     privileges. When a code is not found among the hashed codes it is looked up in invite_codes.
--   * legacy lookups run inside the same security definer function, so the identity is still auth.uid(), the
--     brute-force counter is still the one shared with the hashed path and the invite row is locked FOR UPDATE
--     while the use is counted (no more lost increments / exceeding max_uses).
--   * only code_type beta_tester and manual_free_access are redeemable here. Discount / fixed_price codes are
--     NEVER granted access (they stay "invalid" for this function).
--   * invite_codes.used_count, invite_code_redemptions and user_access_grants are written exactly as the legacy
--     auth callback did (same columns, same grant_type = code_type), but extending an existing grant instead of
--     inserting a duplicate and never shortening it. The plaintext code is NOT written to grants.notes.
--   * existing redemptions are honoured: a user that already redeemed a legacy code gets "already_redeemed".
--
-- Does NOT touch has_platform_access(uuid), RLS, existing codes, redemptions, grants, subscriptions or profiles.
-- Requires 20261005120000_beta_access_codes.sql to be applied first. Safe to re-run (idempotent).

do $legacy_beta_dependencies$
declare
  v_missing text;
begin
  if to_regclass('public.beta_access_codes') is null
     or to_regclass('public.beta_access_redemptions') is null
     or to_regclass('public.beta_access_failed_attempts') is null
     or to_regprocedure('public.redeem_beta_access_code(text)') is null then
    raise exception 'Apply 20261005120000_beta_access_codes.sql first (Beta Access objects are missing). Nothing was changed.';
  end if;

  if to_regclass('public.invite_codes') is null or to_regclass('public.invite_code_redemptions') is null then
    raise exception 'public.invite_codes / public.invite_code_redemptions do not exist: there are no legacy codes to honour. Nothing was changed.';
  end if;

  -- The legacy tables are not versioned in this repo: verify the columns this migration relies on (fail closed).
  select string_agg(req.tbl || '.' || req.col, ', ') into v_missing
  from (values
    ('invite_codes', 'id'), ('invite_codes', 'code'), ('invite_codes', 'code_type'), ('invite_codes', 'status'),
    ('invite_codes', 'starts_at'), ('invite_codes', 'expires_at'), ('invite_codes', 'max_uses'),
    ('invite_codes', 'used_count'), ('invite_codes', 'access_expires_at'), ('invite_codes', 'title'),
    ('invite_code_redemptions', 'invite_code_id'), ('invite_code_redemptions', 'user_id'),
    ('invite_code_redemptions', 'redeemed_at')
  ) as req(tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = req.tbl and c.column_name = req.col
  );

  if v_missing is not null then
    raise exception 'Legacy invite tables are missing expected columns: %. Nothing was changed.', v_missing
      using hint = 'Run supabase/diagnostics/20261028_codes_state.sql and review the legacy table shape.';
  end if;

  -- The helper writes grant_type from a text value: refuse to continue if the column is not text-like (e.g. an enum).
  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'user_access_grants'
      and c.column_name = 'grant_type' and c.data_type in ('text', 'character varying')
  ) then
    raise exception 'public.user_access_grants.grant_type is not text/varchar. Nothing was changed.'
      using hint = 'Run supabase/diagnostics/20261028_codes_state.sql and review the column type.';
  end if;
end;
$legacy_beta_dependencies$;

-- ---------------------------------------------------------------------------
-- Internal helper: redeem a legacy invite code for p_uid. Not callable by API roles.
-- Returns {status, access_expires_at?}. 'invalid' also covers "not a redeemable legacy beta code".
-- The caller (redeem_beta_access_code) counts failed attempts and owns the rate limit.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_legacy_beta_invite(p_uid uuid, p_normalized_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_inv public.invite_codes%rowtype;
  v_type text;
  v_grant record;
  v_uses integer;
begin
  select * into v_inv
  from public.invite_codes
  where code = p_normalized_code
  for update;

  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  v_type := v_inv.code_type::text;
  if v_type not in ('beta_tester', 'manual_free_access') then
    -- Discount / fixed price codes never grant access.
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Idempotency: the same user never consumes a second use of the same code.
  if exists (
    select 1 from public.invite_code_redemptions r
    where r.invite_code_id = v_inv.id and r.user_id = p_uid
  ) then
    if exists (
      select 1 from public.user_access_grants g
      where g.user_id = p_uid and g.grant_type = v_type and g.status = 'active'
    ) then
      return jsonb_build_object('status', 'already_redeemed', 'access_expires_at', v_inv.access_expires_at);
    end if;
    return jsonb_build_object('status', 'revoked');
  end if;

  if v_inv.status::text <> 'active'
     or (v_inv.starts_at is not null and v_inv.starts_at > v_now) then
    return jsonb_build_object('status', 'invalid');
  end if;

  if (v_inv.expires_at is not null and v_inv.expires_at <= v_now)
     or (v_inv.access_expires_at is not null and v_inv.access_expires_at <= v_now) then
    return jsonb_build_object('status', 'expired');
  end if;

  -- The stored counter (legacy, possibly stale) and the real redemption rows can disagree: honour the larger one.
  select count(*) into v_uses from public.invite_code_redemptions r where r.invite_code_id = v_inv.id;
  if v_inv.max_uses is not null and greatest(coalesce(v_inv.used_count, 0), v_uses) >= v_inv.max_uses then
    return jsonb_build_object('status', 'exhausted');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('beta_access_grant:' || p_uid::text, 0));

  select g.id, g.status, g.expires_at into v_grant
  from public.user_access_grants g
  where g.user_id = p_uid and g.grant_type = v_type
  order by (g.status = 'active') desc, g.expires_at desc nulls first
  limit 1;

  if found then
    if v_grant.status = 'active' and (v_grant.expires_at is null or v_grant.expires_at > v_now) then
      -- Live access already: only ever extend it, never shorten or downgrade it.
      if v_grant.expires_at is not null
         and (v_inv.access_expires_at is null or v_inv.access_expires_at > v_grant.expires_at) then
        update public.user_access_grants set expires_at = v_inv.access_expires_at where id = v_grant.id;
      end if;
    else
      update public.user_access_grants
      set status = 'active',
          expires_at = v_inv.access_expires_at,
          notes = 'Código de invitación: ' || coalesce(nullif(btrim(v_inv.title), ''), v_type)
      where id = v_grant.id;
    end if;
  else
    insert into public.user_access_grants (user_id, grant_type, status, expires_at, notes)
    values (p_uid, v_type, 'active', v_inv.access_expires_at,
            'Código de invitación: ' || coalesce(nullif(btrim(v_inv.title), ''), v_type));
  end if;

  insert into public.invite_code_redemptions (invite_code_id, user_id, redeemed_at)
  values (v_inv.id, p_uid, v_now);

  update public.invite_codes set used_count = coalesce(used_count, 0) + 1 where id = v_inv.id;

  return jsonb_build_object('status', 'redeemed', 'access_expires_at', v_inv.access_expires_at);
end;
$$;

revoke all on function public.redeem_legacy_beta_invite(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- redeem_beta_access_code: same contract as 20261005120000 (statuses, rate limit, idempotency, privileges), plus the
-- legacy lookup when the code is not a hashed Beta code. Hashed codes always win.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_beta_access_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_norm text;
  v_code public.beta_access_codes%rowtype;
  v_existing public.beta_access_redemptions%rowtype;
  v_grant record;
  v_uses integer;
  v_user_failures integer;
  v_legacy jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;

  -- Housekeeping + brute-force guard: 5 invalid attempts / 15 min PER USER (shared by hashed and legacy codes).
  delete from public.beta_access_failed_attempts where attempted_at < v_now - interval '1 day';

  select count(*) into v_user_failures
  from public.beta_access_failed_attempts
  where user_id = v_uid and attempted_at > v_now - interval '15 minutes';

  if v_user_failures >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  v_norm := public.normalize_beta_access_code(p_code);

  -- Legacy codes are created by hand in /admin/codigos and can be short (e.g. BETA50): accept 3-64 chars for them.
  if v_norm !~ '^[^[:space:]]{3,64}$' then
    insert into public.beta_access_failed_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_norm ~ '^[A-Z0-9][A-Z0-9_-]{7,63}$' then
    select * into v_code
    from public.beta_access_codes
    where code_digest = public.beta_access_code_digest(v_norm)
    for update;
  end if;

  if v_code.id is null then
    v_legacy := public.redeem_legacy_beta_invite(v_uid, v_norm);
    if v_legacy->>'status' = 'invalid' then
      insert into public.beta_access_failed_attempts (user_id) values (v_uid);
    end if;
    return v_legacy;
  end if;

  -- Idempotency: the same user never consumes a second use of the same code.
  select * into v_existing
  from public.beta_access_redemptions
  where code_id = v_code.id and user_id = v_uid;

  if found then
    if v_existing.revoked_at is not null
       or not exists (
         select 1 from public.user_access_grants g
         where g.user_id = v_uid and g.grant_type = 'beta_tester' and g.status = 'active'
       ) then
      return jsonb_build_object('status', 'revoked');
    end if;
    return jsonb_build_object('status', 'already_redeemed', 'access_expires_at', v_existing.access_expires_at);
  end if;

  if not v_code.active then
    insert into public.beta_access_failed_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'invalid');
  end if;

  if (v_code.redeem_until is not null and v_now > v_code.redeem_until)
     or (v_code.access_expires_at is not null and v_now >= v_code.access_expires_at) then
    return jsonb_build_object('status', 'expired');
  end if;

  select count(*) into v_uses from public.beta_access_redemptions where code_id = v_code.id;

  if v_code.max_uses is not null and v_uses >= v_code.max_uses then
    return jsonb_build_object('status', 'exhausted');
  end if;

  -- Grant (independent from the paid membership; never touches profiles / subscriptions).
  perform pg_advisory_xact_lock(hashtextextended('beta_access_grant:' || v_uid::text, 0));

  select g.id, g.status, g.expires_at into v_grant
  from public.user_access_grants g
  where g.user_id = v_uid and g.grant_type = 'beta_tester'
  order by (g.status = 'active') desc, g.expires_at desc nulls first
  limit 1;

  if found then
    if v_grant.status = 'active' and (v_grant.expires_at is null or v_grant.expires_at > v_now) then
      -- Already has live beta access: only ever extend it, never shorten or downgrade it.
      if v_grant.expires_at is not null
         and (v_code.access_expires_at is null or v_code.access_expires_at > v_grant.expires_at) then
        update public.user_access_grants
        set expires_at = v_code.access_expires_at
        where id = v_grant.id;
      end if;
    else
      update public.user_access_grants
      set status = 'active',
          expires_at = v_code.access_expires_at,
          notes = 'Código beta: ' || v_code.label
      where id = v_grant.id;
    end if;
  else
    insert into public.user_access_grants (user_id, grant_type, status, expires_at, notes)
    values (v_uid, 'beta_tester', 'active', v_code.access_expires_at, 'Código beta: ' || v_code.label);
  end if;

  insert into public.beta_access_redemptions (code_id, user_id, redeemed_at, access_expires_at)
  values (v_code.id, v_uid, v_now, v_code.access_expires_at);

  return jsonb_build_object('status', 'redeemed', 'access_expires_at', v_code.access_expires_at);
end;
$$;

revoke all on function public.redeem_beta_access_code(text) from public, anon, authenticated;
grant execute on function public.redeem_beta_access_code(text) to authenticated;

notify pgrst, 'reload schema';
