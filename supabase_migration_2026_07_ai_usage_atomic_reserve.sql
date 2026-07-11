-- 2026-07-11 — public.ai_usage_reserve: atomic daily-cap reservation for /api/ai/chat
--
-- ROOT CAUSE of the "daily cap can be exceeded under concurrency" bug: the chat
-- endpoint COUNTED today's ai_usage_log rows, then (seconds later, after the LLM
-- answer) INSERTed the usage row — two separate non-transactional steps. Two
-- near-simultaneous requests from the same principal both read count=0, both
-- passed the gate, both inserted → the 1/day anon cap (and every tier cap) could
-- be doubled.
--
-- Fix: a single atomic reservation. This function takes a per-principal advisory
-- transaction lock, counts under the lock, and — only if under the limit —
-- INSERTs a reservation row and returns its id. Concurrent requests for the SAME
-- principal serialize on the lock so the count-then-insert can't interleave;
-- different principals hash to different keys (no cross-user contention). The
-- lock is transaction-scoped, so it's held only for the microsecond count+insert,
-- NOT across the multi-second LLM call.
--
-- The endpoint then either UPDATEs the reserved row with token counts on success,
-- or DELETEs it on failure — so a failed answer still doesn't count against the
-- cap (unchanged leniency), while the race window is closed.

CREATE OR REPLACE FUNCTION public.ai_usage_reserve(
  p_user_id  uuid,
  p_ip       text,
  p_limit    integer,
  p_since    timestamptz,
  p_endpoint text DEFAULT 'chat'
)
RETURNS TABLE(allowed boolean, day_count integer, reservation_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count   integer;
  v_id      bigint;
  v_lockkey bigint;
BEGIN
  -- Serialize concurrent reservations for the SAME principal (user id, else ip).
  v_lockkey := hashtextextended(
    CASE WHEN p_user_id IS NOT NULL THEN 'uid:' || p_user_id::text
         ELSE 'ip:' || COALESCE(p_ip, '') END, 0);
  PERFORM pg_advisory_xact_lock(v_lockkey);

  IF p_user_id IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.ai_usage_log
      WHERE user_id = p_user_id AND requested_at >= p_since;
  ELSE
    SELECT count(*) INTO v_count FROM public.ai_usage_log
      WHERE user_id IS NULL AND caller_ip = COALESCE(p_ip, '') AND requested_at >= p_since;
  END IF;

  IF v_count >= p_limit THEN
    RETURN QUERY SELECT false, v_count, NULL::bigint;
    RETURN;
  END IF;

  INSERT INTO public.ai_usage_log (user_id, caller_ip, endpoint, ok)
    VALUES (p_user_id, p_ip, p_endpoint, true)
    RETURNING id INTO v_id;

  RETURN QUERY SELECT true, v_count, v_id;
END;
$function$;

-- Only the service-role backend (/api/ai/chat uses the secret key) calls this.
-- 2026-07-11: REVOKE from the NAMED roles anon/authenticated too, not just PUBLIC.
-- The public schema's default privileges GRANT EXECUTE on every new function to
-- anon+authenticated, and that grant is to the named roles — so `REVOKE FROM PUBLIC`
-- alone leaves this SECURITY DEFINER writer anon-executable (integrity_check
-- secdef_grants / admin_rpc_gates caught it live). Revoking the named roles keeps it
-- backend-only across any recreate/redeploy.
REVOKE ALL ON FUNCTION public.ai_usage_reserve(uuid, text, integer, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_reserve(uuid, text, integer, timestamptz, text) TO service_role;
