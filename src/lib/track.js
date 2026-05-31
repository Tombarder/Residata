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
    // F-116: getSession() reads from local storage (no network call);
    // getUser() would round-trip to /auth/v1/user on every track()
    // invocation, adding ~50-200ms latency and extra load on Supabase
    // Auth for what is supposed to be a fire-and-forget analytics
    // event. The JWT in localStorage is signed by Supabase so we can
    // trust the user.id off it without re-validating — and if the
    // token has been tampered with, the subsequent insert fails via
    // RLS anyway.
    const { data: { session } } = await supabase.auth.getSession();
    await supabase.from("user_activity").insert({
      user_id: session?.user?.id || null,
      session_id: sessionId(),
      event_type: eventType,
      event_data: data && Object.keys(data).length ? data : null,
      page_path: typeof window !== "undefined" ? window.location.pathname : null,
      referrer: typeof document !== "undefined" ? (document.referrer || null) : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent?.slice(0, 300) : null,
    });
  } catch (e) {
    // Swallow — tracking nikdy nebreakuje UI.
    // F-117: dev-mode visibility so silently-failing tracking (RLS
    // regression, dropped column, intermittent network) shows up in
    // the console at dev time. Production stays silent as before.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[track] insert failed:", e?.message || e);
    }
  }
}
