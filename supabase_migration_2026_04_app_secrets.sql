-- App-level secrets store.
--
-- Purpose: hold runtime API keys (ANTHROPIC_API_KEY, CRON_SECRET) in the
-- DB so they don't have to round-trip through Vercel's env UI. Only the
-- server-side code (api/*.js using SUPABASE_SECRET_KEY) can read it.
--
-- This is a convenience — env vars on Vercel remain the "official" path
-- and win if both are set. The DB row is a fallback.

create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now(),
  notes      text
);

-- Lock it down hard. Service role bypasses RLS so server code reads fine.
alter table public.app_secrets enable row level security;

-- No policies → no client (even paid/admin) can read app_secrets.
-- This is deliberate: only the serverless functions, which authenticate
-- with the service-role key, can SELECT/INSERT/UPDATE this table.

-- Optional admin policy (commented out; uncomment if you want to manage
-- secrets from the Supabase dashboard UI as the owner):
-- create policy "app_secrets_admin" on public.app_secrets
--   for all using (auth.uid() in (select id from user_profiles where tier='admin'));
