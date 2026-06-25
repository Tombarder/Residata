-- 2026-06-24  Feedback THREADS — turn one-shot messages into conversations
--
-- Model: public.feedback = the CONVERSATION header (category/status/user/project/…).
--        public.feedback_messages = every message in the thread (user + admin),
--        the single source of truth for message content.
--
-- Both sides see the full thread + can continue it (new message in the same
-- conversation), or start a new topic (new conversation). Admin keeps a log of
-- conversations (bumped by each new message, with a "needs reply" flag) AND can
-- open the whole conversation.
--
-- feedback.message / admin_reply stay as a denormalised opener/last-reply for
-- the notify email + backward compat, but the THREAD is feedback_messages.
-- Additive. Apply via the Management API (db_client).

BEGIN;

-- ── Thread messages ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.feedback(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sender          text NOT NULL CHECK (sender IN ('user','admin')),
  author_id       uuid,
  body            text NOT NULL,
  attachment_path text
);
CREATE INDEX IF NOT EXISTS feedback_messages_conv_idx ON public.feedback_messages (conversation_id, created_at);
ALTER TABLE public.feedback_messages ENABLE ROW LEVEL SECURITY;  -- service-role + RPCs only

-- ── Conversation activity (for sorting + "needs reply") ───────────────────────
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sender     text;

-- Keep last_message_at / last_sender in sync — can't drift.
CREATE OR REPLACE FUNCTION public.feedback_touch_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  UPDATE public.feedback
  SET last_message_at = NEW.created_at, last_sender = NEW.sender
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $fn$;
DROP TRIGGER IF EXISTS feedback_messages_touch ON public.feedback_messages;
CREATE TRIGGER feedback_messages_touch AFTER INSERT ON public.feedback_messages
  FOR EACH ROW EXECUTE FUNCTION public.feedback_touch_conversation();

-- ── Backfill existing rows into the thread (chronological: opener then reply) ──
INSERT INTO public.feedback_messages (conversation_id, created_at, sender, author_id, body, attachment_path)
SELECT f.id, f.created_at, 'user', f.user_id, f.message, f.attachment_path
FROM public.feedback f
WHERE f.message IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.feedback_messages m WHERE m.conversation_id = f.id);

INSERT INTO public.feedback_messages (conversation_id, created_at, sender, author_id, body)
SELECT f.id, coalesce(f.replied_at, f.created_at), 'admin', f.replied_by, f.admin_reply
FROM public.feedback f
WHERE f.admin_reply IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.feedback_messages m WHERE m.conversation_id = f.id AND m.sender = 'admin');

-- ── User: their conversations (newest activity first) ─────────────────────────
CREATE OR REPLACE FUNCTION public.my_feedback()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.activity_at DESC), '[]'::jsonb) INTO res
  FROM (
    SELECT f.id, f.created_at, f.category, f.status, f.project_name, f.last_sender,
           coalesce(f.last_message_at, f.created_at) AS activity_at,
           (SELECT count(*) FROM public.feedback_messages m WHERE m.conversation_id = f.id) AS msg_count,
           (SELECT m.body FROM public.feedback_messages m WHERE m.conversation_id = f.id ORDER BY m.created_at DESC LIMIT 1) AS last_body
    FROM public.feedback f
    WHERE f.user_id = auth.uid()
    ORDER BY coalesce(f.last_message_at, f.created_at) DESC
    LIMIT 50
  ) t;
  RETURN res;
END; $fn$;

-- ── User: one full thread they own ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_conversation(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feedback f WHERE f.id = p_id AND f.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT jsonb_build_object(
    'id', f.id, 'category', f.category, 'status', f.status, 'project_name', f.project_name,
    'messages', coalesce((
      SELECT jsonb_agg(jsonb_build_object('sender', m.sender, 'body', m.body,
                'created_at', m.created_at, 'has_attachment', (m.attachment_path IS NOT NULL)) ORDER BY m.created_at)
      FROM public.feedback_messages m WHERE m.conversation_id = f.id), '[]'::jsonb)
  ) INTO res FROM public.feedback f WHERE f.id = p_id;
  RETURN res;
END; $fn$;

-- ── Admin: conversation log (last message + needs-reply + count) ──────────────
CREATE OR REPLACE FUNCTION public.admin_list_feedback(
  p_status text DEFAULT NULL, p_category text DEFAULT NULL, p_limit int DEFAULT 1000
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE res jsonb;
BEGIN
  PERFORM public._require_admin();
  SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.activity_at DESC), '[]'::jsonb) INTO res
  FROM (
    SELECT f.id, f.created_at, f.category, f.email, f.user_id, f.user_tier,
           f.page_path, f.page_url, f.app_lang, f.status, f.admin_note,
           f.project_id, f.project_name, f.last_sender,
           coalesce(f.last_message_at, f.created_at) AS activity_at,
           (f.last_sender = 'user') AS needs_reply,
           (SELECT count(*) FROM public.feedback_messages m WHERE m.conversation_id = f.id) AS msg_count,
           (SELECT m.body FROM public.feedback_messages m WHERE m.conversation_id = f.id ORDER BY m.created_at DESC LIMIT 1) AS last_body
    FROM public.feedback f
    WHERE (p_status IS NULL OR f.status = p_status) AND (p_category IS NULL OR f.category = p_category)
    ORDER BY coalesce(f.last_message_at, f.created_at) DESC
    LIMIT greatest(1, least(coalesce(p_limit, 1000), 5000))
  ) t;
  RETURN res;
END; $fn$;

-- ── Admin: one full thread (incl. attachment paths to sign) ───────────────────
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
                'created_at', m.created_at, 'attachment_path', m.attachment_path) ORDER BY m.created_at)
      FROM public.feedback_messages m WHERE m.conversation_id = f.id), '[]'::jsonb)
  ) INTO res FROM public.feedback f WHERE f.id = p_id;
  IF res IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN res;
END; $fn$;

GRANT EXECUTE ON FUNCTION public.my_feedback()                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_conversation(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_feedback(text, text, int)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_conversation(uuid)               TO authenticated;

COMMIT;
