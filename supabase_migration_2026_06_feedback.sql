-- 2026-06-24  User feedback / problem-report inbox
--
-- Powers the site-wide "Spätná väzba / Feedback" widget (every marketing page
-- + every /app page) and the admin "Feedback" log page.
--
-- FLOW:
--   widget  → POST /api/feedback/submit  (service-role insert, bypasses RLS)
--   admin   → admin_list_feedback / admin_feedback_stats / admin_update_feedback
--             (SECURITY DEFINER, gated by public._require_admin → fails closed)
--   email   → the submit endpoint also emails tkamhal@gmail.com on every row
--
-- WHY RLS with NO client policies (like admin_audit_log): nobody reads or writes
-- this table directly from the browser. Writes come from the trusted serverless
-- endpoint (service role bypasses RLS). Reads come from the three admin RPCs
-- below (SECURITY DEFINER runs as owner). So the anon/authenticated roles get
-- ZERO direct access — a leaked publishable key can't read other people's
-- feedback, and can't spam-insert around the endpoint's rate-limit.
--
-- Additive only — new table + new functions. References the existing
-- public._require_admin() (admin gate, raises 42501 if caller is not tier='admin').
--
-- Apply via Supabase SQL editor, or via the Management API (db_client) since
-- direct :5432 is blocked from the dev Mac.

BEGIN;

-- ── Table ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- what kind of report this is (the picker in the widget)
  category     text NOT NULL
                 CHECK (category IN ('data','bug','website','question','idea','other')),
  message      text NOT NULL,

  -- who sent it (best-effort). user_id/user_tier are resolved server-side from
  -- the caller's JWT when logged in; email is either their account email or an
  -- optional contact the anon visitor typed.
  user_id      uuid,
  user_tier    text,
  email        text,

  -- where + how (context that makes a "website/bug" report actionable)
  page_path    text,
  page_url     text,
  user_agent   text,
  app_lang     text,
  ip           text,

  -- admin triage
  status       text NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','in_progress','resolved','wont_fix')),
  admin_note   text,
  resolved_at  timestamptz,
  resolved_by  uuid
);

-- Newest-first listing is the only read pattern.
CREATE INDEX IF NOT EXISTS feedback_created_idx  ON public.feedback (created_at DESC);
-- Open items (the admin's working set) — partial index stays small.
CREATE INDEX IF NOT EXISTS feedback_open_idx      ON public.feedback (created_at DESC)
  WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS feedback_category_idx  ON public.feedback (category, created_at DESC);

-- RLS on, no policies → service-role + SECURITY DEFINER RPCs only.
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- ── Admin: list feedback (jsonb to dodge the PostgREST 1000-row cap) ───────────
CREATE OR REPLACE FUNCTION public.admin_list_feedback(
  p_status   text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_limit    int  DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE res jsonb;
BEGIN
  PERFORM public._require_admin();
  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO res
  FROM (
    SELECT f.id, f.created_at, f.category, f.message, f.email,
           f.user_id, f.user_tier, f.page_path, f.page_url, f.user_agent,
           f.app_lang, f.status, f.admin_note, f.resolved_at, f.resolved_by
    FROM public.feedback f
    WHERE (p_status   IS NULL OR f.status   = p_status)
      AND (p_category IS NULL OR f.category = p_category)
    ORDER BY f.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 1000), 5000))
  ) t;
  RETURN res;
END; $fn$;

-- ── Admin: counts for the overview header ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_feedback_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE res jsonb;
BEGIN
  PERFORM public._require_admin();
  SELECT jsonb_build_object(
    'total',       count(*),
    'new',         count(*) FILTER (WHERE status = 'new'),
    'in_progress', count(*) FILTER (WHERE status = 'in_progress'),
    'resolved',    count(*) FILTER (WHERE status = 'resolved'),
    'wont_fix',    count(*) FILTER (WHERE status = 'wont_fix'),
    'by_category', coalesce(
      (SELECT jsonb_object_agg(category, c) FROM (
         SELECT category, count(*) c FROM public.feedback GROUP BY category
       ) g), '{}'::jsonb)
  ) INTO res
  FROM public.feedback;
  RETURN res;
END; $fn$;

-- ── Admin: update triage status + note ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_feedback(
  p_id     uuid,
  p_status text DEFAULT NULL,
  p_note   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE res jsonb;
BEGIN
  PERFORM public._require_admin();

  IF p_status IS NOT NULL
     AND p_status NOT IN ('new','in_progress','resolved','wont_fix') THEN
    RAISE EXCEPTION 'invalid status %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.feedback f
  SET status      = coalesce(p_status, f.status),
      admin_note  = coalesce(p_note, f.admin_note),
      resolved_at = CASE WHEN p_status = 'resolved' THEN now()
                         WHEN p_status IN ('new','in_progress','wont_fix') THEN NULL
                         ELSE f.resolved_at END,
      resolved_by = CASE WHEN p_status = 'resolved' THEN auth.uid()
                         WHEN p_status IN ('new','in_progress','wont_fix') THEN NULL
                         ELSE f.resolved_by END
  WHERE f.id = p_id
  RETURNING row_to_json(f)::jsonb INTO res;

  IF res IS NULL THEN
    RAISE EXCEPTION 'feedback row % not found', p_id USING ERRCODE = 'P0002';
  END IF;
  RETURN res;
END; $fn$;

GRANT EXECUTE ON FUNCTION public.admin_list_feedback(text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_feedback_stats()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_feedback(uuid, text, text) TO authenticated;

COMMIT;
