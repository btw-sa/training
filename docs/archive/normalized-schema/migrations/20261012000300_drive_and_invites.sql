-- =====================================================================
-- Support for the server functions in supabase/functions:
--   invite-user   — sends a sign-in invite and links the account to a profile
--   drive-connect — stores the company Google account's refresh token in Vault
--   drive-token   — short-lived drive.file token for Google's picker
--   drive-export  — writes a report or backup into the chosen Drive folder
-- Tokens are kept in Supabase Vault (encrypted). Only the service role can
-- read or write them; browsers never see the refresh token.
-- =====================================================================

-- What the signed-in person may do (drives which buttons the app shows; the database still checks every action).
create or replace function public.my_permissions()
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(k.key order by k.key), '{}') from public.permissions k where app.has_perm(k.key)
$$;

create or replace function public.my_profile_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select app.my_id()
$$;

-- Can the caller invite / link this profile? Used by invite-user before it acts.
create or replace function public.can_invite(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_perm('users.edit') and app.user_in_scope(p_id) and app.can_manage_target(p_id)
$$;

-- Record a requested Drive export after checking permission; the Edge Function does the upload.
create or replace function public.request_drive_export(p_kind text, p_report text, p_filters jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); v_id uuid;
begin
  if p_kind = 'backup' then perform app.need('data.backup');
  elsif p_kind = 'report' then perform app.need('reports.export');
  else perform app.fail('invalid'); end if;
  insert into public.exports (kind, report, format, filters, destination, requested_by, status)
  values (p_kind, p_report, case when p_kind = 'backup' then 'json' else 'csv' end, p_filters, 'drive', me.id, 'queued')
  returning id into v_id;
  return v_id;
end $$;

-- Retry only your own failed export (or any, for Admin/IT/Operations).
create or replace function public.retry_drive_export(p_export uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); x public.exports;
begin
  select * into x from public.exports where id = p_export;
  if x.id is null or (x.requested_by <> me.id and not app.is_global()) then perform app.fail('not_found'); end if;
  if x.status <> 'failed' then perform app.fail('conflict', 'Only failed exports can be retried.'); end if;
  update public.exports set status = 'queued', error = null where id = x.id;
end $$;

-- Vault access for the service role only.
create or replace function public.store_drive_refresh_token(p_token text, p_account text, p_by uuid)
returns void language plpgsql security definer set search_path = public, vault, pg_temp as $$
declare v_id uuid;
begin
  select vault_secret_id into v_id from public.integrations where provider = 'google_drive';
  if v_id is null then
    v_id := vault.create_secret(p_token, 'google_drive_refresh_token', 'Company Google account, drive.file scope');
  else
    perform vault.update_secret(v_id, p_token);
  end if;
  insert into public.integrations (provider, connected, account_email, scope, vault_secret_id, connected_by, connected_at)
  values ('google_drive', true, p_account, 'https://www.googleapis.com/auth/drive.file', v_id, p_by, now())
  on conflict (provider) do update set connected = true, account_email = excluded.account_email, vault_secret_id = v_id,
    connected_by = excluded.connected_by, connected_at = now();
end $$;

create or replace function public.get_drive_refresh_token()
returns text language plpgsql stable security definer set search_path = public, vault, pg_temp as $$
declare v text;
begin
  select ds.decrypted_secret into v from vault.decrypted_secrets ds
  join public.integrations i on i.vault_secret_id = ds.id where i.provider = 'google_drive' and i.connected;
  return v;
end $$;

revoke execute on function public.can_invite(uuid), public.request_drive_export(text, text, jsonb), public.retry_drive_export(uuid),
  public.store_drive_refresh_token(text, text, uuid), public.get_drive_refresh_token() from public, anon, authenticated;
grant execute on function public.can_invite(uuid), public.request_drive_export(text, text, jsonb), public.retry_drive_export(uuid),
  public.my_permissions(), public.my_profile_id() to authenticated;
grant execute on function public.store_drive_refresh_token(text, text, uuid), public.get_drive_refresh_token() to service_role;
