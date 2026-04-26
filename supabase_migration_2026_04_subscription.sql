-- Subscription window tracking — paid tier with explicit expiry +
-- pause support. Mirrors the trial_until / trial_started_at pair
-- added in supabase_migration_2026_04_trial.sql.
--
-- Why: tier='paid' alone has no time component, so the UI couldn't
-- show "your subscription expires in 12 days" or "you're paused
-- since 14 May" — both are essential for trust + admin oversight.
--
-- Schema changes:
--   · paid_started_at    timestamptz nullable  — when paid period began
--   · paid_until         timestamptz nullable  — when paid period ends
--                                                 (frontend treats user as
--                                                 effectively-free once
--                                                 now() > paid_until)
--   · paid_pause_started timestamptz nullable  — pause window start;
--                                                 while non-null, paid
--                                                 access is suspended
--                                                 regardless of paid_until
--   · subscription_note  text nullable         — admin's free-text note
--                                                 (e.g. "manual invoice
--                                                  sent 12 May")

alter table public.user_profiles
  add column if not exists paid_started_at      timestamptz,
  add column if not exists paid_until           timestamptz,
  add column if not exists paid_pause_started   timestamptz,
  add column if not exists subscription_note    text;

create index if not exists idx_user_profiles_paid_until
  on public.user_profiles(paid_until)
  where paid_until is not null;

comment on column public.user_profiles.paid_started_at is
  'Timestamp when the current paid subscription began. Used to show "subscriber since" in Billing UI.';
comment on column public.user_profiles.paid_until is
  'When paid period expires. tier stays "paid" in this column — but the frontend capability layer demotes to free once now() > paid_until. Renewal: admin extends paid_until forward.';
comment on column public.user_profiles.paid_pause_started is
  'Set when admin pauses the subscription. While non-null, paid access is suspended even if paid_until is in the future. Unpausing: NULL this column AND adjust paid_until to compensate for paused days.';
comment on column public.user_profiles.subscription_note is
  'Admin free-text note. Not user-visible; surfaces only in Admin > user row.';

-- Convenience: a SQL view for admin dashboards aggregating effective
-- access state per user (no app-layer logic needed for ad-hoc queries).
create or replace view public.user_subscription_status as
select
  id, email, tier,
  trial_until, trial_started_at,
  paid_until, paid_started_at, paid_pause_started, subscription_note,
  case
    when tier = 'admin' then 'admin'
    when paid_pause_started is not null then 'paused'
    when paid_until is not null and paid_until > now() then 'paid'
    when trial_until is not null and trial_until > now() then 'trial'
    else 'free'
  end as effective_status,
  case
    when paid_pause_started is not null then 0
    when paid_until is not null and paid_until > now() then
      ceil(extract(epoch from (paid_until - now())) / 86400)::int
    when trial_until is not null and trial_until > now() then
      ceil(extract(epoch from (trial_until - now())) / 86400)::int
    else null
  end as days_remaining
from public.user_profiles;

grant select on public.user_subscription_status to authenticated;

-- Overenie:
--   select email, effective_status, days_remaining, tier
--   from public.user_subscription_status
--   order by days_remaining nulls last;
