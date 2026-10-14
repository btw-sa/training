// POST { export_id } — performs a queued Drive export created by request_drive_export().
// The report rows are read AS THE CALLER, so an Area Manager's export can only ever
// contain their own locations. A failure is recorded on the export row and changes
// nothing else; the database stays the primary record. Retry with retry_drive_export().
import { callerClient, cors, json, serviceClient } from '../_shared/http.ts';
import { driveAccessToken, uploadToDrive } from '../_shared/google.ts';

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;          // block spreadsheet formula injection
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
};
const toCsv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return '﻿';
  const cols = Object.keys(rows[0]);
  return '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const { export_id } = await req.json().catch(() => ({}));
  const caller = callerClient(req);
  const admin = serviceClient();

  // The caller must be able to see this export row (RLS) — i.e. they requested it.
  const { data: x } = await caller.from('exports').select('*').eq('id', export_id).single();
  if (!x || x.status !== 'queued') return json({ error: 'not_found' }, 404);
  await admin.from('exports').update({ status: 'running', attempts: x.attempts + 1, started_at: new Date().toISOString() }).eq('id', x.id);

  try {
    const { data: integ } = await admin.from('integrations').select('reports_folder_id, backups_folder_id, connected').eq('provider', 'google_drive').single();
    if (!integ?.connected) throw new Error('drive_not_connected');
    const folder = x.kind === 'backup' ? integ.backups_folder_id : integ.reports_folder_id;
    if (!folder) throw new Error('drive_folder_missing');

    let name: string, mime: string, content: string, rows = 0;
    const day = new Date().toISOString().slice(0, 10);
    if (x.kind === 'backup') {
      // Full logical copy for disaster recovery. Never includes tokens (they live in Vault).
      const tables = ['locations', 'teams', 'profiles', 'courses', 'course_versions', 'sections', 'section_files', 'exams', 'questions', 'choices',
        'skills', 'assignments', 'enrollments', 'section_progress', 'exam_attempts', 'skill_signoffs', 'certificates', 'record_corrections',
        'reminder_rules', 'issue_reports', 'faqs', 'app_settings', 'area_manager_permissions', 'area_manager_scope'];
      const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
      for (const t of tables) { const { data, error } = await admin.from(t).select('*'); if (error) throw error; out[t] = data; rows += data.length; }
      name = `backup-${day}.json`; mime = 'application/json'; content = JSON.stringify(out);
    } else {
      let q = caller.from('v_enrollments').select('full_name_en, full_name_ar, location_id, course_title_en, course_version, assigned_at, due_on, completed_at, status');
      const f = x.filters ?? {};
      if (f.locationId) q = q.eq('location_id', f.locationId);
      if (f.courseId) q = q.eq('course_id', f.courseId);
      const { data, error } = await q;
      if (error) throw error;
      rows = data.length;
      name = `training-${x.report ?? 'report'}-${day}.csv`; mime = 'text/csv'; content = toCsv(data);
    }
    const file = await uploadToDrive(await driveAccessToken(), folder, name, mime, content);
    await admin.from('exports').update({ status: 'succeeded', error: null, row_count: rows, drive_folder_id: folder, drive_file_id: file.id, drive_file_name: file.name, finished_at: new Date().toISOString() }).eq('id', x.id);
    return json({ ok: true, file: file.name, rows });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'export_failed';
    await admin.from('exports').update({ status: 'failed', error: code, finished_at: new Date().toISOString() }).eq('id', x.id);
    return json({ error: code }, 503);
  }
});
