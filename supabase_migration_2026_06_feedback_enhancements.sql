-- 2026-06-24  Feedback enhancements: project context + screenshots + "my submissions"
--
-- Builds on supabase_migration_2026_06_feedback.sql. Additive only.
--
--  1. project_id / project_name  — auto-captured when feedback is filed from a
--     project page, so triage knows which project a report is about.
--  2. attachment_path            — optional screenshot, stored in a PRIVATE
--     storage bucket; admins view it via a short-lived signed URL.
--  3. my_feedback()              — lets a logged-in user see their OWN past
--     submissions + status (safe columns only — never admin_note / ip).
--  4. admin_list_feedback()      — recreated to surface the new columns.
--
-- Apply via the Management API (db_client) — direct :5432 is blocked from the Mac.

BEGIN;

-- ── 1+2. New columns ──────────────────────────────────────────────────────────
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS project_id      text,
  ADD COLUMN IF NOT EXISTS project_name    text,
  ADD COLUMN IF NOT EXISTS attachment_path text;

-- ── 2. Private bucket for screenshots ────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-attachments', 'feedback-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Admins can READ objects in that bucket (so the admin page can mint a signed
-- URL to view a screenshot). Uploads happen only via the service-role endpoint,
-- so no INSERT policy for clients — anon/auth can't write here directly.
DROP POLICY IF EXISTS "feedback attachments admin read" ON storage.objects;
CREATE POLICY "feedback attachments admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'feedback-attachments'
    AND EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.tier = 'admin')
  );

-- ── 3. my_feedback(): caller's own submissions (no admin_note / ip / user_agent) ─
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
    SELECT id, created_at, category, message, status, project_name
    FROM public.feedback
    WHERE user_id = auth.uid()
    ORDER BY created_at DESC
    LIMIT 50
  ) t;
  RETURN res;
END; $fn$;

GRANT EXECUTE ON FUNCTION public.my_feedback() TO authenticated;

-- ── 4. admin_list_feedback(): add project + attachment columns ────────────────
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
           f.project_id, f.project_name, f.attachment_path
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
