-- BTW Training — one-time database setup for the live site.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Running it again is safe.
--
-- What it creates:
--   app_state          one row holding all training data (people, courses, results). Only the server
--                      (the btw-api Edge Function, using the service key) can read or write it.
--   app_state_history  automatic copies of recent saves: the last 10, plus the last save of each of
--                      the past 14 days. Use them to undo a mistake (see docs/go-live.md).
--   audit_log          every change, kept permanently (the app keeps only the latest 500 in view).
--   storage bucket "cards"  private PDF storage for product cards (50 MB per file, PDF only).
-- Nothing here is readable with the public (publishable / anon) key.

create table if not exists public.app_state (
  id         int primary key check (id = 1),
  doc        jsonb not null,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_state_history (
  id       bigserial primary key,
  version  bigint not null,
  doc      jsonb not null,
  saved_at timestamptz not null default now()
);
create index if not exists app_state_history_saved_at on public.app_state_history (saved_at);

create table if not exists public.audit_log (
  id         bigserial primary key,
  at         timestamptz,
  action     text,
  actor_id   text,
  entry      jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_at on public.audit_log (at desc);

-- Locked down: row-level security on, no policies, no grants to the public roles.
alter table public.app_state enable row level security;
alter table public.app_state_history enable row level security;
alter table public.audit_log enable row level security;
revoke all on public.app_state, public.app_state_history, public.audit_log from anon, authenticated;
revoke all on sequence public.app_state_history_id_seq, public.audit_log_id_seq from anon, authenticated;

-- Saves only if nobody else saved since this copy was read (p_version); returns the new version,
-- or null when the caller must reload and try again. Audit entries are written in the same step.
create or replace function public.btw_save_state(p_version bigint, p_doc jsonb, p_audit jsonb default '[]'::jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v bigint;
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    raise exception 'btw_save_state: document must be an object';
  end if;

  if p_version = 0 then
    insert into app_state (id, doc, version) values (1, p_doc, 1)
    on conflict (id) do nothing;
    if not found then return null; end if;
    v := 1;
  else
    update app_state set doc = p_doc, version = version + 1, updated_at = now()
     where id = 1 and version = p_version
    returning version into v;
    if v is null then return null; end if;
  end if;

  insert into audit_log (at, action, actor_id, entry)
  select (e->>'at')::timestamptz, e->>'action', e->>'actorId', e
    from jsonb_array_elements(coalesce(p_audit, '[]'::jsonb)) as e;

  insert into app_state_history (version, doc) values (v, p_doc);
  delete from app_state_history h
   where h.id not in (select id from app_state_history order by id desc limit 10)
     and (h.saved_at < now() - interval '14 days'
          or exists (select 1 from app_state_history h2
                      where h2.saved_at::date = h.saved_at::date and h2.id > h.id));
  return v;
end;
$$;

revoke all on function public.btw_save_state(bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.btw_save_state(bigint, jsonb, jsonb) to service_role;
grant select, insert, update, delete on public.app_state, public.app_state_history, public.audit_log to service_role;
grant usage, select on sequence public.app_state_history_id_seq, public.audit_log_id_seq to service_role;

-- Private storage for product-card PDFs. Files are reached only through short-lived signed links
-- that the server hands to people allowed to see them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cards', 'cards', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- To undo a mistake, find a good copy:
--   select id, version, saved_at from app_state_history order by id desc;
-- and put it back (replace 123 with the id you chose):
--   update app_state set doc = (select doc from app_state_history where id = 123), version = version + 1 where id = 1;
