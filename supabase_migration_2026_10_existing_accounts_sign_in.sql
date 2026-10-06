-- 2026-10-06 — an account that exists can always sign in.
--
-- Sign-in and sign-up are one form. Before it sends a code, the form asks
-- public.signup_email_allowed() — which answered only "may this address CREATE an
-- account". So an EXISTING account on a personal domain (gmail, azet, …) that was
-- not on the exemption list was told "use your work e-mail" and could never get a
-- code, although nothing at the database stops it signing in (the gate is a
-- BEFORE INSERT trigger on auth.users and never fires for a sign-in). Today the
-- three such accounts are all exempt, so nobody is locked out; but any account on a
-- domain that joins the personal list later, or whose exemption is removed, would
-- be. Boss's rule (2026-10-06): personal addresses cannot sign up on the web — the
-- people he adds in admin can always sign in. An account existing is that fact.
--
-- The trigger is unaffected: at INSERT time the new address has no account yet.
-- Disclosure: for a PERSONAL address this answers "true" when an account exists —
-- the same thing the exemption list already discloses, and the same answer the
-- sign-in itself gives. For a work address it was and stays "true" regardless.

CREATE OR REPLACE FUNCTION public.signup_email_allowed(p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_enabled boolean;
    v_exempt  text[];
    v_email   text := lower(btrim(coalesce(p_email, '')));
BEGIN
    -- Not an address at all → let the normal validation reject it, not this gate.
    IF position('@' IN v_email) = 0 THEN
        RETURN true;
    END IF;

    SELECT enabled, exempt_emails INTO v_enabled, v_exempt
    FROM reference.signup_email_policy WHERE id = 1;

    -- No policy row / gate switched off → allow, so a missing config can never
    -- lock everyone out of registering.
    IF v_enabled IS NULL OR v_enabled = false THEN
        RETURN true;
    END IF;

    IF v_email = ANY (SELECT lower(btrim(e)) FROM unnest(coalesce(v_exempt, '{}')) e) THEN
        RETURN true;
    END IF;

    -- An account that exists signs in; the gate is about creating new ones.
    IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
        RETURN true;
    END IF;

    RETURN NOT public.is_personal_email(v_email);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.signup_email_allowed(text) TO anon, authenticated, service_role;
