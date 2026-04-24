-- 7-day free trial for freemium signups.
--
-- Design: separate from `tier`. A user stays in their base tier (free
-- by default) for billing / fallback purposes, and optionally has a
-- `trial_until` timestamp. If trial_until > now, the frontend treats
-- them as paid (via the capabilities system). When the trial expires,
-- they silently drop back to their base tier. Prevents any automatic
-- billing — card-on-file flow is NOT built here; post-trial users
-- simply see an "Add card to continue paid" prompt.
--
-- Why not just flip tier='paid' for 7 days and back? Because:
--   · Payment tier should only flip when payment clears. Keeping tier
--     honest avoids a DB state that implies "we charged them" when
--     we didn't.
--   · trial_until lets us display "trial ends in X days" countdowns.
--   · Admin can revoke by NULL-ing trial_until without touching tier.
--
-- Schema changes:
--   · user_profiles.trial_until timestamptz nullable
--   · user_profiles.trial_started_at timestamptz nullable
--   · user_profiles.first_3mo_promo_used bool default false
--     (tracks whether the 50%-off-first-3-months gift has been
--      claimed — once claimed, doesn't appear again. Actual billing
--      integration is a later task; this is just state.)

alter table public.user_profiles
  add column if not exists trial_until           timestamptz,
  add column if not exists trial_started_at      timestamptz,
  add column if not exists first_3mo_promo_used  boolean not null default false;

create index if not exists idx_user_profiles_trial_until
  on public.user_profiles(trial_until)
  where trial_until is not null;

comment on column public.user_profiles.trial_until is
  '7-day free trial expiry. When now() < trial_until the frontend promotes the user to paid capabilities. Null = no active trial. Set by post-signup modal or admin action; never auto-flips tier.';
comment on column public.user_profiles.trial_started_at is
  'Timestamp when the trial was granted. Used to compute "day X of 7" in the UI.';
comment on column public.user_profiles.first_3mo_promo_used is
  'True once the user has redeemed the 50%-off-first-3-months welcome gift. Prevents double-claim.';

-- Overenie:
--   select email, tier, trial_until, trial_started_at, first_3mo_promo_used
--   from public.user_profiles
--   where trial_until is not null;
