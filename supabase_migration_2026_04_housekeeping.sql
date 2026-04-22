-- Housekeeping for the AI / reports layer:
--   1. Auto-bump `app_secrets.updated_at` on any UPDATE (trigger).
--   2. Retention: a scheduled function that prunes `ai_usage_log` rows
--      older than 90 days. Called from the monthly cron on its way out,
--      or on demand via pg_cron / manually.
--
-- Idempotent: re-running is safe.

-- ── 1. app_secrets updated_at auto-bump ───────────────────────────
create or replace function public._bump_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_secrets_bump_updated_at on public.app_secrets;
create trigger app_secrets_bump_updated_at
  before update on public.app_secrets
  for each row execute function public._bump_updated_at();

-- ── 2. ai_usage_log retention ─────────────────────────────────────
-- Keeps only rows from the last 90 days. Rate-limit queries only ever
-- look at the last 24h, and cost tracking beyond 90d is served better
-- by a billing export. Capped at 100k deletes per call so the LOCK
-- window stays small.
create or replace function public.prune_ai_usage_log(retention_days int default 90)
returns integer language plpgsql as $$
declare
  n int;
begin
  delete from ai_usage_log
   where id in (
     select id from ai_usage_log
      where requested_at < now() - (retention_days * interval '1 day')
      limit 100000
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Grant execute to service_role (it already has it implicitly, but
-- being explicit helps future maintainers). No grant to anon/auth.
grant execute on function public.prune_ai_usage_log(int) to service_role;
