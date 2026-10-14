-- =====================================================================
-- Server functions (called from the app as POST /rest/v1/rpc/<name>).
-- Each one re-checks the caller's role, Admin-granted permissions, scope
-- and rank before writing. Errors are raised with the code as the message
-- (forbidden_role, forbidden_scope, forbidden_rank, not_found, invalid,
-- conflict, has_history, last_admin, locked, attempts_used, unauthenticated)
-- and a readable hint.
-- =====================================================================

create or replace function app.require_me()
returns public.profiles language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.profiles;
begin
  select * into me from public.profiles where auth_user_id = auth.uid() and status = 'active';
  if me.id is null then perform app.fail('unauthenticated', 'Sign in again.'); end if;
  return me;
end $$;

create or replace function app.need(perm text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_perm(perm) then perform app.fail('forbidden_role', 'Your role does not include ' || perm || '.'); end if;
end $$;

create or replace function app.notify(p_user uuid, p_kind text, t_en text, t_ar text, b_en text, b_ar text, p_link text, p_key text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, kind, title_en, title_ar, body_en, body_ar, link, dedupe_key)
  values (p_user, p_kind, t_en, t_ar, b_en, b_ar, p_link, p_key)
  on conflict (dedupe_key) do nothing
$$;

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------
create or replace function app.check_place(p_loc uuid, p_team uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_loc is null or not exists (select 1 from public.locations where id = p_loc) then perform app.fail('invalid', 'Choose a location.'); end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team and location_id = p_loc) then
    perform app.fail('invalid', 'The team must belong to the location.');
  end if;
  if not app.place_in_scope(p_loc, p_team) then perform app.fail('forbidden_scope', 'That location or team is outside your access.'); end if;
end $$;

create or replace function public.create_user(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.profiles := app.require_me();
  v_role public.app_role := coalesce(nullif(p ->> 'role', '')::public.app_role, 'staff');
  v_loc uuid := nullif(p ->> 'location_id', '')::uuid;
  v_team uuid := nullif(p ->> 'team_id', '')::uuid;
  v_id uuid;
begin
  perform app.need('users.edit');
  if not app.role_assignable(v_role) then perform app.fail('forbidden_rank', 'You cannot create someone with this role.'); end if;
  if v_role <> 'staff' then perform app.need('users.role'); end if;
  perform app.check_place(v_loc, v_team);
  insert into public.profiles (employee_code, full_name_en, full_name_ar, email, phone, role, location_id, team_id, job_title, hire_date, language, created_by, updated_by)
  values (nullif(trim(p ->> 'employee_code'), ''), trim(p ->> 'full_name_en'), nullif(trim(p ->> 'full_name_ar'), ''),
          nullif(lower(trim(p ->> 'email')), ''), nullif(trim(p ->> 'phone'), ''), v_role, v_loc, v_team,
          nullif(trim(p ->> 'job_title'), ''), nullif(p ->> 'hire_date', '')::date, coalesce(nullif(p ->> 'language', ''), 'ar'), me.id, me.id)
  returning id into v_id;
  -- Courses assigned to everyone with this role reach the new starter straight away.
  insert into public.enrollments (user_id, course_id, course_version, assignment_id, due_on)
  select v_id, a.course_id, c.version, a.id, current_date + c.due_days
  from public.assignments a join public.courses c on c.id = a.course_id and c.status = 'published'
  where a.target_kind = 'role' and a.target_role = v_role
    and (a.scope is null or a.scope -> 'locations' ? v_loc::text or (v_team is not null and a.scope -> 'teams' ? v_team::text))
  on conflict do nothing;
  return v_id;
exception when unique_violation then
  perform app.fail('invalid', 'That email or employee code is already used.');
  return null;
end $$;

create or replace function public.update_user(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.profiles := app.require_me();
  t public.profiles;
  v_role public.app_role;
  v_loc uuid; v_team uuid;
begin
  perform app.need('users.edit');
  select * into t from public.profiles where id = p_id;
  if t.id is null or not app.user_in_scope(p_id) then perform app.fail('not_found', 'Person not found in your scope.'); end if;
  if t.id <> me.id and not app.can_manage_target(p_id) then perform app.fail('forbidden_rank', 'You cannot edit someone at or above your own role.'); end if;
  v_role := coalesce(nullif(p ->> 'role', '')::public.app_role, t.role);
  if v_role <> t.role then
    perform app.need('users.role');
    if t.id = me.id then perform app.fail('forbidden_rank', 'You cannot change your own role.'); end if;
    if not app.role_assignable(v_role) then perform app.fail('forbidden_rank', 'You cannot give this role.'); end if;
    if t.role = 'admin' and (select count(*) from public.profiles where role = 'admin' and status = 'active') <= 1 then
      perform app.fail('last_admin', 'Keep at least one active Admin.');
    end if;
  end if;
  v_loc := coalesce(nullif(p ->> 'location_id', '')::uuid, t.location_id);
  v_team := case when p ? 'team_id' then nullif(p ->> 'team_id', '')::uuid else t.team_id end;
  if v_loc is distinct from t.location_id or v_team is distinct from t.team_id then perform app.check_place(v_loc, v_team); end if;
  update public.profiles set
    employee_code = case when p ? 'employee_code' then nullif(trim(p ->> 'employee_code'), '') else employee_code end,
    full_name_en = coalesce(nullif(trim(p ->> 'full_name_en'), ''), full_name_en),
    full_name_ar = case when p ? 'full_name_ar' then nullif(trim(p ->> 'full_name_ar'), '') else full_name_ar end,
    email = case when p ? 'email' then nullif(lower(trim(p ->> 'email')), '') else email end,
    phone = case when p ? 'phone' then nullif(trim(p ->> 'phone'), '') else phone end,
    job_title = case when p ? 'job_title' then nullif(trim(p ->> 'job_title'), '') else job_title end,
    hire_date = case when p ? 'hire_date' then nullif(p ->> 'hire_date', '')::date else hire_date end,
    language = coalesce(nullif(p ->> 'language', ''), language),
    role = v_role, location_id = v_loc, team_id = v_team, updated_by = me.id, updated_at = now()
  where id = p_id;
  if v_role <> 'area_manager' then
    delete from public.area_manager_permissions where user_id = p_id;
    delete from public.area_manager_scope where user_id = p_id;
  end if;
exception when unique_violation then
  perform app.fail('invalid', 'That email or employee code is already used.');
end $$;

create or replace function public.set_user_status(p_id uuid, p_status public.user_status)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); t public.profiles;
begin
  perform app.need('users.deactivate');
  select * into t from public.profiles where id = p_id;
  if t.id is null or not app.user_in_scope(p_id) then perform app.fail('not_found'); end if;
  if t.id = me.id then perform app.fail('forbidden_rank', 'You cannot deactivate your own account.'); end if;
  if not app.can_manage_target(p_id) then perform app.fail('forbidden_rank', 'You cannot change someone at or above your own role.'); end if;
  if t.role = 'admin' and p_status = 'inactive' and (select count(*) from public.profiles where role = 'admin' and status = 'active') <= 1 then
    perform app.fail('last_admin', 'Keep at least one active Admin.');
  end if;
  update public.profiles set status = p_status, deactivated_at = case when p_status = 'inactive' then now() end,
    updated_by = me.id, updated_at = now() where id = p_id;
end $$;

create or replace function public.remove_user(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); t public.profiles;
begin
  perform app.need('users.remove');
  select * into t from public.profiles where id = p_id;
  if t.id is null or not app.user_in_scope(p_id) then perform app.fail('not_found'); end if;
  if t.id = me.id or not app.can_manage_target(p_id) then perform app.fail('forbidden_rank'); end if;
  if exists (select 1 from public.section_progress where user_id = p_id)
     or exists (select 1 from public.exam_attempts where user_id = p_id)
     or exists (select 1 from public.certificates where user_id = p_id)
     or exists (select 1 from public.skill_signoffs where user_id = p_id) then
    perform app.fail('has_history', 'This person has training history. Deactivate instead so reports stay complete.');
  end if;
  delete from public.profiles where id = p_id;
end $$;

-- Admin only: what an Area Manager may do, and where.
create or replace function public.set_area_manager_access(p_user uuid, p_perms text[], p_locations uuid[], p_teams uuid[], p_users uuid[], p_courses uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); bad text[];
begin
  perform app.need('access.grant');
  if not exists (select 1 from public.profiles where id = p_user and role = 'area_manager') then
    perform app.fail('invalid', 'Only Area Managers receive granted access.');
  end if;
  select array_agg(x) into bad from unnest(coalesce(p_perms, '{}')) x
    where not exists (select 1 from public.permissions k where k.key = x and k.grantable);
  if bad is not null then perform app.fail('invalid', 'Not grantable to Area Managers: ' || array_to_string(bad, ', ')); end if;
  delete from public.area_manager_permissions where user_id = p_user;
  delete from public.area_manager_scope where user_id = p_user;
  insert into public.area_manager_permissions (user_id, permission, granted_by) select p_user, x, me.id from unnest(coalesce(p_perms, '{}')) x;
  insert into public.area_manager_scope (user_id, kind, target_id, granted_by)
    select p_user, 'location', x, me.id from unnest(coalesce(p_locations, '{}')) x where exists (select 1 from public.locations where id = x)
    union all select p_user, 'team', x, me.id from unnest(coalesce(p_teams, '{}')) x where exists (select 1 from public.teams where id = x)
    union all select p_user, 'user', x, me.id from unnest(coalesce(p_users, '{}')) x where exists (select 1 from public.profiles where id = x)
    union all select p_user, 'course', x, me.id from unnest(coalesce(p_courses, '{}')) x where exists (select 1 from public.courses where id = x);
end $$;

-- ---------------------------------------------------------------------
-- Completion and certificates
-- ---------------------------------------------------------------------
create or replace function app.new_cert_no()
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare al text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; s text; no text; prefix text;
begin
  select cert_prefix into prefix from public.app_settings where id = 1;
  loop
    s := '';
    for i in 1..8 loop s := s || substr(al, 1 + floor(random() * length(al))::int, 1); end loop;
    no := prefix || '-' || extract(year from now())::int || '-' || substr(s, 1, 4) || '-' || substr(s, 5, 4);
    exit when not exists (select 1 from public.certificates where cert_no = no);
  end loop;
  return no;
end $$;

-- Issues the certificate in the same transaction once every requirement is met.
create or replace function app.try_complete(p_enrollment uuid, p_by uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.enrollments; u public.profiles; c public.courses; s public.app_settings; v_cert uuid;
begin
  select * into e from public.enrollments where id = p_enrollment for update;
  if e.id is null or e.completed_at is not null or not e.active then return null; end if;
  if exists (select 1 from public.sections sec where sec.course_id = e.course_id and sec.required
             and not exists (select 1 from public.section_progress sp where sp.user_id = e.user_id and sp.section_id = sec.id
                             and sp.course_version = e.course_version and sp.completed_at is not null)) then return null; end if;
  if exists (select 1 from public.exams x where x.course_id = e.course_id and x.kind = 'final'
             and not exists (select 1 from public.exam_attempts a where a.exam_id = x.id and a.user_id = e.user_id
                             and a.course_version = e.course_version and a.passed)) then return null; end if;
  if exists (select 1 from public.skills k where k.course_id = e.course_id and k.requires_signoff
             and coalesce((select so.status from public.skill_signoffs so where so.skill_id = k.id and so.user_id = e.user_id
                           order by so.assessed_at desc limit 1), 'not_assessed') <> 'passed') then return null; end if;
  update public.enrollments set completed_at = now() where id = e.id;
  select * into u from public.profiles where id = e.user_id;
  select * into c from public.courses where id = e.course_id;
  select * into s from public.app_settings where id = 1;
  insert into public.certificates (cert_no, user_id, course_id, course_version, holder_name_en, holder_name_ar, business_name_en, business_name_ar,
                                   course_title_en, course_title_ar, completed_on, issued_by)
  values (app.new_cert_no(), u.id, c.id, e.course_version, u.full_name_en, u.full_name_ar, s.business_name_en, s.business_name_ar,
          c.title_en, c.title_ar, current_date, p_by)
  returning id into v_cert;
  perform app.notify(u.id, 'certificate', 'Certificate ready', 'شهادتك جاهزة', 'You completed ' || c.title_en || '.', 'أكملت دورة ' || c.title_ar || '.', 'cert:' || v_cert, 'cert:' || v_cert);
  return v_cert;
end $$;

create or replace function app.active_enrollment(p_user uuid, p_course uuid)
returns public.enrollments language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.enrollments where user_id = p_user and course_id = p_course and active limit 1
$$;

create or replace function public.mark_file_viewed(p_file uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); f public.section_files; v_course uuid; e public.enrollments;
begin
  select * into f from public.section_files where id = p_file;
  v_course := app.section_course(f.section_id);
  e := app.active_enrollment(me.id, v_course);
  if f.id is null or e.id is null then perform app.fail('not_found'); end if;
  insert into public.section_progress (user_id, section_id, course_version, viewed_file_ids)
  values (me.id, f.section_id, e.course_version, array[f.id])
  on conflict (user_id, section_id, course_version) do update
    set viewed_file_ids = case when f.id = any (section_progress.viewed_file_ids) then section_progress.viewed_file_ids else section_progress.viewed_file_ids || f.id end;
  update public.enrollments set started_at = coalesce(started_at, now()) where id = e.id;
end $$;

create or replace function public.complete_section(p_section uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); e public.enrollments;
begin
  e := app.active_enrollment(me.id, app.section_course(p_section));
  if e.id is null then perform app.fail('not_found'); end if;
  if exists (select 1 from public.exams where section_id = p_section) then
    perform app.fail('invalid', 'Pass the section quiz to complete this section.');
  end if;
  insert into public.section_progress (user_id, section_id, course_version, completed_at)
  values (me.id, p_section, e.course_version, now())
  on conflict (user_id, section_id, course_version) do update set completed_at = coalesce(section_progress.completed_at, now());
  update public.enrollments set started_at = coalesce(started_at, now()) where id = e.id;
  return app.try_complete(e.id);
end $$;

-- Returns the questions for an attempt. Choice text only — never which one is correct.
create or replace function public.start_attempt(p_exam uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.profiles := app.require_me();
  x public.exams; e public.enrollments; t public.exam_attempts;
  v_used int; v_passed boolean;
begin
  select * into x from public.exams where id = p_exam;
  if x.id is null then perform app.fail('not_found'); end if;
  e := app.active_enrollment(me.id, x.course_id);
  if e.id is null then perform app.fail('not_found', 'This exam is not assigned to you.'); end if;
  if x.kind = 'final' and exists (
    select 1 from public.sections s where s.course_id = x.course_id and s.required and not exists (
      select 1 from public.section_progress sp where sp.user_id = me.id and sp.section_id = s.id and sp.course_version = e.course_version and sp.completed_at is not null)) then
    perform app.fail('locked', 'Finish every required section first.');
  end if;
  select * into t from public.exam_attempts a where a.exam_id = x.id and a.user_id = me.id and a.course_version = e.course_version
    and a.submitted_at is null and (a.expires_at is null or a.expires_at > now()) order by attempt_no desc limit 1;
  if t.id is null then
    select count(*), coalesce(bool_or(a.passed), false) into v_used, v_passed from public.exam_attempts a
      where a.exam_id = x.id and a.user_id = me.id and a.course_version = e.course_version and a.submitted_at is not null;
    if v_passed then perform app.fail('invalid', 'You already passed this exam.'); end if;
    if x.max_attempts > 0 and v_used >= x.max_attempts then perform app.fail('attempts_used', 'No attempts left. Ask your manager.'); end if;
    if v_used > 0 and not x.allow_retake then perform app.fail('attempts_used', 'Retakes are not allowed for this exam.'); end if;
    insert into public.exam_attempts (exam_id, user_id, course_version, attempt_no, question_order, expires_at)
    values (x.id, me.id, e.course_version,
            (select coalesce(max(attempt_no), 0) + 1 from public.exam_attempts where exam_id = x.id and user_id = me.id and course_version = e.course_version),
            (select array_agg(q.id order by case when x.shuffle then random() else q.position end) from public.questions q where q.exam_id = x.id),
            case when x.time_limit_min > 0 then now() + make_interval(mins => x.time_limit_min) end)
    returning * into t;
    update public.enrollments set started_at = coalesce(started_at, now()) where id = e.id;
  end if;
  return jsonb_build_object(
    'attempt_id', t.id, 'attempt_no', t.attempt_no, 'expires_at', t.expires_at,
    'exam', jsonb_build_object('id', x.id, 'kind', x.kind, 'title_en', x.title_en, 'title_ar', x.title_ar, 'pass_pct', x.pass_pct),
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'type', q.type, 'prompt_en', q.prompt_en, 'prompt_ar', q.prompt_ar,
                   'choices', (select jsonb_agg(jsonb_build_object('id', c.id, 'text_en', c.text_en, 'text_ar', c.text_ar) order by c.position)
                               from public.choices c where c.question_id = q.id)) order by o.ord)
                  from unnest(t.question_order) with ordinality o(qid, ord) join public.questions q on q.id = o.qid));
end $$;

create or replace function public.submit_attempt(p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.profiles := app.require_me();
  t public.exam_attempts; x public.exams; e public.enrollments;
  total int; right_n int; v_score int; v_late boolean; v_cert uuid; v_review jsonb;
begin
  select * into t from public.exam_attempts where id = p_attempt and user_id = me.id for update;
  if t.id is null then perform app.fail('not_found'); end if;
  if t.submitted_at is not null then perform app.fail('conflict', 'This attempt was already submitted.'); end if;
  select * into x from public.exams where id = t.exam_id;
  v_late := t.expires_at is not null and now() > t.expires_at + interval '30 seconds';
  select count(*) into total from public.questions where exam_id = x.id;
  select count(*) into right_n from public.questions q join public.choices c on c.question_id = q.id and c.is_correct
    where q.exam_id = x.id and (p_answers ->> q.id::text) = c.id::text;
  v_score := case when v_late or total = 0 then 0 else round(100.0 * right_n / total) end;
  update public.exam_attempts set submitted_at = now(), late = v_late, score_pct = v_score, passed = v_score >= x.pass_pct,
    answers = case when v_late then '{}'::jsonb else coalesce(p_answers, '{}'::jsonb) end
  where id = t.id;
  if v_score >= x.pass_pct and x.kind = 'section' then
    insert into public.section_progress (user_id, section_id, course_version, completed_at)
    values (me.id, x.section_id, t.course_version, now())
    on conflict (user_id, section_id, course_version) do update set completed_at = coalesce(section_progress.completed_at, now());
  end if;
  e := app.active_enrollment(me.id, x.course_id);
  if v_score >= x.pass_pct and e.id is not null then v_cert := app.try_complete(e.id); end if;
  if x.review = 'after_submit' or (x.review = 'after_pass' and v_score >= x.pass_pct) then
    select jsonb_agg(jsonb_build_object('id', q.id, 'chosen', p_answers ->> q.id::text,
           'correct', (select c.id from public.choices c where c.question_id = q.id and c.is_correct limit 1)) order by q.position)
      into v_review from public.questions q where q.exam_id = x.id;
  end if;
  return jsonb_build_object('score_pct', v_score, 'passed', v_score >= x.pass_pct, 'late', v_late, 'pass_pct', x.pass_pct,
                            'review', v_review, 'certificate_id', v_cert);
end $$;

-- ---------------------------------------------------------------------
-- Assignments, sign-offs, corrections, certificates
-- ---------------------------------------------------------------------
create or replace function public.assign_course(p_course uuid, p_kind text, p_target uuid, p_role public.app_role, p_due date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.profiles := app.require_me();
  c public.courses; v_due date; v_asg uuid; created int := 0; skipped int := 0; r record; v_scope jsonb;
begin
  perform app.need('assign.manage');
  select * into c from public.courses where id = p_course;
  if c.id is null then perform app.fail('not_found'); end if;
  if not app.course_in_scope(c.id) then perform app.fail('forbidden_scope', 'This course is outside your access.'); end if;
  if c.status <> 'published' then perform app.fail('invalid', 'Only published courses can be assigned.'); end if;
  if p_kind not in ('user', 'team', 'location', 'role') then perform app.fail('invalid'); end if;
  if not app.is_global() then
    if p_kind = 'location' and not app.place_in_scope(p_target, null) then perform app.fail('forbidden_scope'); end if;
    if p_kind = 'team' and not app.place_in_scope((select location_id from public.teams where id = p_target), p_target) then perform app.fail('forbidden_scope'); end if;
    if p_kind = 'user' and not app.user_in_scope(p_target) then perform app.fail('forbidden_scope'); end if;
    select jsonb_build_object('locations', coalesce(jsonb_agg(target_id) filter (where kind = 'location'), '[]'),
                              'teams', coalesce(jsonb_agg(target_id) filter (where kind = 'team'), '[]'))
      into v_scope from public.area_manager_scope where user_id = me.id;
  end if;
  v_due := coalesce(p_due, current_date + c.due_days);
  if v_due < current_date then perform app.fail('invalid', 'The due date is in the past.'); end if;
  insert into public.assignments (course_id, target_kind, target_id, target_role, due_on, assigned_by, scope)
  values (c.id, p_kind, case when p_kind = 'role' then null else p_target end, case when p_kind = 'role' then p_role end, v_due, me.id, v_scope)
  returning id into v_asg;
  for r in
    select p.id from public.profiles p
    where p.status = 'active' and app.user_in_scope(p.id) and (p.id <> me.id or p_kind = 'user')
      and ((p_kind = 'user' and p.id = p_target) or (p_kind = 'team' and p.team_id = p_target)
           or (p_kind = 'location' and p.location_id = p_target) or (p_kind = 'role' and p.role = p_role))
  loop
    if exists (select 1 from public.enrollments where user_id = r.id and course_id = c.id and active and course_version = c.version) then
      skipped := skipped + 1;
    else
      update public.enrollments set active = false, superseded_at = now() where user_id = r.id and course_id = c.id and active;
      insert into public.enrollments (user_id, course_id, course_version, assignment_id, due_on) values (r.id, c.id, c.version, v_asg, v_due);
      perform app.notify(r.id, 'assigned', 'New training assigned', 'تم إسناد تدريب جديد', c.title_en || ', due ' || v_due, c.title_ar || '، الموعد ' || v_due,
                         'course:' || c.id, 'assigned:' || v_asg || ':' || r.id);
      created := created + 1;
    end if;
  end loop;
  return jsonb_build_object('assignment_id', v_asg, 'created', created, 'skipped', skipped);
end $$;

create or replace function public.set_signoff(p_skill uuid, p_user uuid, p_status public.signoff_status, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); k public.skills; e public.enrollments; v_cert uuid;
begin
  perform app.need('signoff.manage');
  if not app.user_in_scope(p_user) then perform app.fail('not_found', 'Person not found in your scope.'); end if;
  if p_user = me.id then perform app.fail('forbidden_scope', 'You cannot sign off your own skills.'); end if;
  select * into k from public.skills where id = p_skill;
  if k.id is null then perform app.fail('not_found'); end if;
  e := app.active_enrollment(p_user, k.course_id);
  if e.id is null then perform app.fail('invalid', 'This person is not enrolled in the course.'); end if;
  insert into public.skill_signoffs (skill_id, user_id, status, notes, assessed_by) values (p_skill, p_user, p_status, left(p_notes, 500), me.id);
  if p_status = 'passed' then v_cert := app.try_complete(e.id, me.id); end if;
  return jsonb_build_object('certificate_id', v_cert);
end $$;

create or replace function public.correct_attempt_score(p_attempt uuid, p_score int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); t public.exam_attempts; x public.exams; e public.enrollments; v_cert uuid;
begin
  perform app.need('records.correct');
  if length(trim(coalesce(p_reason, ''))) < 5 then perform app.fail('invalid', 'A reason is required for every correction.'); end if;
  if p_score not between 0 and 100 then perform app.fail('invalid', 'Score must be 0 to 100.'); end if;
  select * into t from public.exam_attempts where id = p_attempt;
  if t.id is null or not app.user_in_scope(t.user_id) then perform app.fail('not_found'); end if;
  select * into x from public.exams where id = t.exam_id;
  perform set_config('app.reason', p_reason, true);
  update public.exam_attempts set score_pct = p_score, passed = p_score >= x.pass_pct, corrected = true where id = t.id;
  insert into public.record_corrections (user_id, entity, entity_id, field, old_value, new_value, reason, corrected_by)
  values (t.user_id, 'exam_attempt', t.id, 'score_pct', t.score_pct::text, p_score::text, p_reason, me.id);
  if p_score >= x.pass_pct and x.kind = 'section' then
    insert into public.section_progress (user_id, section_id, course_version, completed_at, corrected)
    values (t.user_id, x.section_id, t.course_version, now(), true)
    on conflict (user_id, section_id, course_version) do update set completed_at = coalesce(section_progress.completed_at, now()), corrected = true;
  end if;
  e := app.active_enrollment(t.user_id, x.course_id);
  if p_score >= x.pass_pct and e.id is not null then v_cert := app.try_complete(e.id, me.id); end if;
  return jsonb_build_object('certificate_id', v_cert);
end $$;

create or replace function public.revoke_certificate(p_cert uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); c public.certificates;
begin
  perform app.need('certs.revoke');
  select * into c from public.certificates where id = p_cert;
  if c.id is null or not app.user_in_scope(c.user_id) then perform app.fail('not_found'); end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then perform app.fail('invalid', 'A reason is required.'); end if;
  if c.status <> 'valid' then perform app.fail('conflict', 'Only valid certificates can be revoked.'); end if;
  perform set_config('app.reason', p_reason, true);
  update public.certificates set status = 'revoked', revoked_at = now(), revoked_by = me.id, revoke_reason = p_reason where id = c.id;
end $$;

create or replace function public.reissue_certificate(p_cert uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); c public.certificates; u public.profiles; s public.app_settings; v_new uuid;
begin
  perform app.need('certs.reissue');
  select * into c from public.certificates where id = p_cert;
  if c.id is null or not app.user_in_scope(c.user_id) then perform app.fail('not_found'); end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then perform app.fail('invalid', 'A reason is required.'); end if;
  if c.status = 'replaced' then perform app.fail('conflict', 'This certificate was already replaced.'); end if;
  select * into u from public.profiles where id = c.user_id;
  select * into s from public.app_settings where id = 1;
  perform set_config('app.reason', p_reason, true);
  update public.certificates set status = 'replaced' where id = c.id;
  insert into public.certificates (cert_no, user_id, course_id, course_version, holder_name_en, holder_name_ar, business_name_en, business_name_ar,
                                   course_title_en, course_title_ar, completed_on, issued_by, replaces)
  values (app.new_cert_no(), c.user_id, c.course_id, c.course_version, u.full_name_en, u.full_name_ar, s.business_name_en, s.business_name_ar,
          c.course_title_en, c.course_title_ar, c.completed_on, me.id, c.id)
  returning id into v_new;
  return v_new;
end $$;

-- Public certificate check: status, course and the holder's initials only.
create or replace function public.verify_certificate(p_no text)
returns table (status public.cert_status, course_title_en text, course_title_ar text, course_version int, completed_on date,
               holder_initials_en text, holder_initials_ar text, business_name_en text, business_name_ar text, revoked_on date)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.status, c.course_title_en, c.course_title_ar, c.course_version, c.completed_on,
         (select string_agg(left(w, 1) || '.', ' ') from regexp_split_to_table(c.holder_name_en, '\s+') w where w <> ''),
         (select string_agg(left(w, 1) || '.', ' ') from regexp_split_to_table(coalesce(c.holder_name_ar, ''), '\s+') w where w <> ''),
         c.business_name_en, c.business_name_ar, c.revoked_at::date
  from public.certificates c where c.cert_no = upper(trim(p_no))
$$;

-- ---------------------------------------------------------------------
-- Publishing and versions
-- ---------------------------------------------------------------------
create or replace function public.publish_course(p_course uuid, p_note text, p_retrain boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); c public.courses; v_first boolean; v_retrained int := 0; r record; v_new uuid;
begin
  perform app.need('content.publish');
  select * into c from public.courses where id = p_course for update;
  if c.id is null then perform app.fail('not_found'); end if;
  if not app.course_in_scope(c.id) then perform app.fail('forbidden_scope'); end if;
  if not exists (select 1 from public.sections where course_id = c.id) then perform app.fail('invalid', 'Add at least one section before publishing.'); end if;
  if not exists (select 1 from public.exams x join public.questions q on q.exam_id = x.id where x.course_id = c.id and x.kind = 'final') then
    perform app.fail('invalid', 'Add a final assessment before publishing.');
  end if;
  v_first := c.version = 0;
  update public.courses set version = version + 1, status = 'published', updated_by = me.id where id = c.id returning * into c;
  insert into public.course_versions (course_id, version, note, retrain_required, published_by)
  values (c.id, c.version, coalesce(nullif(trim(p_note), ''), case when v_first then 'First release' end), not v_first and coalesce(p_retrain, false), me.id);
  if not v_first and coalesce(p_retrain, false) then
    for r in select * from public.enrollments where course_id = c.id and active and course_version < c.version loop
      update public.enrollments set active = false, superseded_at = now() where id = r.id;
      insert into public.enrollments (user_id, course_id, course_version, assignment_id, due_on)
      values (r.user_id, c.id, c.version, r.assignment_id, current_date + c.due_days) returning id into v_new;
      perform app.notify(r.user_id, 'retrain', 'Updated training to repeat', 'تدريب محدّث يجب إعادته',
        c.title_en || ' changed (version ' || c.version || '). Please complete it again.',
        'تم تحديث ' || c.title_ar || ' (النسخة ' || c.version || '). يرجى إكمالها مجددًا.', 'course:' || c.id, 'retrain:' || v_new);
      v_retrained := v_retrained + 1;
    end loop;
  end if;
  return jsonb_build_object('version', c.version, 'retrained', v_retrained);
end $$;

create or replace function public.set_course_status(p_course uuid, p_status public.course_status)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.courses;
begin
  perform app.require_me();
  perform app.need('content.publish');
  select * into c from public.courses where id = p_course;
  if c.id is null then perform app.fail('not_found'); end if;
  if not app.course_in_scope(c.id) then perform app.fail('forbidden_scope'); end if;
  if p_status = 'draft' or (p_status = 'published' and c.version = 0) then perform app.fail('invalid'); end if;
  update public.courses set status = p_status where id = c.id;
end $$;

create or replace function public.delete_course(p_course uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_me();
  perform app.need('content.delete');
  if not app.course_in_scope(p_course) then perform app.fail('forbidden_scope'); end if;
  if exists (select 1 from public.enrollments where course_id = p_course and (started_at is not null or completed_at is not null))
     or exists (select 1 from public.certificates where course_id = p_course) then
    perform app.fail('has_history', 'People have started this course. Archive it instead.');
  end if;
  delete from public.courses where id = p_course;
end $$;

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
create or replace function public.update_settings(p_group text, p jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.profiles := app.require_me(); allowed text[]; k text;
begin
  case p_group
    when 'training' then perform app.need('settings.training'); allowed := array['certificate_line_en', 'certificate_line_ar', 'sequential_sections', 'default_due_days'];
    when 'kpi' then perform app.need('settings.kpi'); allowed := array['kpi'];
    when 'system' then perform app.need('settings.system'); allowed := array['business_name_en', 'business_name_ar', 'cert_prefix', 'default_language', 'retention', 'privacy_en', 'privacy_ar', 'verify_base_url'];
    else perform app.fail('invalid');
  end case;
  for k in select jsonb_object_keys(p) loop
    if not k = any (allowed) then perform app.fail('forbidden_role', k || ' is not part of ' || p_group || ' settings.'); end if;
  end loop;
  if p ? 'kpi' and ((p -> 'kpi' ->> 'minSignals')::int < 2 or (p -> 'kpi' ->> 'minSignals')::int > 5) then
    perform app.fail('invalid', 'Support flags need at least 2 signals.');
  end if;
  update public.app_settings set
    certificate_line_en = coalesce(p ->> 'certificate_line_en', certificate_line_en),
    certificate_line_ar = coalesce(p ->> 'certificate_line_ar', certificate_line_ar),
    sequential_sections = coalesce((p ->> 'sequential_sections')::boolean, sequential_sections),
    default_due_days = coalesce((p ->> 'default_due_days')::int, default_due_days),
    kpi = coalesce(p -> 'kpi', kpi),
    business_name_en = coalesce(p ->> 'business_name_en', business_name_en),
    business_name_ar = coalesce(p ->> 'business_name_ar', business_name_ar),
    cert_prefix = coalesce(upper(p ->> 'cert_prefix'), cert_prefix),
    default_language = coalesce(p ->> 'default_language', default_language),
    retention = coalesce(p -> 'retention', retention),
    privacy_en = coalesce(p ->> 'privacy_en', privacy_en),
    privacy_ar = coalesce(p ->> 'privacy_ar', privacy_ar),
    verify_base_url = coalesce(p ->> 'verify_base_url', verify_base_url),
    updated_by = me.id, updated_at = now()
  where id = 1;
end $$;

-- ---------------------------------------------------------------------
-- Reminders (run daily by pg_cron as the service role; never by the browser)
-- ---------------------------------------------------------------------
create or replace function public.run_reminders()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; e record; n int; last_at timestamptz; due boolean; created int := 0; held int := 0; v_key text; v_inserted int;
begin
  for r in select * from public.reminder_rules where active loop
    for e in
      select en.*, p.full_name_en, p.full_name_ar, p.location_id, p.team_id, c.title_en, c.title_ar
      from public.enrollments en join public.profiles p on p.id = en.user_id and p.status = 'active'
      join public.courses c on c.id = en.course_id
      where en.active and en.completed_at is null
        and (r.scope is null or r.scope -> 'locations' ? p.location_id::text or (p.team_id is not null and r.scope -> 'teams' ? p.team_id::text))
    loop
      due := case r.trigger
        when 'assigned' then now() >= e.assigned_at + make_interval(days => r.days)
        when 'due_soon' then e.due_on is not null and current_date between e.due_on - r.days and e.due_on
        when 'overdue' then e.due_on is not null and current_date > e.due_on + r.days end;
      continue when not due;
      select count(*), max(sent_at) into n, last_at from public.reminder_log where rule_id = r.id and enrollment_id = e.id;
      continue when n >= r.max_sends;
      continue when n > 0 and (r.repeat_every_days = 0 or now() - last_at < make_interval(days => r.repeat_every_days));
      if exists (select 1 from public.notifications where user_id = e.user_id and kind = 'reminder' and created_at::date = current_date) then
        held := held + 1; continue;
      end if;
      v_key := 'rem:' || r.id || ':' || e.id || ':' || (n + 1);
      insert into public.notifications (user_id, kind, title_en, title_ar, body_en, body_ar, link, dedupe_key)
      values (e.user_id, 'reminder', 'Training reminder', 'تذكير بالتدريب',
              replace(replace(replace(r.template_en, '{name}', split_part(e.full_name_en, ' ', 1)), '{course}', e.title_en), '{due}', coalesce(e.due_on::text, '')),
              replace(replace(replace(r.template_ar, '{name}', split_part(coalesce(e.full_name_ar, e.full_name_en), ' ', 1)), '{course}', e.title_ar), '{due}', coalesce(e.due_on::text, '')),
              'course:' || e.course_id, v_key)
      on conflict (dedupe_key) do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted = 1 then
        insert into public.reminder_log (rule_id, enrollment_id, send_no, channels) values (r.id, e.id, n + 1, r.channels);
        created := created + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('created', created, 'held_back', held);
end $$;

-- Data retention: anonymise people deactivated longer than the retention period
-- (training statistics stay; names and contact details go). Run monthly by pg_cron.
create or replace function public.apply_retention()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare yrs int; n int;
begin
  select (retention ->> 'inactiveUserYears')::int into yrs from public.app_settings where id = 1;
  update public.profiles set full_name_en = 'Former team member', full_name_ar = 'موظف سابق', email = null, phone = null,
         employee_code = 'ANON-' || left(id::text, 8), auth_user_id = null, job_title = null
  where status = 'inactive' and deactivated_at < now() - make_interval(years => yrs) and full_name_en <> 'Former team member';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Reporting views (security_invoker: the caller's row-level security applies)
-- ---------------------------------------------------------------------
create or replace view public.v_enrollments with (security_invoker = true) as
select e.id, e.user_id, p.full_name_en, p.full_name_ar, p.location_id, p.team_id, e.course_id, c.title_en as course_title_en,
       c.title_ar as course_title_ar, e.course_version, e.assigned_at, e.due_on, e.started_at, e.completed_at,
       case when e.completed_at is not null then 'completed'
            when e.due_on is not null and current_date > e.due_on then 'overdue'
            when e.started_at is not null then 'in_progress'
            else 'not_started' end as status
from public.enrollments e join public.profiles p on p.id = e.user_id join public.courses c on c.id = e.course_id
where e.active and p.status = 'active';

create or replace view public.v_exam_best with (security_invoker = true) as
select a.user_id, a.exam_id, x.course_id, x.kind, max(a.score_pct) as best_score, bool_or(a.passed) as passed,
       count(*) as attempts, bool_or(a.passed) filter (where a.attempt_no = 1) as first_attempt_passed, min(a.submitted_at) as first_at
from public.exam_attempts a join public.exams x on x.id = a.exam_id
where a.submitted_at is not null
group by a.user_id, a.exam_id, x.course_id, x.kind;

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.create_user(jsonb), public.update_user(uuid, jsonb), public.set_user_status(uuid, public.user_status),
  public.remove_user(uuid), public.set_area_manager_access(uuid, text[], uuid[], uuid[], uuid[], uuid[]),
  public.mark_file_viewed(uuid), public.complete_section(uuid), public.start_attempt(uuid), public.submit_attempt(uuid, jsonb),
  public.assign_course(uuid, text, uuid, public.app_role, date), public.set_signoff(uuid, uuid, public.signoff_status, text),
  public.correct_attempt_score(uuid, int, text), public.revoke_certificate(uuid, text), public.reissue_certificate(uuid, text),
  public.publish_course(uuid, text, boolean), public.set_course_status(uuid, public.course_status), public.delete_course(uuid),
  public.update_settings(text, jsonb)
  to authenticated;
grant execute on function public.verify_certificate(text) to anon, authenticated;
grant execute on function public.run_reminders(), public.apply_retention() to service_role;
grant select on public.v_enrollments, public.v_exam_best to authenticated;
grant execute on all functions in schema app to authenticated;
revoke execute on function app.try_complete(uuid, uuid), app.new_cert_no(), app.active_enrollment(uuid, uuid), app.notify(uuid, text, text, text, text, text, text, text),
  app.audit(), app.audit_immutable(), app.touch() from authenticated, anon, public;
