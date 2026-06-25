-- 2026-06-24  Feedback auto-diagnostics + auto page-screenshot
--
-- Every feedback message can carry, captured automatically (zero user effort):
--   · diagnostics (jsonb)         — recent JS errors / failed requests / page /
--                                   browser / viewport (the INVISIBLE errors a
--                                   screenshot can't show)
--   · auto_screenshot_path (text) — a best-effort screenshot of the page the user
--                                   was on, stored in the same private bucket
--
-- admin_conversation() returns both so the admin sees it all in the thread.
-- Additive. Apply via the Management API (db_client).

BEGIN;

ALTER TABLE public.feedback_messages
  ADD COLUMN IF NOT EXISTS diagnostics          jsonb,
  ADD COLUMN IF NOT EXISTS auto_screenshot_path text;

CREATE OR REPLACE FUNCTION public.admin_conversation(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE res jsonb;
BEGIN
  PERFORM public._require_admin();
  SELECT jsonb_build_object(
    'id', f.id, 'category', f.category, 'status', f.status, 'email', f.email,
    'user_tier', f.user_tier, 'project_name', f.project_name, 'page_path', f.page_path,
    'page_url', f.page_url, 'created_at', f.created_at, 'admin_note', f.admin_note,
    'messages', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body,
                'created_at', m.created_at, 'attachment_path', m.attachment_path,
                'auto_screenshot_path', m.auto_screenshot_path, 'diagnostics', m.diagnostics) ORDER BY m.created_at)
      FROM public.feedback_messages m WHERE m.conversation_id = f.id), '[]'::jsonb)
  ) INTO res FROM public.feedback f WHERE f.id = p_id;
  IF res IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN res;
END; $fn$;

GRANT EXECUTE ON FUNCTION public.admin_conversation(uuid) TO authenticated;

COMMIT;
