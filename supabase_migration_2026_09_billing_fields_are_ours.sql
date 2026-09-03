-- The billing identity on a user's profile is OUR record, not theirs to edit.
--
-- user_profiles has `profile_update_own` (auth.uid() = id), which is right for a
-- profile: people should be able to fix their own name and company. But RLS is
-- per ROW, not per column, so that same policy lets a signed-in user write any
-- value they like into the columns added this morning —
-- billing_company_name / billing_company_id / billing_vat_id / billing_address /
-- billing_country.
--
-- Those five are not profile preferences. They are what the buyer entered at
-- Stripe Checkout, and they are what an invoice and the monthly EU sales list
-- are built from. A VAT number typed straight into our database, bypassing
-- Stripe's collection, is a number we would report to the tax office having
-- verified nothing. The fix is not to remove the profile policy — it is to say
-- that these particular columns are written by the payment webhook and by
-- nobody else.
--
-- The webhook and the admin endpoints use the service role, which bypasses RLS
-- and is exempted here explicitly. A user updating their profile is unaffected
-- as long as they leave these five columns alone; an attempt to change one is
-- rejected with a message that says why, rather than silently ignored.

create or replace function public.user_profiles_guard_billing_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The payment webhook and admin tooling run as the service role. Anything
  -- else is the user's own session.
  -- nullif() before the cast: current_setting(..., true) returns NULL when the
  -- setting is absent, but an EMPTY STRING when PostgREST set it to nothing —
  -- and ''::jsonb raises. A guard that throws on its own plumbing would block
  -- every profile update in the product, so it is written to fail open on any
  -- doubt about the caller and closed only on a real edit attempt.
  begin
    if coalesce(
         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
         ''
       ) = 'service_role' then
      return new;
    end if;
  exception when others then
    null;   -- unreadable claims → fall through to the column comparison below
  end;

  begin
    if auth.role() = 'service_role' then
      return new;
    end if;
  exception when others then
    null;   -- auth schema not reachable (direct psql, migrations) → same
  end;

  if new.billing_company_name is distinct from old.billing_company_name
     or new.billing_company_id  is distinct from old.billing_company_id
     or new.billing_vat_id      is distinct from old.billing_vat_id
     or new.billing_address     is distinct from old.billing_address
     or new.billing_country     is distinct from old.billing_country then
    raise exception
      'Billing details come from the payment checkout and cannot be edited here. Change them under "Manage billing".'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists user_profiles_guard_billing_fields on public.user_profiles;
create trigger user_profiles_guard_billing_fields
  before update on public.user_profiles
  for each row
  execute function public.user_profiles_guard_billing_fields();

comment on function public.user_profiles_guard_billing_fields() is
  'Keeps the billing_* columns writable only by the service role (the Stripe webhook). RLS is per-row, so profile_update_own would otherwise let a user type their own VAT number into the record we report from.';
