-- Stripe billing linkage on user_profiles.
--
-- Billing reuses the existing entitlement columns (paid_until / paid_started_at /
-- paid_pause_started from supabase_migration_2026_04_subscription.sql). We only
-- need to remember WHICH Stripe customer + subscription a user maps to, so the
-- webhook can (a) find the user from an incoming event and (b) avoid creating
-- duplicate customers.
--
-- Both columns are nullable + additive → zero impact on existing rows/RLS.

alter table public.user_profiles
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text;

-- Webhook looks users up by customer id → index it (partial: most rows are null).
create index if not exists idx_user_profiles_stripe_customer
  on public.user_profiles(stripe_customer_id)
  where stripe_customer_id is not null;

comment on column public.user_profiles.stripe_customer_id is
  'Stripe Customer id (cus_…). Set on first checkout; used by the webhook to resolve the user from Stripe events and to open the billing portal.';
comment on column public.user_profiles.stripe_subscription_id is
  'Stripe Subscription id (sub_…) of the current/last subscription. Informational + de-dup; paid state itself lives in paid_until.';
