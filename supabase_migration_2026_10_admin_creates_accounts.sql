-- An admin can create an account on a PERSONAL e-mail (gmail, azet, seznam, …).
--
-- Boss, 2026-10-06: an "Add user" button in admin → Users that makes a working
-- account at once, as if the person had signed up, without any confirmation e-mail.
-- The people he makes accounts for by hand are exactly the ones who cannot sign up
-- themselves: journalists and freelancers on gmail, whom the business-e-mail gate
-- (v2/migrations/2026-08-18_signup_business_email_only.sql; kept on purpose, company
-- decision 7729a1) refuses. The gate is a BEFORE INSERT trigger on auth.users, so it
-- refuses the server's createUser too — and the sign-in form asks the same
-- public.signup_email_allowed() before it sends a code, so even an account that did
-- exist could not get one.
--
-- The gate already has the right door: reference.signup_email_policy.exempt_emails,
-- the addresses allowed through on a consumer domain. What was missing is a way for
-- the SERVER to use it — service_role has no privilege on that table, and the table
-- lives in a schema that may stop being served by the API (board item 4ad244). So:
-- one narrow function, executable by service_role only, that adds or removes ONE
-- address. /api/admin/create-user adds the address before it creates the account;
-- /api/admin/delete-user removes it when the account goes — an exemption left behind
-- for a deleted person would be personal data kept with no purpose (GDPR).
--
-- Not a way around the gate: only the server can call it, and the server calls it
-- only for an admin creating an account, after checking that the caller is admin.
--
-- Safe to re-run: CREATE OR REPLACE, then the grants are set again (a re-created
-- SECURITY DEFINER function in public gets EXECUTE for anon/authenticated from
-- Supabase's default privileges — the REVOKE must follow every CREATE).

create or replace function public.admin_set_signup_email_exempt(p_email text, p_exempt boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_before text[];
  v_after  text[];
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'admin_set_signup_email_exempt: "%" is not an e-mail address', p_email
      using errcode = '22023';
  end if;

  select exempt_emails into v_before
    from reference.signup_email_policy where id = 1
    for update;
  -- No policy row = the gate is open to everyone (signup_email_allowed), so
  -- there is nothing to exempt from and nothing to remove.
  if not found then
    return false;
  end if;
  v_before := coalesce(v_before, '{}');

  if p_exempt then
    if v_email = any (select lower(btrim(e)) from unnest(v_before) e) then
      return false;
    end if;
    v_after := v_before || v_email;
  else
    v_after := coalesce(
      (select array_agg(e order by o) from unnest(v_before) with ordinality as u(e, o)
        where lower(btrim(e)) <> v_email),
      '{}');
    if cardinality(v_after) = cardinality(v_before) then
      return false;
    end if;
  end if;

  update reference.signup_email_policy
     set exempt_emails = v_after, updated_at = now()
   where id = 1;
  return true;
end;
$$;

comment on function public.admin_set_signup_email_exempt(text, boolean) is
  'Adds (p_exempt=true) or removes ONE address in reference.signup_email_policy.exempt_emails; returns whether the list changed. service_role only: /api/admin/create-user (admin creating an account on a personal e-mail) and /api/admin/delete-user (the exemption goes with the account). See supabase_migration_2026_10_admin_creates_accounts.sql.';

revoke all on function public.admin_set_signup_email_exempt(text, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_signup_email_exempt(text, boolean) to service_role;
