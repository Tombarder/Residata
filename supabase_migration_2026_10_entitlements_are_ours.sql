-- A user's ACCESS is ours to set, not theirs.
--
-- 🔴 FOUND 2026-10-06, while Boss was trying to move a new user from free to paid.
-- `profile_update_own` (auth.uid() = id) exists so a person can fix their own name
-- and company. RLS judges a ROW, not a column, and `authenticated` holds UPDATE on
-- every column of user_profiles — so the same policy let any signed-in free user
-- send one request from the browser console, with the public key and their own
-- session, and set:
--
--   tier = 'admin'                 → every admin-only policy in the database
--                                    (articles, onboarder, anomalies, premium
--                                    domains) trusts this column
--   tier = 'paid' / paid_until     → the paid dataset, free of charge
--   trial_until                    → an endless trial
--   paid_pause_started = null      → lift a pause an admin put on them
--   chosen_project_id              → the "one free project, locked" choice, changed
--                                    at will: every project's flats, one at a time
--
-- Proven that day in a rolled-back transaction (a free user's own session set
-- tier='admin' and paid_until ten years out, and the UPDATE went through).
--
-- supabase_migration_2026_09_billing_fields_are_ours.sql closed the same door for
-- the five billing columns only. This closes it for everything else, and the other
-- way round: instead of listing what a user may NOT touch — a list every new column
-- would silently fall outside of — it lists the few things a user MAY change on their
-- own row, and refuses the rest. A column added tomorrow is protected by default.
--
-- What a signed-in user may still do to their OWN row (all of it is what the app does):
--   · full_name, company, position, linkedin_url, phone      — Settings / CompleteProfile
--   · profile_completed: false → true (one way)              — CompleteProfile; the flip
--                                                              is what sends the welcome
--                                                              and admin e-mails
--   · chosen_project_id: empty → a project (once)            — ChooseProjectGate
--   · ui_prefs, pivot_prefs                                  — remembered settings
-- and the sign-up transition trg_auto_approve makes on that same update
-- (pending → free, approved_at), which this guard sees because it fires after it
-- (BEFORE triggers fire in name order: trg_auto_approve < user_profiles_guard_…).
--
-- Who is NOT judged here:
--   · the server — the Stripe webhook, /api/admin/*, /api/trial/*, the e-mail
--     webhooks — runs as service_role;
--   · migrations, the Management API and our own SECURITY DEFINER functions run as
--     the database owner;
--   · an admin's own session (current_user_is_admin()) — the admin panel.
-- That is decided by current_user, which is why this function is SECURITY INVOKER:
-- inside a SECURITY DEFINER function current_user would always be the owner and the
-- guard would wave everyone through.
--
-- Nightly proof: v2/scripts/integrity_check.py check_entitlements_are_server_owned
-- (novostavby repository) runs every self-promotion attempt as a signed-in user
-- against a temporary copy of this table carrying the live triggers, and fails if
-- one goes through — or if a legitimate self-service edit is refused.
--
-- Safe to re-run: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

create or replace function public.user_profiles_guard_entitlements()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  self_editable constant text[] := array[
    'full_name', 'company', 'position', 'linkedin_url', 'phone',
    'profile_completed', 'chosen_project_id', 'ui_prefs', 'pivot_prefs'
  ];
  exempt   text[] := self_editable;
  changed  text[];
begin
  -- Only a signed-in (or anonymous) session arriving through the API is judged.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.current_user_is_admin() then
    return new;
  end if;

  -- The sign-up step: trg_auto_approve has just turned a completed profile from
  -- pending to free. That is the database's doing, not the user's.
  if old.tier = 'pending' and new.tier = 'free'
     and old.approved_at is null and new.approved_at is not null
     and new.profile_completed is true and old.profile_completed is not true then
    exempt := exempt || array['tier', 'approved_at'];
  end if;

  select array_agg(n.key order by n.key) into changed
    from jsonb_each(to_jsonb(new)) n
   where n.value is distinct from (to_jsonb(old) -> n.key)
     and n.key <> all (exempt);

  if changed is not null then
    raise exception 'These fields are managed by Residata and cannot be changed from your account: %',
      array_to_string(changed, ', ')
      using errcode = '42501';
  end if;

  if old.profile_completed is true and new.profile_completed is not true then
    raise exception 'A completed profile cannot be marked incomplete again (managed by Residata).'
      using errcode = '42501';
  end if;

  if old.chosen_project_id is not null
     and new.chosen_project_id is distinct from old.chosen_project_id then
    raise exception 'Your free project is already chosen and is managed by Residata.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.user_profiles_guard_entitlements() is
  'A signed-in user may change only their profile fields on their own row (full_name, company, position, linkedin_url, phone, profile_completed false->true, chosen_project_id once, ui_prefs, pivot_prefs). Tier, paid/trial windows, Stripe ids, approval and everything else are written by the server (service_role), the database owner, or an admin. See supabase_migration_2026_10_entitlements_are_ours.sql.';

drop trigger if exists user_profiles_guard_entitlements on public.user_profiles;
create trigger user_profiles_guard_entitlements
  before update on public.user_profiles
  for each row execute function public.user_profiles_guard_entitlements();
