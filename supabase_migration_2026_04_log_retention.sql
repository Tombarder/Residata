-- AI usage log + admin audit log retention.
--
-- Why: both tables grow monotonically with usage. After 90 days, individual
-- rows have low investigative value and start eating DB storage quota.
-- For GDPR, keeping PII-adjacent data longer than necessary is also a
-- liability. 90 days is a fair balance — enough to investigate an
-- incident spotted after a couple of months, not so long that a leak
-- exposes years of history.
--
-- Apply via Supabase SQL editor.

BEGIN;

-- pg_cron is available on Supabase by default. If this errors with
-- "extension pg_cron does not exist", enable it in:
--   Supabase Dashboard → Database → Extensions → pg_cron → Enable
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule 1: prune ai_usage_log rows older than 90 days
-- Runs daily at 03:00 UTC (before the monthly scraper at 04:00 UTC)
SELECT cron.schedule(
  'prune-ai-usage-log',
  '0 3 * * *',
  $$DELETE FROM ai_usage_log WHERE requested_at < NOW() - INTERVAL '90 days'$$
);

-- Schedule 2: prune admin_audit_log rows older than 365 days.
-- Kept longer than ai_usage_log because admin actions are rarer and
-- forensics may reach further back. Still bounded so the table
-- doesn't grow forever.
SELECT cron.schedule(
  'prune-admin-audit-log',
  '15 3 * * *',
  $$DELETE FROM admin_audit_log WHERE created_at < NOW() - INTERVAL '365 days'$$
);

COMMIT;

-- To inspect scheduled jobs:
--   SELECT * FROM cron.job;
-- To unschedule:
--   SELECT cron.unschedule('prune-ai-usage-log');
