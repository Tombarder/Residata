/**
 * Lightweight user activity tracking.
 * Inserts events into Supabase `user_activity` table (RLS: anyone can
 * insert, only admins can read). Fire-and-forget — errors are swallowed
 * so a failing track() never breaks UI.
 *
 * Session ID is stable for the browser tab (sessionStorage).
 */
import { supabase, isSupabaseReady } from "./supabase";

let _sessionId = null;
function sessionId() {
  if (_sessionId) return _sessionId;
  if (typeof window === "undefined") return null;
  try {
    _sessionId = sessionStorage.getItem("residata_session_id");
    if (!_sessionId) {
      _sessionId = (crypto.randomUUID && crypto.randomUUID()) || `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("residata_session_id", _sessionId);
    }
  } catch {
    _sessionId = `s_${Date.now()}`;
  }
  return _sessionId;
}

export async function track(eventType, data = {}) {
  if (!isSupabaseReady()) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("user_activity").insert({
      user_id: user?.id || null,
      session_id: sessionId(),
      event_type: eventType,
      event_data: data && Object.keys(data).length ? data : null,
      page_path: typeof window !== "undefined" ? window.location.pathname : null,
      referrer: typeof document !== "undefined" ? (document.referrer || null) : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent?.slice(0, 300) : null,
    });
  } catch {
    // Swallow — tracking nikdy nebreakuje UI
  }
}
