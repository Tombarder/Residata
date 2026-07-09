-- 2026-07-09: durable anon AI daily cap.
-- The anon 1/day cap used to live in an in-memory Map in api/ai/chat.js (per Vercel
-- serverless instance, reset on cold start) → bypassable. Now anon usage is logged to
-- ai_usage_log with caller_ip (user_id NULL) and the cap is counted from the DB by IP,
-- exactly like the logged-in cap is counted by user_id.
ALTER TABLE public.ai_usage_log ADD COLUMN IF NOT EXISTS caller_ip text;
CREATE INDEX IF NOT EXISTS ai_usage_log_anon_ip_idx
  ON public.ai_usage_log (caller_ip, requested_at) WHERE user_id IS NULL;
