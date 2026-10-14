-- Sample data for development and staging only. Never load into production.
-- Fixed ids so tests can refer to them.
--   people   : 000…0aXX   auth users: aaaa…00XX   locations: 1000…0X   teams: 2000…0X

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@btw.example'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'it@btw.example'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'ops@btw.example'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'nora@btw.example'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'faisal@btw.example'),
  ('aaaaaaaa-0000-0000-0000-000000000011', 'sara@btw.example'),
  ('aaaaaaaa-0000-0000-0000-000000000012', 'yousef@btw.example'),
  ('aaaaaaaa-0000-0000-0000-000000000013', 'abdulaziz@btw.example'),
  ('aaaaaaaa-0000-0000-0000-000000000014', 'mona@btw.example');

insert into public.locations (id, name_en, name_ar, city_en, city_ar) values
  ('10000000-0000-0000-0000-000000000001', 'Olaya', 'العليا', 'Riyadh', 'الرياض'),
  ('10000000-0000-0000-0000-000000000002', 'Al Malqa', 'الملقا', 'Riyadh', 'الرياض'),
  ('10000000-0000-0000-0000-000000000003', 'Khobar Corniche', 'كورنيش الخبر', 'Al Khobar', 'الخبر'),
  ('10000000-0000-0000-0000-000000000004', 'Tahlia', 'التحلية', 'Jeddah', 'جدة');

insert into public.teams (id, location_id, name_en, name_ar) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Olaya bar', 'بار العليا'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Malqa bar', 'بار الملقا'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'Khobar bar', 'بار الخبر'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000004', 'Tahlia bar', 'بار التحلية');

insert into public.profiles (id, auth_user_id, employee_code, full_name_en, full_name_ar, email, role, location_id, team_id, job_title) values
  ('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'HQ-001', 'Huda Al-Qahtani', 'هدى القحطاني', 'admin@btw.example', 'admin', '10000000-0000-0000-0000-000000000001', null, 'Head of People'),
  ('00000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000002', 'HQ-014', 'Omar Haddad', 'عمر حداد', 'it@btw.example', 'it_manager', '10000000-0000-0000-0000-000000000001', null, 'IT Manager'),
  ('00000000-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000003', 'HQ-020', 'Rakan Al-Shammari', 'راكان الشمري', 'ops@btw.example', 'ops_manager', '10000000-0000-0000-0000-000000000001', null, 'Operations Manager'),
  ('00000000-0000-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-000000000004', 'RY-101', 'Nora Al-Otaibi', 'نورة العتيبي', 'nora@btw.example', 'area_manager', '10000000-0000-0000-0000-000000000001', null, 'Area Manager, Riyadh'),
  ('00000000-0000-0000-0000-0000000000a5', 'aaaaaaaa-0000-0000-0000-000000000005', 'WE-201', 'Faisal Al-Ghamdi', 'فيصل الغامدي', 'faisal@btw.example', 'area_manager', '10000000-0000-0000-0000-000000000004', null, 'Area Manager, West'),
  ('00000000-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000011', 'RY-1103', 'Sara Al-Harbi', 'سارة الحربي', 'sara@btw.example', 'staff', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Barista'),
  ('00000000-0000-0000-0000-0000000000b2', 'aaaaaaaa-0000-0000-0000-000000000012', 'RY-1210', 'Yousef Bakr', 'يوسف بكر', 'yousef@btw.example', 'staff', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'Barista'),
  ('00000000-0000-0000-0000-0000000000b3', 'aaaaaaaa-0000-0000-0000-000000000013', 'EP-3101', 'Abdulaziz Al-Anazi', 'عبدالعزيز العنزي', 'abdulaziz@btw.example', 'staff', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', 'Barista'),
  ('00000000-0000-0000-0000-0000000000b4', 'aaaaaaaa-0000-0000-0000-000000000014', 'WP-4101', 'Mona Fadel', 'منى فاضل', 'mona@btw.example', 'staff', '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000005', 'Barista');

-- Nora: Riyadh branches; may view and add staff, assign, view progress and reports, sign off skills, view certificates.
insert into public.area_manager_permissions (user_id, permission) select '00000000-0000-0000-0000-0000000000a4', unnest(array[
  'users.view', 'users.edit', 'users.deactivate', 'users.import', 'assign.manage', 'progress.view', 'signoff.manage', 'reports.view', 'reports.export', 'certs.view', 'reminders.manage']);
insert into public.area_manager_scope (user_id, kind, target_id) values
  ('00000000-0000-0000-0000-0000000000a4', 'location', '10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a4', 'location', '10000000-0000-0000-0000-000000000002');
-- Faisal: Jeddah plus the Khobar team; view only plus sign-offs.
insert into public.area_manager_permissions (user_id, permission) select '00000000-0000-0000-0000-0000000000a5', unnest(array['users.view', 'progress.view', 'signoff.manage', 'certs.view']);
insert into public.area_manager_scope (user_id, kind, target_id) values
  ('00000000-0000-0000-0000-0000000000a5', 'location', '10000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-0000000000a5', 'team', '20000000-0000-0000-0000-000000000004');

-- One published course: 2 sections (first has a quiz), a final assessment and a practical skill.
insert into public.courses (id, code, title_en, title_ar, status, version, due_days, review_due) values
  ('30000000-0000-0000-0000-000000000001', 'BAR-101', 'Barista Foundations', 'أساسيات الباريستا', 'published', 1, 14, current_date + 90);
insert into public.course_versions (course_id, version, note) values ('30000000-0000-0000-0000-000000000001', 1, 'First release');
insert into public.sections (id, course_id, position, title_en, title_ar) values
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1, 'Espresso to recipe', 'الإسبريسو حسب الوصفة'),
  ('31000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 2, 'Bar hygiene', 'نظافة البار');
insert into public.section_files (section_id, position, drive_file_id, title, mime_type) values
  ('31000000-0000-0000-0000-000000000001', 1, '1AbCdEfGhIjKlMnOp', 'Espresso recipe card', 'application/pdf');
insert into public.exams (id, course_id, section_id, kind, title_en, title_ar, pass_pct, time_limit_min, max_attempts, allow_retake, review) values
  ('32000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'section', 'Espresso quiz', 'اختبار الإسبريسو', 80, 10, 3, true, 'after_submit'),
  ('32000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', null, 'final', 'Final assessment', 'التقييم النهائي', 80, 15, 3, true, 'after_pass');
insert into public.questions (id, exam_id, position, type, prompt_en, prompt_ar) values
  ('33000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001', 1, 'mc', 'Double shot recipe?', 'وصفة الشوت المزدوج؟'),
  ('33000000-0000-0000-0000-000000000002', '32000000-0000-0000-0000-000000000001', 2, 'tf', 'Purge the group head before every shot.', 'نظّف رأس المجموعة قبل كل شوت.'),
  ('33000000-0000-0000-0000-000000000003', '32000000-0000-0000-0000-000000000002', 1, 'mc', 'Milk fridge temperature?', 'حرارة ثلاجة الحليب؟'),
  ('33000000-0000-0000-0000-000000000004', '32000000-0000-0000-0000-000000000002', 2, 'tf', 'Leftover milk can be re-steamed.', 'يمكن إعادة تبخير الحليب المتبقي.');
insert into public.choices (id, question_id, position, text_en, text_ar, is_correct) values
  ('34000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001', 1, '18 g in, 36 g out, 25–30 s', '١٨ غ، ٣٦ غ، ٢٥–٣٠ ث', true),
  ('34000000-0000-0000-0000-000000000002', '33000000-0000-0000-0000-000000000001', 2, '18 g in, 18 g out, 15 s', '١٨ غ، ١٨ غ، ١٥ ث', false),
  ('34000000-0000-0000-0000-000000000003', '33000000-0000-0000-0000-000000000002', 1, 'True', 'صح', true),
  ('34000000-0000-0000-0000-000000000004', '33000000-0000-0000-0000-000000000002', 2, 'False', 'خطأ', false),
  ('34000000-0000-0000-0000-000000000005', '33000000-0000-0000-0000-000000000003', 1, '5 °C or below', '٥ °م أو أقل', true),
  ('34000000-0000-0000-0000-000000000006', '33000000-0000-0000-0000-000000000003', 2, '12 °C', '١٢ °م', false),
  ('34000000-0000-0000-0000-000000000007', '33000000-0000-0000-0000-000000000004', 1, 'True', 'صح', false),
  ('34000000-0000-0000-0000-000000000008', '33000000-0000-0000-0000-000000000004', 2, 'False', 'خطأ', true);
insert into public.skills (id, course_id, title_en, title_ar, requires_signoff) values
  ('35000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Pull a double shot to recipe', 'استخلاص شوت مزدوج حسب الوصفة', true);

insert into public.enrollments (user_id, course_id, course_version, due_on) values
  ('00000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-000000000001', 1, current_date + 10),
  ('00000000-0000-0000-0000-0000000000b2', '30000000-0000-0000-0000-000000000001', 1, current_date - 5),
  ('00000000-0000-0000-0000-0000000000b3', '30000000-0000-0000-0000-000000000001', 1, current_date + 3);

insert into public.reminder_rules (trigger, days, repeat_every_days, max_sends, template_en, template_ar, created_by) values
  ('overdue', 1, 7, 3, '{course} is overdue since {due}.', 'دورة {course} متأخرة منذ {due}.', '00000000-0000-0000-0000-0000000000a3'),
  ('due_soon', 3, 0, 1, '{course} is due on {due}.', 'موعد {course} هو {due}.', '00000000-0000-0000-0000-0000000000a3');

insert into public.integrations (provider, connected, account_email, scope, reports_folder_id, backups_folder_id)
values ('google_drive', false, null, 'https://www.googleapis.com/auth/drive.file', null, null), ('email', false, null, null, null, null);
