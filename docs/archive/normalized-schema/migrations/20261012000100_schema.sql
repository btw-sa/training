-- =====================================================================
-- Coffee Training Platform — schema, permission rules, audit log
-- Target: Supabase (Postgres 15+). Tested with Postgres 16 (see supabase/tests).
--
-- Rules of thumb used throughout:
--   * Every table has row-level security (RLS) switched on.
--   * Reads are allowed by RLS policies that call the helpers in schema "app".
--   * Sensitive writes (people, access, grading, certificates, publishing,
--     settings) happen only through SECURITY DEFINER functions that re-check
--     role, Admin-granted permissions, scope and rank. Plain table grants for
--     those tables are revoked, so the API cannot bypass the functions.
--   * Every change to people, access, content, records and certificates is
--     written to audit_log by trigger. audit_log cannot be edited or deleted.
-- =====================================================================

create schema if not exists app;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.app_role as enum ('admin', 'it_manager', 'ops_manager', 'area_manager', 'staff');
create type public.user_status as enum ('active', 'inactive');
create type public.course_status as enum ('draft', 'published', 'archived');
create type public.exam_kind as enum ('section', 'final');
create type public.question_type as enum ('mc', 'tf');
create type public.review_mode as enum ('none', 'after_submit', 'after_pass');
create type public.signoff_status as enum ('passed', 'needs_practice', 'not_assessed');
create type public.cert_status as enum ('valid', 'revoked', 'replaced');
create type public.issue_status as enum ('open', 'resolved');
create type public.export_status as enum ('queued', 'running', 'succeeded', 'failed');
create type public.reminder_trigger as enum ('assigned', 'due_soon', 'overdue');

-- ---------------------------------------------------------------------
-- Organisation
-- ---------------------------------------------------------------------
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  business_name_en text not null default 'By The Way',
  business_name_ar text not null default 'باي ذا واي',
  cert_prefix text not null default 'BTW' check (cert_prefix ~ '^[A-Z0-9]{2,6}$'),
  default_language text not null default 'ar' check (default_language in ('ar', 'en')),
  sequential_sections boolean not null default false,
  default_due_days int not null default 14 check (default_due_days between 1 and 365),
  certificate_line_en text not null default 'has successfully completed the training programme',
  certificate_line_ar text not null default 'أتمّ بنجاح البرنامج التدريبي',
  kpi jsonb not null default '{"overdueDays":7,"failedAttempts":2,"lowAverage":70,"needsPracticeDays":14,"inactiveDays":14,"minSignals":2}',
  retention jsonb not null default '{"inactiveUserYears":3,"auditYears":5}',
  privacy_en text not null default '',
  privacy_ar text not null default '',
  verify_base_url text not null default 'https://training.yourdomain.com/verify/',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text not null,
  city_en text,
  city_ar text,
  active boolean not null default true
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id),
  name_en text not null,
  name_ar text not null,
  active boolean not null default true
);

-- People. A profile can exist before its owner first signs in (invites, CSV
-- import); auth_user_id links it to the Supabase Auth account once accepted.
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  employee_code text,
  full_name_en text not null check (length(trim(full_name_en)) > 0),
  full_name_ar text,
  email text check (email is null or email ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  phone text check (phone is null or phone ~ '^\+?[0-9 ]{7,16}$'),
  role public.app_role not null default 'staff',
  location_id uuid not null references public.locations (id),
  team_id uuid references public.teams (id),
  job_title text,
  hire_date date,
  language text not null default 'ar' check (language in ('ar', 'en')),
  status public.user_status not null default 'active',
  deactivated_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  check (email is not null or employee_code is not null)
);
create unique index profiles_email_key on public.profiles (lower(email)) where email is not null;
create unique index profiles_code_key on public.profiles (lower(employee_code)) where employee_code is not null;
create index profiles_location_idx on public.profiles (location_id);
create index profiles_team_idx on public.profiles (team_id);

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
create table public.permissions (
  key text primary key,
  grp text not null,
  label_en text not null,
  label_ar text not null,
  grantable boolean not null   -- may an Admin grant it to an Area Manager?
);

create table public.role_permissions (
  role public.app_role not null,
  permission text not null references public.permissions (key),
  primary key (role, permission)
);

create table public.area_manager_permissions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  permission text not null references public.permissions (key),
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, permission)
);

create table public.area_manager_scope (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('location', 'team', 'user', 'course')),
  target_id uuid not null,
  granted_by uuid references public.profiles (id),
  primary key (user_id, kind, target_id)
);

insert into public.permissions (key, grp, label_en, label_ar, grantable) values
  ('users.view', 'people', 'View people records', 'عرض سجلات الموظفين', true),
  ('users.edit', 'people', 'Add and edit people', 'إضافة الموظفين وتعديل بياناتهم', true),
  ('users.deactivate', 'people', 'Deactivate or reactivate people', 'إيقاف الحسابات وإعادة تفعيلها', true),
  ('users.import', 'people', 'Import people from CSV', 'استيراد الموظفين من ملف CSV', true),
  ('users.remove', 'people', 'Remove people with no training history', 'حذف موظف ليس له سجل تدريبي', false),
  ('users.role', 'people', 'Change roles', 'تغيير الأدوار', false),
  ('access.grant', 'people', 'Grant Area Manager access', 'منح صلاحيات مديري المناطق', false),
  ('org.manage', 'people', 'Manage locations and teams', 'إدارة الفروع والفرق', false),
  ('content.edit', 'content', 'Create and edit courses and sections', 'إنشاء الدورات والأقسام وتعديلها', true),
  ('content.publish', 'content', 'Publish, archive and version courses', 'نشر الدورات وأرشفتها وإصدار نسخ جديدة', true),
  ('files.manage', 'content', 'Attach and arrange Drive files', 'إرفاق ملفات Drive وترتيبها', true),
  ('exams.manage', 'content', 'Create and edit quizzes and exams', 'إنشاء الاختبارات وتعديلها', true),
  ('issues.manage', 'content', 'Resolve problem reports', 'معالجة بلاغات المحتوى', true),
  ('content.delete', 'content', 'Delete courses nobody has started', 'حذف دورة لم يبدأها أحد', false),
  ('faq.manage', 'content', 'Edit help and FAQ', 'تحرير المساعدة والأسئلة الشائعة', false),
  ('assign.manage', 'training', 'Assign training', 'إسناد التدريب', true),
  ('progress.view', 'training', 'View progress and scores', 'عرض التقدم والدرجات', true),
  ('signoff.manage', 'training', 'Sign off practical skills', 'اعتماد المهارات العملية', true),
  ('records.correct', 'training', 'Correct training records', 'تصحيح السجلات التدريبية', true),
  ('reminders.manage', 'training', 'Manage reminders', 'إدارة التذكيرات', true),
  ('certs.view', 'certs', 'View certificates', 'عرض الشهادات', true),
  ('certs.reissue', 'certs', 'Reissue certificates', 'إعادة إصدار الشهادات', true),
  ('certs.revoke', 'certs', 'Revoke certificates', 'إلغاء الشهادات', true),
  ('reports.view', 'reports', 'View dashboard and reports', 'عرض لوحة المؤشرات والتقارير', true),
  ('reports.export', 'reports', 'Export reports', 'تصدير التقارير', true),
  ('settings.training', 'system', 'Training settings', 'إعدادات التدريب', false),
  ('settings.kpi', 'system', 'KPI thresholds', 'حدود مؤشرات الأداء', false),
  ('settings.system', 'system', 'System settings', 'إعدادات النظام', false),
  ('integrations.manage', 'system', 'Google Drive and email connections', 'ربط Google Drive والبريد', false),
  ('data.backup', 'system', 'Backups and full data export', 'النسخ الاحتياطي وتصدير البيانات', false),
  ('audit.view', 'system', 'Audit log', 'سجل التدقيق', false);

-- Admin: everything. IT Manager: everything except granting Area Manager access.
-- Operations Manager: people, training, certificates, reports and training
-- settings — not system settings, KPI thresholds, integrations, backups or audit.
insert into public.role_permissions (role, permission) select 'admin', key from public.permissions;
insert into public.role_permissions (role, permission) select 'it_manager', key from public.permissions where key <> 'access.grant';
insert into public.role_permissions (role, permission) select 'ops_manager', key from public.permissions
  where key not in ('access.grant', 'settings.kpi', 'settings.system', 'integrations.manage', 'data.backup', 'audit.view');

-- ---------------------------------------------------------------------
-- Training content
-- ---------------------------------------------------------------------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  title_en text not null,
  title_ar text not null,
  description_en text,
  description_ar text,
  status public.course_status not null default 'draft',
  version int not null default 0,
  review_due date,
  due_days int not null default 14 check (due_days between 1 and 365),
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table public.course_versions (
  course_id uuid not null references public.courses (id) on delete cascade,
  version int not null,
  note text,
  retrain_required boolean not null default false,
  published_by uuid references public.profiles (id),
  published_at timestamptz not null default now(),
  primary key (course_id, version)
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  position int not null,
  title_en text not null,
  title_ar text not null,
  instructions_en text,
  instructions_ar text,
  required boolean not null default true
);
create index sections_course_idx on public.sections (course_id, position);

-- Only a link to the Drive file is stored. The Drive file itself is never moved or changed.
create table public.section_files (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  position int not null,
  drive_file_id text not null,
  title text not null,
  mime_type text,
  size_bytes bigint,
  web_view_link text,
  added_by uuid references public.profiles (id),
  added_at timestamptz not null default now(),
  unique (section_id, drive_file_id)
);

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  section_id uuid unique references public.sections (id) on delete cascade,
  kind public.exam_kind not null,
  title_en text not null,
  title_ar text not null,
  pass_pct int not null check (pass_pct between 1 and 100),
  time_limit_min int not null default 0 check (time_limit_min between 0 and 180),
  max_attempts int not null default 3 check (max_attempts between 0 and 10),   -- 0 = unlimited
  allow_retake boolean not null default true,
  review public.review_mode not null default 'after_submit',
  shuffle boolean not null default false,
  check ((kind = 'final') = (section_id is null))
);
create unique index exams_one_final_per_course on public.exams (course_id) where kind = 'final';

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  position int not null,
  type public.question_type not null,
  prompt_en text not null,
  prompt_ar text not null
);

-- Learners have no read access to this table. They receive choice text
-- through start_attempt(), which never includes is_correct.
create table public.choices (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  position int not null,
  text_en text not null,
  text_ar text not null,
  is_correct boolean not null default false
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses (id) on delete cascade,
  title_en text not null,
  title_ar text not null,
  description_en text,
  description_ar text,
  requires_signoff boolean not null default true
);

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  question_en text not null,
  question_ar text not null,
  answer_en text not null,
  answer_ar text not null,
  tags text[] not null default '{}',
  published boolean not null default true
);

-- ---------------------------------------------------------------------
-- Training records
-- ---------------------------------------------------------------------
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  target_kind text not null check (target_kind in ('user', 'team', 'location', 'role')),
  target_id uuid,
  target_role public.app_role,
  due_on date,
  assigned_by uuid references public.profiles (id),
  scope jsonb,                 -- snapshot of an Area Manager's scope at assignment time
  created_at timestamptz not null default now(),
  check ((target_kind = 'role') = (target_role is not null))
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  course_version int not null,
  assignment_id uuid references public.assignments (id) on delete set null,
  assigned_at timestamptz not null default now(),
  due_on date,
  started_at timestamptz,
  completed_at timestamptz,
  active boolean not null default true,
  superseded_at timestamptz
);
create unique index enrollments_one_active on public.enrollments (user_id, course_id) where active;

create table public.section_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  course_version int not null,
  viewed_file_ids uuid[] not null default '{}',
  completed_at timestamptz,
  corrected boolean not null default false,
  primary key (user_id, section_id, course_version)
);

create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_version int not null,
  attempt_no int not null,
  question_order uuid[] not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  submitted_at timestamptz,
  answers jsonb not null default '{}',
  score_pct int check (score_pct between 0 and 100),
  passed boolean,
  late boolean not null default false,
  corrected boolean not null default false,
  unique (exam_id, user_id, course_version, attempt_no)
);

create table public.skill_signoffs (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.signoff_status not null,
  notes text check (notes is null or length(notes) <= 500),
  assessed_by uuid not null references public.profiles (id),
  assessed_at timestamptz not null default now()
);
create index skill_signoffs_lookup on public.skill_signoffs (skill_id, user_id, assessed_at desc);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  cert_no text not null unique,
  user_id uuid not null references public.profiles (id),
  course_id uuid not null references public.courses (id),
  course_version int not null,
  holder_name_en text not null,
  holder_name_ar text,
  business_name_en text not null,
  business_name_ar text not null,
  course_title_en text not null,
  course_title_ar text not null,
  completed_on date not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references public.profiles (id),      -- null = issued automatically
  status public.cert_status not null default 'valid',
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  revoke_reason text,
  replaces uuid references public.certificates (id)
);

create table public.record_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  entity text not null,
  entity_id uuid not null,
  field text not null,
  old_value text,
  new_value text,
  reason text not null check (length(trim(reason)) >= 5),
  corrected_by uuid not null references public.profiles (id),
  corrected_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Reminders, support, data
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title_en text not null,
  title_ar text not null,
  body_en text,
  body_ar text,
  link text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.reminder_rules (
  id uuid primary key default gen_random_uuid(),
  trigger public.reminder_trigger not null,
  days int not null default 0 check (days between 0 and 60),
  repeat_every_days int not null default 0 check (repeat_every_days between 0 and 30),
  max_sends int not null default 1 check (max_sends between 1 and 10),
  channels text[] not null default '{in_app}' check (channels <@ array['in_app', 'email']),
  template_en text not null,
  template_ar text not null,
  active boolean not null default true,
  created_by uuid references public.profiles (id),
  scope jsonb
);

create table public.reminder_log (
  rule_id uuid not null references public.reminder_rules (id) on delete cascade,
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  send_no int not null,
  channels text[] not null,
  sent_at timestamptz not null default now(),
  primary key (rule_id, enrollment_id, send_no)
);

create table public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  section_id uuid references public.sections (id) on delete cascade,
  file_id uuid references public.section_files (id) on delete set null,
  message text not null check (length(trim(message)) between 5 and 1000),
  status public.issue_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles (id),
  resolution_note text
);

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('report', 'backup')),
  report text,
  format text not null,
  filters jsonb,
  destination text not null check (destination in ('download', 'drive')),
  requested_by uuid references public.profiles (id),
  drive_folder_id text,
  drive_file_id text,
  drive_file_name text,
  status public.export_status not null default 'queued',
  error text,
  attempts int not null default 0,
  row_count int,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- Connection details only. Tokens live in Supabase Vault and are referenced by id.
create table public.integrations (
  provider text primary key check (provider in ('google_drive', 'email')),
  connected boolean not null default false,
  account_email text,
  scope text,
  reports_folder_id text,
  backups_folder_id text,
  email_provider text,
  vault_secret_id uuid,
  connected_by uuid references public.profiles (id),
  connected_at timestamptz
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_role text not null,
  action text not null,
  table_name text not null,
  row_id text,
  before jsonb,
  after jsonb,
  reason text
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_row_idx on public.audit_log (table_name, row_id);

-- =====================================================================
-- Helpers (schema app). They only answer questions about the caller.
-- =====================================================================

create or replace function app.fail(code text, message text default null)
returns void language plpgsql as $$
begin
  raise exception '%', code using errcode = 'P0001', hint = coalesce(message, code);
end $$;

create or replace function app.rank(r public.app_role)
returns int language sql immutable as $$
  select case r when 'admin' then 100 when 'it_manager' then 90 when 'ops_manager' then 80 when 'area_manager' then 50 else 10 end
$$;

create or replace function app.me()
returns public.profiles language sql stable security definer set search_path = public, pg_temp as $$
  select p.* from public.profiles p where p.auth_user_id = auth.uid() and p.status = 'active' limit 1
$$;

create or replace function app.my_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select p.id from public.profiles p where p.auth_user_id = auth.uid() and p.status = 'active' limit 1
$$;

create or replace function app.has_perm(p text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles me
    where me.auth_user_id = auth.uid() and me.status = 'active'
      and (
        (me.role <> 'area_manager' and exists (select 1 from public.role_permissions rp where rp.role = me.role and rp.permission = p))
        or (me.role = 'area_manager' and exists (
              select 1 from public.area_manager_permissions g
              join public.permissions k on k.key = g.permission and k.grantable
              where g.user_id = me.id and g.permission = p))
      )
  )
$$;

create or replace function app.is_global()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select app.rank(role) >= 80 from public.profiles where auth_user_id = auth.uid() and status = 'active'), false)
$$;

create or replace function app.user_in_scope(target uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select * from public.profiles where auth_user_id = auth.uid() and status = 'active'),
       t as (select * from public.profiles where id = target)
  select case
    when not exists (select 1 from me) or not exists (select 1 from t) then false
    when (select app.rank(role) from me) >= 80 then true
    when target = (select id from me) then true
    when (select role from me) <> 'area_manager' then false
    else exists (
      select 1 from public.area_manager_scope s, me, t
      where s.user_id = me.id and (
        (s.kind = 'location' and s.target_id = t.location_id) or
        (s.kind = 'team' and s.target_id = t.team_id) or
        (s.kind = 'user' and s.target_id = t.id)))
  end
$$;

create or replace function app.place_in_scope(loc uuid, team uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select * from public.profiles where auth_user_id = auth.uid() and status = 'active')
  select case
    when not exists (select 1 from me) then false
    when (select app.rank(role) from me) >= 80 then true
    when (select role from me) <> 'area_manager' then false
    else exists (select 1 from public.area_manager_scope s, me where s.user_id = me.id and (
      (s.kind = 'location' and s.target_id = loc) or (team is not null and s.kind = 'team' and s.target_id = team)))
  end
$$;

create or replace function app.course_in_scope(course uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select * from public.profiles where auth_user_id = auth.uid() and status = 'active')
  select case
    when not exists (select 1 from me) then false
    when (select app.rank(role) from me) >= 80 then true
    when (select role from me) <> 'area_manager' then false
    when not exists (select 1 from public.area_manager_scope s, me where s.user_id = me.id and s.kind = 'course') then true
    else exists (select 1 from public.area_manager_scope s, me where s.user_id = me.id and s.kind = 'course' and s.target_id = course)
  end
$$;

create or replace function app.can_manage_target(target uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select me.role = 'admin' or app.rank(t.role) < app.rank(me.role)
    from public.profiles me, public.profiles t
    where me.auth_user_id = auth.uid() and me.status = 'active' and t.id = target), false)
$$;

create or replace function app.role_assignable(r public.app_role)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case me.role when 'admin' then true when 'area_manager' then r = 'staff' else app.rank(r) < app.rank(me.role) end
    from public.profiles me where me.auth_user_id = auth.uid() and me.status = 'active'), false)
$$;

-- People a manager may see at all (lists, dashboards, sign-offs, certificates).
create or replace function app.can_see_person(target uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select target = app.my_id()
      or ((app.has_perm('users.view') or app.has_perm('progress.view') or app.has_perm('reports.view')
           or app.has_perm('signoff.manage') or app.has_perm('certs.view')) and app.user_in_scope(target))
$$;

-- Training records (progress, attempts, sign-offs).
create or replace function app.can_see_progress(target uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select target = app.my_id()
      or ((app.has_perm('progress.view') or app.has_perm('reports.view') or app.has_perm('signoff.manage')) and app.user_in_scope(target))
$$;

create or replace function app.is_enrolled(course uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.enrollments e where e.user_id = app.my_id() and e.course_id = course and e.active)
$$;

create or replace function app.can_view_course(course uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_enrolled(course)
      or ((app.has_perm('content.edit') or app.has_perm('content.publish') or app.has_perm('files.manage')
           or app.has_perm('exams.manage') or app.has_perm('assign.manage') or app.has_perm('reports.view'))
          and app.course_in_scope(course))
$$;

create or replace function app.can_manage_course(course uuid, perm text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_perm(perm) and app.course_in_scope(course)
$$;

create or replace function app.exam_course(exam uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select course_id from public.exams where id = exam
$$;

create or replace function app.question_course(question uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select x.course_id from public.questions q join public.exams x on x.id = q.exam_id where q.id = question
$$;

create or replace function app.section_course(section uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select course_id from public.sections where id = section
$$;

-- =====================================================================
-- Audit trail
-- =====================================================================
create or replace function app.audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor public.profiles;
  row_key text;
begin
  select * into actor from public.profiles where auth_user_id = auth.uid();
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

do $$
declare t text;
begin
  foreach t in array array['app_settings', 'locations', 'teams', 'profiles', 'area_manager_permissions', 'area_manager_scope',
    'courses', 'course_versions', 'sections', 'section_files', 'exams', 'questions', 'choices', 'skills', 'faqs',
    'assignments', 'skill_signoffs', 'certificates', 'record_corrections', 'reminder_rules', 'issue_reports',
    'integrations', 'exports']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit()', t);
  end loop;
end $$;

create or replace function app.audit_immutable()
returns trigger language plpgsql as $$
begin
  if current_setting('app.retention_purge', true) = 'on' and tg_op = 'DELETE' then return old; end if;
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_immutable before update or delete on public.audit_log for each row execute function app.audit_immutable();

-- Keep updated_at / updated_by honest on direct edits.
create or replace function app.touch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(app.my_id(), new.updated_by);
  return new;
end $$;
create trigger touch_courses before update on public.courses for each row execute function app.touch();

-- =====================================================================
-- Row-level security
-- =====================================================================
alter table public.app_settings enable row level security;
alter table public.locations enable row level security;
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.area_manager_permissions enable row level security;
alter table public.area_manager_scope enable row level security;
alter table public.courses enable row level security;
alter table public.course_versions enable row level security;
alter table public.sections enable row level security;
alter table public.section_files enable row level security;
alter table public.exams enable row level security;
alter table public.questions enable row level security;
alter table public.choices enable row level security;
alter table public.skills enable row level security;
alter table public.faqs enable row level security;
alter table public.assignments enable row level security;
alter table public.enrollments enable row level security;
alter table public.section_progress enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.skill_signoffs enable row level security;
alter table public.certificates enable row level security;
alter table public.record_corrections enable row level security;
alter table public.notifications enable row level security;
alter table public.reminder_rules enable row level security;
alter table public.reminder_log enable row level security;
alter table public.issue_reports enable row level security;
alter table public.exports enable row level security;
alter table public.integrations enable row level security;
alter table public.audit_log enable row level security;

-- Reference data everyone signed in may read.
create policy settings_read on public.app_settings for select to authenticated using (true);
create policy locations_read on public.locations for select to authenticated using (true);
create policy locations_write on public.locations for all to authenticated using (app.has_perm('org.manage')) with check (app.has_perm('org.manage'));
create policy teams_read on public.teams for select to authenticated using (true);
create policy teams_write on public.teams for all to authenticated using (app.has_perm('org.manage')) with check (app.has_perm('org.manage'));
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy faqs_read on public.faqs for select to authenticated using (published or app.has_perm('faq.manage'));
create policy faqs_write on public.faqs for all to authenticated using (app.has_perm('faq.manage')) with check (app.has_perm('faq.manage'));

-- People: writes only through functions below.
create policy profiles_read on public.profiles for select to authenticated using (app.can_see_person(id));
create policy am_perms_read on public.area_manager_permissions for select to authenticated
  using (user_id = app.my_id() or app.has_perm('access.grant') or app.has_perm('users.role'));
create policy am_scope_read on public.area_manager_scope for select to authenticated
  using (user_id = app.my_id() or app.has_perm('access.grant') or app.has_perm('users.role'));

-- Content.
create policy courses_read on public.courses for select to authenticated using (app.can_view_course(id));
create policy courses_insert on public.courses for insert to authenticated
  with check (app.has_perm('content.edit') and status = 'draft' and version = 0
              and (app.is_global() or not exists (select 1 from public.area_manager_scope s where s.user_id = app.my_id() and s.kind = 'course')));
create policy courses_update on public.courses for update to authenticated
  using (app.can_manage_course(id, 'content.edit')) with check (app.can_manage_course(id, 'content.edit'));
create policy versions_read on public.course_versions for select to authenticated using (app.can_view_course(course_id));

create policy sections_read on public.sections for select to authenticated using (app.can_view_course(course_id));
create policy sections_write on public.sections for all to authenticated
  using (app.can_manage_course(course_id, 'content.edit')) with check (app.can_manage_course(course_id, 'content.edit'));
create policy files_read on public.section_files for select to authenticated using (app.can_view_course(app.section_course(section_id)));
create policy files_write on public.section_files for all to authenticated
  using (app.can_manage_course(app.section_course(section_id), 'files.manage'))
  with check (app.can_manage_course(app.section_course(section_id), 'files.manage'));
create policy exams_read on public.exams for select to authenticated using (app.can_view_course(course_id));
create policy exams_write on public.exams for all to authenticated
  using (app.can_manage_course(course_id, 'exams.manage')) with check (app.can_manage_course(course_id, 'exams.manage'));
create policy questions_manage on public.questions for all to authenticated
  using (app.can_manage_course(app.exam_course(exam_id), 'exams.manage'))
  with check (app.can_manage_course(app.exam_course(exam_id), 'exams.manage'));
create policy choices_manage on public.choices for all to authenticated
  using (app.can_manage_course(app.question_course(question_id), 'exams.manage'))
  with check (app.can_manage_course(app.question_course(question_id), 'exams.manage'));
create policy skills_read on public.skills for select to authenticated using (app.can_view_course(course_id));
create policy skills_write on public.skills for all to authenticated
  using (app.can_manage_course(course_id, 'content.edit')) with check (app.can_manage_course(course_id, 'content.edit'));

-- Records: read own, or in scope with the right permission. Writes through functions.
create policy assignments_read on public.assignments for select to authenticated
  using (app.has_perm('assign.manage') and (app.is_global() or assigned_by = app.my_id()));
create policy enrollments_read on public.enrollments for select to authenticated using (app.can_see_progress(user_id));
create policy progress_read on public.section_progress for select to authenticated using (app.can_see_progress(user_id));
create policy attempts_read on public.exam_attempts for select to authenticated using (app.can_see_progress(user_id));
create policy signoffs_read on public.skill_signoffs for select to authenticated using (app.can_see_progress(user_id));
create policy certificates_read on public.certificates for select to authenticated
  using (user_id = app.my_id() or (app.has_perm('certs.view') and app.user_in_scope(user_id)));
create policy corrections_read on public.record_corrections for select to authenticated using (app.can_see_progress(user_id));

create policy notifications_read on public.notifications for select to authenticated using (user_id = app.my_id());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = app.my_id()) with check (user_id = app.my_id());

create policy rules_read on public.reminder_rules for select to authenticated
  using (app.has_perm('reminders.manage') and (app.is_global() or created_by = app.my_id()));
create policy rules_insert on public.reminder_rules for insert to authenticated
  with check (app.has_perm('reminders.manage') and created_by = app.my_id());
create policy rules_update on public.reminder_rules for update to authenticated
  using (app.has_perm('reminders.manage') and (app.is_global() or created_by = app.my_id()))
  with check (app.has_perm('reminders.manage') and (app.is_global() or created_by = app.my_id()));

create policy issues_insert on public.issue_reports for insert to authenticated
  with check (user_id = app.my_id() and status = 'open' and (course_id is null or app.is_enrolled(course_id)));
create policy issues_read on public.issue_reports for select to authenticated
  using (user_id = app.my_id() or (app.has_perm('issues.manage') and (course_id is null or app.course_in_scope(course_id))));
create policy issues_resolve on public.issue_reports for update to authenticated
  using (app.has_perm('issues.manage') and (course_id is null or app.course_in_scope(course_id)))
  with check (app.has_perm('issues.manage'));

create policy exports_read on public.exports for select to authenticated
  using (requested_by = app.my_id()
         or (kind = 'report' and app.has_perm('reports.export') and app.is_global())
         or (kind = 'backup' and app.has_perm('data.backup')));
create policy integrations_read on public.integrations for select to authenticated using (app.has_perm('integrations.manage'));
create policy integrations_write on public.integrations for update to authenticated
  using (app.has_perm('integrations.manage')) with check (app.has_perm('integrations.manage'));
create policy audit_read on public.audit_log for select to authenticated using (app.has_perm('audit.view'));

-- =====================================================================
-- Table privileges for the API roles (RLS still applies on top).
-- =====================================================================
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant usage on schema app to anon, authenticated;

grant select on all tables in schema public to authenticated;
-- choices: only the choices_manage policy grants rows, so learners read nothing here.
grant select, insert, update, delete on public.choices, public.questions, public.exams, public.sections,
  public.section_files, public.skills, public.faqs, public.locations, public.teams to authenticated;
grant insert on public.courses to authenticated;
grant update (code, title_en, title_ar, description_en, description_ar, review_due, due_days) on public.courses to authenticated;
grant insert, update on public.reminder_rules to authenticated;
grant insert on public.issue_reports to authenticated;
grant update (status, resolved_by, resolution_note) on public.issue_reports to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (account_email, reports_folder_id, backups_folder_id, email_provider) on public.integrations to authenticated;
-- No direct writes at all: profiles, area_manager_*, assignments, enrollments, section_progress,
-- exam_attempts, skill_signoffs, certificates, record_corrections, exports, app_settings, audit_log.

grant execute on all functions in schema app to authenticated;
revoke execute on function app.audit(), app.audit_immutable(), app.touch() from authenticated, anon, public;
