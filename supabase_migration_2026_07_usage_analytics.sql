-- Usage analytics — server-side aggregation over public.user_activity.
--
-- The user_activity event stream + its RLS already exist in production (created
-- ad-hoc, never versioned). This migration (1) captures that table's DDL/RLS/indexes
-- in code idempotently, and (2) adds admin-only aggregation RPCs so the owner "Usage"
-- dashboard reads pre-aggregated answers from the DB instead of pulling a capped
-- window of raw rows to the browser (the OverviewPanel's last-1000-rows approach does
-- not scale). All RPCs are SECURITY DEFINER + guarded by public.current_user_is_admin().
--
-- Apply via Supabase SQL editor OR:
--   psql "$SUPABASE_DB_URL" -f supabase_migration_2026_07_usage_analytics.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Versioned capture of the existing event table (idempotent, non-destructive)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_activity (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID,                       -- auth.uid(); NULL for anonymous (marketing) visitors
  session_id  TEXT,                       -- stable per-tab UUID (residata_session_id)
  event_type  TEXT NOT NULL,              -- 'page_view' | 'page_leave' | 'csv_exported' | 'chat_question' | ...
  event_data  JSONB,                      -- per-event detail (dwell_ms, active_ms, page, scroll_max_pct, ...)
  page_path   TEXT,
  referrer    TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_user    ON public.user_activity (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_type    ON public.user_activity (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_time    ON public.user_activity (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_session ON public.user_activity (session_id, created_at DESC);

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

-- Anyone (anon + authenticated) may INSERT their own events; only admins may READ.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_activity' AND policyname='activity_insert_any') THEN
    CREATE POLICY activity_insert_any ON public.user_activity FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_activity' AND policyname='activity_read_admin') THEN
    CREATE POLICY activity_read_admin ON public.user_activity FOR SELECT TO authenticated USING (public.current_user_is_admin());
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2) Admin-only aggregation RPCs
-- ---------------------------------------------------------------------------

-- 2a) Top-line KPIs over a window (single JSON object).
CREATE OR REPLACE FUNCTION public.admin_usage_summary(p_days int DEFAULT 30)
RETURNS jsonb
-- timezone pinned so ::date day-bucketing (returning_users active-days) is LOCAL
-- (Slovak product), not UTC — otherwise late-evening activity lands on the wrong day.
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET timezone = 'Europe/Bratislava'
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  WITH base AS (
    SELECT * FROM public.user_activity
    WHERE created_at >= now() - make_interval(days => p_days)
  ),
  sess AS (
    -- One row per SESSION (session_id only, NOT session_id+user_id): a user often
    -- logs in mid-session, so the same session_id carries anon events (login flow)
    -- then signed-in events. Grouping by (session_id,user_id) would split that one
    -- visit into a phantom "anon session" + a "signed-in session", inflating both
    -- counts. max(user_id) attributes the whole session to the signed-in user if
    -- they ever authenticated in it; a session stays anon only if they never did.
    -- active_ms = summed FOCUSED time from page_leave (tab visible + interacting);
    -- we deliberately avoid wall-clock span (an idle-open tab overstates engagement).
    SELECT session_id,
           max(user_id::text)::uuid AS user_id,   -- no max(uuid) aggregate; a session has ≤1 signed-in user
           COALESCE(sum((event_data->>'active_ms')::numeric)
                    FILTER (WHERE event_type = 'page_leave'), 0)                        AS active_ms
    FROM base
    GROUP BY session_id
  )
  SELECT jsonb_build_object(
    'window_days',      p_days,
    'dau',              (SELECT count(DISTINCT user_id) FROM base WHERE user_id IS NOT NULL AND created_at::date = now()::date),  -- calendar TODAY (local tz), not a rolling 24h
    'wau',              (SELECT count(DISTINCT user_id) FROM base WHERE user_id IS NOT NULL AND created_at >= now() - interval '7 days'),
    'mau',              (SELECT count(DISTINCT user_id) FROM base WHERE user_id IS NOT NULL),
    'total_events',     (SELECT count(*) FROM base),
    'total_sessions',   (SELECT count(*) FROM sess WHERE user_id IS NOT NULL),
    'anon_sessions',    (SELECT count(*) FROM sess WHERE user_id IS NULL),
    'active_hours',     (SELECT round((sum(active_ms) / 3600000.0)::numeric, 1) FROM sess WHERE user_id IS NOT NULL),
    'avg_active_min',   (SELECT round((avg(active_ms) FILTER (WHERE active_ms > 0) / 60000.0)::numeric, 1) FROM sess WHERE user_id IS NOT NULL),
    'exports',          (SELECT count(*) FROM base WHERE event_type IN ('csv_exported','xlsx_exported')),
    'ai_questions',     (SELECT count(*) FROM base WHERE event_type = 'chat_question'),
    'crashes',          (SELECT count(*) FROM base WHERE event_type = 'platform_crash'),
    'new_users',        (SELECT count(*) FROM public.user_profiles WHERE created_at >= now() - make_interval(days => p_days)),
    'returning_users',  (SELECT count(*) FROM (
                            SELECT user_id FROM base WHERE user_id IS NOT NULL
                            GROUP BY user_id HAVING count(DISTINCT created_at::date) > 1
                         ) x)
  ) INTO result;

  RETURN result;
END$$;

-- 2b) Daily trend for charts.
CREATE OR REPLACE FUNCTION public.admin_usage_daily(p_days int DEFAULT 30)
RETURNS TABLE(day date, active_users bigint, sessions bigint, events bigint, new_users bigint)
-- timezone pinned so daily buckets are LOCAL days (Slovak product), not UTC.
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET timezone = 'Europe/Bratislava'
AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series((now() - make_interval(days => p_days - 1))::date, now()::date, '1 day')::date AS day
  ),
  ev AS (
    SELECT created_at::date AS day, user_id, session_id
    FROM public.user_activity
    WHERE created_at >= (now() - make_interval(days => p_days - 1))::date
  ),
  signups AS (
    SELECT created_at::date AS day, count(*) AS n
    FROM public.user_profiles
    WHERE created_at >= (now() - make_interval(days => p_days - 1))::date
    GROUP BY 1
  )
  SELECT d.day,
         count(DISTINCT ev.user_id) FILTER (WHERE ev.user_id IS NOT NULL),
         count(DISTINCT ev.session_id),
         count(ev.day),   -- ev.day is non-null only for matched (real) event rows
         COALESCE(su.n, 0)
  FROM days d
  LEFT JOIN ev ON ev.day = d.day
  LEFT JOIN signups su ON su.day = d.day
  GROUP BY d.day, su.n
  ORDER BY d.day;
END$$;

-- 2c) Feature adoption ranking (which event types get used, by how many users).
-- Excludes pure navigation (page_view / page_leave) — those are ~80% of all
-- events and would drown out the actual features; total nav is already in the
-- summary's total_events. Signed-in users only for the user count.
CREATE OR REPLACE FUNCTION public.admin_usage_features(p_days int DEFAULT 30)
RETURNS TABLE(event_type text, events bigint, users bigint, last_seen timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT ua.event_type,
         count(*)::bigint,
         count(DISTINCT ua.user_id) FILTER (WHERE ua.user_id IS NOT NULL)::bigint,
         max(ua.created_at)
  FROM public.user_activity ua
  WHERE ua.created_at >= now() - make_interval(days => p_days)
    AND ua.event_type NOT IN ('page_view', 'page_leave')
  GROUP BY ua.event_type
  ORDER BY count(*) DESC;
END$$;

-- 2d) Per-user engagement rollup (the "who is doing what, how much" table).
CREATE OR REPLACE FUNCTION public.admin_usage_users(p_days int DEFAULT 90)
RETURNS TABLE(
  user_id uuid, email text, tier text, company text,
  sessions bigint, events bigint, active_min numeric, days_active bigint,
  first_seen timestamptz, last_seen timestamptz, status text,
  exports bigint, ai_questions bigint, project_views bigint, top_features jsonb
)
-- timezone pinned so days_active counts LOCAL calendar days (Slovak product).
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET timezone = 'Europe/Bratislava'
AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT ua.* FROM public.user_activity ua
    WHERE ua.user_id IS NOT NULL
      AND ua.created_at >= now() - make_interval(days => p_days)
  ),
  feats AS (  -- top meaningful features per user (exclude pure navigation noise)
    SELECT b.user_id, b.event_type, count(*) AS n
    FROM base b
    WHERE b.event_type NOT IN ('page_view','page_leave')
    GROUP BY b.user_id, b.event_type
  ),
  top_feats AS (
    SELECT f.user_id,
           jsonb_object_agg(f.event_type, f.n) FILTER (WHERE f.rnk <= 5) AS tf
    FROM (SELECT feats.user_id, feats.event_type, feats.n,
                 row_number() OVER (PARTITION BY feats.user_id ORDER BY feats.n DESC) AS rnk
          FROM feats) f
    GROUP BY f.user_id
  )
  SELECT
    b.user_id,
    up.email,
    up.tier,
    up.company,
    count(DISTINCT b.session_id)::bigint,
    count(*)::bigint,
    round((COALESCE(sum((b.event_data->>'active_ms')::numeric) FILTER (WHERE b.event_type='page_leave'), 0) / 60000.0)::numeric, 1),
    count(DISTINCT b.created_at::date)::bigint,
    min(b.created_at),
    max(b.created_at),
    CASE
      WHEN max(b.created_at) >= now() - interval '7 days'  THEN 'active'
      WHEN max(b.created_at) >= now() - interval '30 days' THEN 'idle'
      ELSE 'churned'
    END,
    count(*) FILTER (WHERE b.event_type IN ('csv_exported','xlsx_exported'))::bigint,
    count(*) FILTER (WHERE b.event_type = 'chat_question')::bigint,
    count(*) FILTER (WHERE b.event_type = 'project_view')::bigint,
    COALESCE(tf.tf, '{}'::jsonb)
  FROM base b
  LEFT JOIN public.user_profiles up ON up.id = b.user_id
  LEFT JOIN top_feats tf ON tf.user_id = b.user_id
  GROUP BY b.user_id, up.email, up.tier, up.company, tf.tf
  ORDER BY max(b.created_at) DESC;
END$$;

-- 2e) One user's full activity timeline (drill-down), newest first.
-- p_limit NULL (default) = the FULL history, no cap (Boss 2026-07-17). A caller
-- may still pass a positive limit to page; NULL/<=0 means everything.
-- return-type changed (added id) → must drop before recreate.
DROP FUNCTION IF EXISTS public.admin_user_timeline(uuid, int);
CREATE OR REPLACE FUNCTION public.admin_user_timeline(p_user_id uuid, p_limit int DEFAULT NULL)
RETURNS TABLE(
  id bigint, created_at timestamptz, event_type text, page text, page_path text,
  dwell_ms numeric, active_ms numeric, session_id text, event_data jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ua.id,
    ua.created_at,
    ua.event_type,
    COALESCE(ua.event_data->>'page', ua.event_data->>'from_page'),
    ua.page_path,
    (ua.event_data->>'dwell_ms')::numeric,
    (ua.event_data->>'active_ms')::numeric,
    ua.session_id,
    ua.event_data
  FROM public.user_activity ua
  WHERE ua.user_id = p_user_id
  -- id tiebreaker makes this a TOTAL order — required for correct offset paging
  -- (created_at alone ties on same-ms page_view/page_leave bursts, which would
  -- drop/duplicate a tied row straddling a 1000-row .range() page boundary).
  ORDER BY ua.created_at DESC, ua.id DESC
  LIMIT CASE WHEN p_limit IS NULL OR p_limit <= 0 THEN NULL ELSE p_limit END;
END$$;

-- 2f) Manual retention: count / delete OLD events before a cutoff. Nothing runs
-- automatically — the admin picks a cutoff and explicitly triggers the delete
-- (Boss 2026-07-17). Count first for a preview; delete returns the rows removed.
CREATE OR REPLACE FUNCTION public.admin_activity_count_before(p_before timestamptz)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE n bigint;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  SELECT count(*) INTO n FROM public.user_activity WHERE created_at < p_before;
  RETURN n;
END$$;

CREATE OR REPLACE FUNCTION public.admin_delete_activity_before(p_before timestamptz)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE n bigint;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  -- Guard against an empty/degenerate cutoff wiping everything unintentionally.
  IF p_before IS NULL THEN
    RAISE EXCEPTION 'cutoff required' USING errcode = '22004';
  END IF;
  DELETE FROM public.user_activity WHERE created_at < p_before;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END$$;

-- CREATE OR REPLACE FUNCTION resets EXECUTE to the PUBLIC default, so every time this
-- migration re-runs (each deploy) it silently re-opens EXECUTE to PUBLIC + anon on these
-- SECURITY DEFINER admin functions. That is a privilege-escalation surface (esp.
-- admin_delete_activity_before, a DELETE writer) even though each body gates on
-- current_user_is_admin(). REVOKE from PUBLIC FIRST, then grant only authenticated — so the
-- lock survives re-creation. (Proven live 2026-07-17: admin_user_timeline re-exposed itself
-- on a recreate; the scraper repo's integrity_check `secdef_grants` is the daily recurrence net.)
REVOKE EXECUTE ON FUNCTION public.admin_usage_summary(int)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_usage_daily(int)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_usage_features(int)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_usage_users(int)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_user_timeline(uuid, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_activity_count_before(timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_delete_activity_before(timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_usage_summary(int)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_usage_daily(int)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_usage_features(int)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_usage_users(int)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_timeline(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_count_before(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_activity_before(timestamptz) TO authenticated;

COMMIT;
