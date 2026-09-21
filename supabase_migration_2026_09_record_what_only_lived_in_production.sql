-- 2026-09-21 — six objects existed ONLY in production.
--
-- 🔴 WHY THIS FILE EXISTS. A sweep compared every live object in our schemas
-- against every CREATE statement in both repositories. 288 objects; 17 appeared
-- in no migration anywhere. Eleven were explained — self-creating unit_facts
-- partitions, and tables defined in the scraper repo. SIX WERE NOT DEFINED
-- ANYWHERE AT ALL:
--
--   public.premium_domains      which e-mail domain gets which tier; read by
--                               src/lib/capabilities.js
--   public.rls_auto_enable()    the event-trigger function that turns RLS ON for
--                               every new public table. Losing this does not
--                               break anything visibly — it just stops new
--                               tables being protected, silently
--   public.auto_approve_on_profile_complete()
--   public.notify_on_profile_complete()
--   public.notify_admin_on_profile_complete()
--
-- They were referenced in application code and in a security review document, and
-- created by hand in the Supabase console. (A sixth, public.user_dashboards, turned
-- out to HAVE a migration — written 2026-07-07, marked "applied live", committed to
-- a branch nobody ever merged. That original is now on main in the scraper repo as
-- v2/migrations/2026-07-07_user_dashboards.sql, which is its author's chosen home;
-- defining it here as well would be the same drift in a new place.) Had the database been rebuilt from the
-- repositories, all six would simply have been absent. This file is the record;
-- it is written so that running it against the live database changes nothing.
--
-- 🔴 notify_admin_on_profile_complete() HAS NO TRIGGER. It is superseded by
-- notify_on_profile_complete(), which sends the admin FYI and the welcome mail in
-- one pass. It is recorded here as it stands rather than dropped: dropping a
-- SECURITY DEFINER function is a decision for a person, and this file's job is to
-- stop production and the repository disagreeing, not to change production.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RLS auto-enable — infrastructure
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
      EXECUTE FUNCTION public.rls_auto_enable();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. premium_domains — which e-mail domain gets which tier
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.premium_domains (
    domain       text        NOT NULL PRIMARY KEY,
    default_tier text        NOT NULL DEFAULT 'paid'
                             CHECK (default_tier = ANY (ARRAY['free','paid','admin'])),
    note         text,
    created_at   timestamptz DEFAULT now(),
    created_by   uuid        REFERENCES auth.users(id)
);

ALTER TABLE public.premium_domains ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND tablename='premium_domains' AND policyname='domains_read_admin') THEN
    CREATE POLICY domains_read_admin ON public.premium_domains
      FOR SELECT TO authenticated USING (current_user_is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND tablename='premium_domains' AND policyname='domains_write_admin') THEN
    CREATE POLICY domains_write_admin ON public.premium_domains
      FOR ALL TO authenticated USING (current_user_is_admin())
                            WITH CHECK (current_user_is_admin());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.premium_domains TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. the user_profiles triggers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_approve_on_profile_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only when profile_completed just flipped from false/null → true,
  -- user is still pending, and not already approved.
  IF NEW.profile_completed = TRUE
     AND NEW.tier = 'pending'
     AND NEW.approved_at IS NULL
     AND (OLD.profile_completed IS NULL OR OLD.profile_completed = FALSE) THEN
    NEW.tier := 'free';
    NEW.approved_at := NOW();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_profile_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_secret  TEXT;
  v_web_url TEXT;
  v_fire    BOOLEAN;
BEGIN
  v_fire := NEW.profile_completed = TRUE
    AND (TG_OP = 'INSERT' OR OLD.profile_completed IS DISTINCT FROM NEW.profile_completed);

  IF NOT v_fire THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_secret  FROM public._webhook_config WHERE key = 'webhook_secret';
  SELECT value INTO v_web_url FROM public._webhook_config WHERE key = 'web_url';

  IF v_secret IS NULL OR v_web_url IS NULL THEN
    RAISE WARNING 'notify_on_profile_complete: webhook config missing';
    RETURN NEW;
  END IF;

  -- Admin FYI (no approval needed any more — tier already set to 'free' by BEFORE trigger)
  PERFORM net.http_post(
    url     := v_web_url || '/api/webhooks/admin-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', v_secret),
    body    := jsonb_build_object('user_id', NEW.id),
    timeout_milliseconds := 5000
  );

  -- Welcome email to the user
  PERFORM net.http_post(
    url     := v_web_url || '/api/webhooks/welcome-user',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', v_secret),
    body    := jsonb_build_object('user_id', NEW.id),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$function$;

-- Superseded by notify_on_profile_complete(); NO trigger references it. Recorded
-- as it stands so the repository matches production — see the note at the top.
CREATE OR REPLACE FUNCTION public.notify_admin_on_profile_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_secret TEXT;
  v_web_url TEXT;
  v_should_notify BOOLEAN;
BEGIN
  -- Condition: profile_completed just flipped to TRUE, still pending, not notified.
  v_should_notify :=
    NEW.tier = 'pending'
    AND NEW.profile_completed = TRUE
    AND NEW.admin_notified_at IS NULL
    AND (TG_OP = 'INSERT' OR OLD.profile_completed IS DISTINCT FROM NEW.profile_completed);

  IF NOT v_should_notify THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_secret   FROM public._webhook_config WHERE key = 'webhook_secret';
  SELECT value INTO v_web_url  FROM public._webhook_config WHERE key = 'web_url';

  IF v_secret IS NULL OR v_web_url IS NULL THEN
    RAISE WARNING 'notify_admin: webhook config missing';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_web_url || '/api/webhooks/admin-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', v_secret
    ),
    body := jsonb_build_object('user_id', NEW.id),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auto_approve'
                   AND tgrelid = 'public.user_profiles'::regclass) THEN
    CREATE TRIGGER trg_auto_approve BEFORE UPDATE ON public.user_profiles
      FOR EACH ROW EXECUTE FUNCTION public.auto_approve_on_profile_complete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_on_profile_complete'
                   AND tgrelid = 'public.user_profiles'::regclass) THEN
    CREATE TRIGGER trg_notify_on_profile_complete AFTER INSERT OR UPDATE ON public.user_profiles
      FOR EACH ROW EXECUTE FUNCTION public.notify_on_profile_complete();
  END IF;
END $$;
