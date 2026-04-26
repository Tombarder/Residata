-- Bring RLS in line with the capability layer.
--
-- Before: current_user_is_paid() returned true ONLY for tier in
-- ('paid','admin'). The UI's useCapabilities hook promotes a user
-- to paid-equivalent access whenever trial_until > now() OR
-- (paid_until > now() AND paid_pause_started IS NULL), so the
-- platform happily rendered Analytics + flat tables for those
-- users — but the flats RLS policy still denied them rows because
-- it only saw the raw tier column.
--
-- Symptom: a free user mid-trial sees an empty Pivot, empty flat
-- tables, no per-unit data anywhere — even though the badge says
-- PAID and the Gated wrapper is open. Looks like "data is gone /
-- waiting for next batch" to the user, not a permission gate.
--
-- Fix: extend the RLS helper so trial-active and paid-window-
-- active users actually receive their rows. Same predicates the
-- frontend capability layer uses — single source of truth.

create or replace function public.current_user_is_paid() returns boolean
language sql stable security definer as $$
  select coalesce((
    select
      tier in ('paid','admin')
      or (paid_until is not null and paid_until > now() and paid_pause_started is null)
      or (trial_until is not null and trial_until > now())
    from public.user_profiles where id = auth.uid()
  ), false);
$$;
