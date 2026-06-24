-- 2026-06-24  Feedback admin reply (send a response to the user through Residata)
--
-- Adds reply columns + surfaces the reply in BOTH directions:
--   · admin_list_feedback() — so the admin sees what was already replied
--   · my_feedback()         — so the USER sees the response in their "My messages"
--
-- The actual email send happens in /api/feedback/reply (admin-gated serverless).
-- Additive only. Apply via the Management API (db_client).

BEGIN;

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS admin_reply text,
  ADD COLUMN IF NOT EXISTS replied_at  timestamptz,
  ADD COLUMN IF NOT EXISTS replied_by  uuid;

-- my_feedback(): caller's own submissions + any reply they received (safe columns).
CREATE OR REPLACE FUNCTION public.my_feedback()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO res
  FROM (
    SELECT id, created_at, category, message, status, project_name, admin_reply, replied_at
    FROM public.feedback
    WHERE user_id = auth.uid()
    ORDER BY created_at DESC
    LIMIT 50
  ) t;
  RETURN res;
END; $fn$;

GRANT EXECUTE ON FUNCTION public.my_feedback() TO authenticated;

-- admin_list_feedback(): include the reply columns.
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
           f.app_lang, f.status, f.admin_note, f.resolved_at, f.resolved_by,
           f.project_id, f.project_name, f.attachment_path,
           f.admin_reply, f.replied_at, f.replied_by
    FROM public.feedback f
    WHERE (p_status   IS NULL OR f.status   = p_status)
      AND (p_category IS NULL OR f.category = p_category)
    ORDER BY f.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 1000), 5000))
  ) t;
  RETURN res;
END; $fn$;

GRANT EXECUTE ON FUNCTION public.admin_list_feedback(text, text, int) TO authenticated;

COMMIT;
