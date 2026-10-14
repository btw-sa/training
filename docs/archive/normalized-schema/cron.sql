-- Scheduled jobs. Run once per environment in the Supabase SQL editor
-- (after enabling the pg_cron and pg_net extensions under Database → Extensions).
-- Times are UTC; Riyadh is UTC+3.

-- Daily reminders at 06:00 Riyadh.
select cron.schedule('training-reminders', '0 3 * * *', $$ select public.run_reminders(); $$);

-- Monthly retention pass: anonymises people deactivated longer than the retention period.
select cron.schedule('training-retention', '30 3 1 * *', $$ select public.apply_retention(); $$);

-- Weekly logical backup to the Drive backups folder, Fridays 02:00 Riyadh.
-- Queues an export row, then calls the drive-export function with the service key kept in Vault.
-- Create both secrets first (SQL editor):
--   select vault.create_secret('<service-role-key>', 'service_role_key');
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select cron.schedule('training-weekly-backup', '0 23 * * 4', $$
  with x as (
    insert into public.exports (kind, format, destination, status) values ('backup', 'json', 'drive', 'queued') returning id
  )
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/drive-export',
    headers := jsonb_build_object('content-type', 'application/json',
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := jsonb_build_object('export_id', (select id from x)))
$$);
