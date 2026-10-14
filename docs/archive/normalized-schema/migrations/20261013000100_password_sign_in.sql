-- =====================================================================
-- Sign-in with an employee code or a work email, and a password that a
-- manager sets. Replaces Google sign-in and email invites.
--
-- How it works (see supabase/functions):
--   set-password    a manager opens an account or resets a password
--   password-login  turns an employee code or email into a session
--   change-password a person replaces their own (temporary) password
-- Supabase Auth stores the password (bcrypt). This file only tracks who set
-- it, whether it is temporary, sign-in attempts, and the permission checks.
-- =====================================================================

alter table public.profiles
  add column must_change_password boolean not null default true,
  add column password_set_at timestamptz,
  add column password_set_by uuid references public.profiles (id),
  add column last_sign_in_at timestamptz;

-- Sign-in attempts, for lock-out after repeated failures. Only the service role touches this table.
create table public.login_attempts (
  id bigint generated always as identity primary key,
  identifier text not null,
  ip text,
  succeeded boolean not null,
  at timestamptz not null default now()
);
create index login_attempts_lookup on public.login_attempts (identifier, at desc);
create index login_attempts_ip on public.login_attempts (ip, at desc);
alter table public.login_attempts enable row level security;   -- no policies: invisible to app users
revoke all on public.login_attempts from anon, authenticated;

-- The audit trigger normally takes the actor from the signed-in session. Server functions that act
-- with the service role on a manager's behalf name that manager in the setting app.actor instead.
create or replace function app.audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor public.profiles;
  row_key text;
  named text := nullif(current_setting('app.actor', true), '');
begin
  select * into actor from public.profiles where auth_user_id = auth.uid();
  if actor.id is null and auth.uid() is null and named is not null then
    select * into actor from public.profiles where id = named::uuid;
  end if;
  row_key := case when tg_op = 'DELETE' then to_jsonb(old) ->> 'id' else to_jsonb(new) ->> 'id' end;
  if row_key is null then
    row_key := case when tg_op = 'DELETE' then (to_jsonb(old) ->> 'user_id') else (to_jsonb(new) ->> 'user_id') end;
  end if;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, before, after, reason)
  values (actor.id, coalesce(actor.role::text, 'system'), lower(tg_op), tg_table_name, row_key,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          nullif(current_setting('app.reason', true), ''));
  return coalesce(new, old);
end $$;
revoke execute on function app.audit() from authenticated, anon, public;

-- May the signed-in manager set this person's password?
-- Same rule as editing the person: "add and edit people", in scope, and below the manager's own role.
create or replace function public.can_set_password(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_id <> coalesce(app.my_id(), '00000000-0000-0000-0000-000000000000'::uuid)
     and app.has_perm('users.edit') and app.user_in_scope(p_id) and app.can_manage_target(p_id)
     and exists (select 1 from public.profiles where id = p_id and status = 'active')
$$;

-- ---------------------------------------------------------------------
-- Service-role only (called by the server functions, never by browsers)
-- ---------------------------------------------------------------------

-- Find the account for an employee code or email, unless sign-in is locked.
-- Locked: 5 failed attempts for this identifier in 15 minutes, or 30 from one IP address.
create or replace function public.resolve_login(p_identifier text, p_ip text)
returns table (auth_user_id uuid, profile_id uuid, must_change boolean, locked boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare k text := lower(trim(coalesce(p_identifier, '')));
begin
  if (select count(*) from public.login_attempts a where a.identifier = k and not a.succeeded and a.at > now() - interval '15 minutes') >= 5
     or (p_ip is not null and (select count(*) from public.login_attempts a where a.ip = p_ip and not a.succeeded and a.at > now() - interval '15 minutes') >= 30) then
    return query select null::uuid, null::uuid, false, true;
    return;
  end if;
  return query
    select p.auth_user_id, p.id, p.must_change_password, false
    from public.profiles p
    where p.status = 'active' and p.auth_user_id is not null
      and (lower(p.email) = k or lower(p.employee_code) = k)
    limit 1;
end $$;

create or replace function public.record_login(p_identifier text, p_ip text, p_ok boolean, p_profile uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare k text := lower(trim(coalesce(p_identifier, ''))); fails int;
begin
  insert into public.login_attempts (identifier, ip, succeeded) values (k, p_ip, p_ok);
  if p_ok then
    delete from public.login_attempts where identifier = k and not succeeded;
    update public.profiles set last_sign_in_at = now() where id = p_profile;
  else
    select count(*) into fails from public.login_attempts where identifier = k and not succeeded and at > now() - interval '15 minutes';
    if fails = 5 then
      insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, after)
      values (null, 'system', 'sign_in_locked', 'login_attempts', k, jsonb_build_object('ip', p_ip, 'minutes', 15));
    end if;
  end if;
  delete from public.login_attempts where at < now() - interval '30 days';
end $$;

-- After set-password changed the password in Supabase Auth: record who did it and whether it is temporary.
create or replace function public.record_password_set(p_profile uuid, p_by uuid, p_must_change boolean, p_auth_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = p_profile;
  perform set_config('app.actor', p_by::text, true);
  perform set_config('app.reason', case when p.auth_user_id is null then 'account opened' else 'password reset' end, true);
  update public.profiles set auth_user_id = coalesce(auth_user_id, p_auth_user), must_change_password = coalesce(p_must_change, true),
    password_set_at = now(), password_set_by = p_by, updated_by = p_by, updated_at = now()
  where id = p_profile;
  -- A reset also clears any lock-out on this person's identifiers.
  delete from public.login_attempts where identifier in (lower(p.email), lower(p.employee_code)) and not succeeded;
end $$;

-- After change-password replaced a person's own password.
create or replace function public.record_own_password_change(p_auth_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid;
begin
  select id into pid from public.profiles where auth_user_id = p_auth_user;
  perform set_config('app.actor', pid::text, true);
  perform set_config('app.reason', 'changed own password', true);
  update public.profiles set must_change_password = false, password_set_at = now(), password_set_by = pid where id = pid;
end $$;

-- Invites by email are no longer used.
drop function if exists public.can_invite(uuid);

revoke execute on function public.can_set_password(uuid), public.resolve_login(text, text), public.record_login(text, text, boolean, uuid),
  public.record_password_set(uuid, uuid, boolean, uuid), public.record_own_password_change(uuid) from public, anon, authenticated;
grant execute on function public.can_set_password(uuid) to authenticated;
grant execute on function public.resolve_login(text, text), public.record_login(text, text, boolean, uuid),
  public.record_password_set(uuid, uuid, boolean, uuid), public.record_own_password_change(uuid) to service_role;
