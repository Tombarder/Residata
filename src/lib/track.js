/**
 * Lightweight user activity tracking.
 * Inserts events into Supabase `user_activity` table (RLS: anyone can
 * insert, only admins can read). Fire-and-forget — errors are swallowed
 * so a failing track() never breaks UI.
 *
 * Session ID is stable for the browser tab (sessionStorage).
 */
import { supabaseData, isSupabaseReady } from "./supabase";
import { getSignedInUser } from "./authToken";
import { hasAnalyticsConsent } from "./consent";

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
  // GDPR/ePrivacy: first-party usage analytics run ONLY with explicit consent.
  // No cookie choice yet, or "Reject" in the banner → no-op (honors the banner,
  // which was previously cosmetic). Essential/session behavior is elsewhere.
  if (!hasAnalyticsConsent()) return;
  try {
    // F-116: no getUser() round-trip per event. And (2026-10-06) no
    // getSession() either: that waits on gotrue's auth lock, and a write
    // queued behind that lock is one that silently never happens
    // (authStateHandler.js). The signed-in user comes from the lock-free
    // token store; the insert goes through the lock-free data client.
    const me = getSignedInUser();
    await supabaseData.from("user_activity").insert({
      user_id: me?.id || null,
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
