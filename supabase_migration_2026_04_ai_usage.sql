-- Migration: AI usage log + monthly report subscribers
-- Run this in Supabase SQL editor once: https://supabase.com/dashboard/project/mtclsrswxtjseewyrcbx/sql/new
--
-- Creates two tables the /api/ai/summary and /api/cron/monthly-reports
-- endpoints need. Both idempotent (IF NOT EXISTS) so re-running is safe.

-- ──────────────────────────────────────────────────────────
-- 1. ai_usage_log — every AI call gets logged here
--    Used for per-user rate limiting + cost tracking.
-- ──────────────────────────────────────────────────────────
create table if not exists public.ai_usage_log (
  id                bigserial primary key,
  user_id           uuid        references auth.users(id) on delete cascade,
  endpoint          text        not null,              -- e.g. 'summary'
  scope             text,                              -- 'market','district', …
  scope_label       text,
  input_tokens      integer,
  output_tokens     integer,
  ok                boolean     not null default true,
  error             text,
  requested_at      timestamptz not null default now()
);

-- Queries mostly look like "how many calls did THIS user make in the last X minutes"
-- → composite index on (user_id, requested_at desc).
create index if not exists ai_usage_log_user_time_idx
  on public.ai_usage_log (user_id, requested_at desc);

-- RLS — a user can only see their own usage history. Server code using
-- the service role key bypasses RLS, so the endpoint can still write as
-- anyone and read across the whole table for rate-limit checks.
alter table public.ai_usage_log enable row level security;

drop policy if exists "ai_usage_log_self_read" on public.ai_usage_log;
create policy "ai_usage_log_self_read"
  on public.ai_usage_log for select
  using (auth.uid() = user_id);


-- ──────────────────────────────────────────────────────────
-- 2. report_subscriptions — who wants the monthly email
--    Seeded empty; users opt-in via the Reports page (or admin).
-- ──────────────────────────────────────────────────────────
create table if not exists public.report_subscriptions (
  user_id           uuid        primary key references auth.users(id) on delete cascade,
  email             text        not null,            -- denormalised for speed
  scope             text        not null default 'market',  -- market | city | district | developer | project
  scope_label       text,                                   -- e.g. 'Petržalka'
  lang              text        not null default 'sk',
  enabled           boolean     not null default true,
  last_sent_at      timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists report_subs_enabled_idx
  on public.report_subscriptions (enabled) where enabled;

alter table public.report_subscriptions enable row level security;

drop policy if exists "report_subs_self_all" on public.report_subscriptions;
create policy "report_subs_self_all"
  on public.report_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
