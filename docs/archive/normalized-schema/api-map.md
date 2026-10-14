# Prototype calls → production database

Stage 2 swaps the prototype's in-browser backend (`Core.createBackend` in `web/src/core.js`) for a Supabase adapter with the same function names, so the screens do not change. Reads go through tables and views (row-level security applies); writes go through the checked functions.

| Prototype call | Production |
| --- | --- |
| `login` | Edge Function `password-login`, then `supabase.auth.setSession()` |
| `changeOwnPassword` | Edge Function `change-password` |
| `setPassword` (and the password on `createUser` / `commitImport`) | Edge Function `set-password` after the profile exists |
| `me` | `rpc('my_profile_id')`, `rpc('my_permissions')`, `from('profiles')` |
| `learnerHome`, `learnerCourse` | `from('v_enrollments')`, `from('sections')`, `from('section_files')`, `from('exams')`, `from('section_progress')`, `from('v_exam_best')`, `from('certificates')`, `from('notifications')` |
| `markFileViewed`, `completeSection` | `rpc('mark_file_viewed')`, `rpc('complete_section')` |
| `startAttempt`, `submitAttempt` | `rpc('start_attempt')`, `rpc('submit_attempt')` |
| `verifyCertificate` | `rpc('verify_certificate')` (works signed out) |
| `listUsers`, `getUser` | `from('profiles')`, plus records tables for the person page |
| `createUser`, `updateUser`, `setUserStatus`, `removeUser` | `rpc('create_user')`, `rpc('update_user')`, `rpc('set_user_status')`, `rpc('remove_user')`; a new person then gets their password through `set-password` |
| `previewImport`, `commitImport` | parse and validate in the browser, then `rpc('create_user')` and `set-password` (temporary) per ready row (each row re-checked) |
| `setGrant` | `rpc('set_area_manager_access')` |
| `createCourse`, `updateCourse`, `saveSection`, `moveSection`, `removeSection` | direct table writes, limited by row-level security and column grants |
| `publishCourse`, `setCourseStatus`, `deleteCourse` | `rpc('publish_course')`, `rpc('set_course_status')`, `rpc('delete_course')` |
| `addFiles`, `moveFile`, `replaceFile`, `removeFile` | Google Picker with a token from Edge Function `drive-token`, then `from('section_files')` writes |
| `saveExam` | `from('exams' / 'questions' / 'choices')` writes |
| `assign` | `rpc('assign_course')` |
| `setSignoff` | `rpc('set_signoff')` |
| `revokeCert`, `reissueCert` | `rpc('revoke_certificate')`, `rpc('reissue_certificate')` |
| `correctRecord` | `rpc('correct_attempt_score')`; section corrections to be added in stage 2 |
| `kpis` | computed in the browser from `v_enrollments`, `v_exam_best`, `skill_signoffs` (already scoped by row-level security) |
| `exportToDrive`, `retryExport`, `runBackup` | `rpc('request_drive_export')` / `rpc('retry_drive_export')`, then Edge Function `drive-export` |
| `runReminders` | `run_reminders()` on a daily schedule (`supabase/cron.sql`) |
| `updateSettings` | `rpc('update_settings')` |
| `listAudit` | `from('audit_log')` |
