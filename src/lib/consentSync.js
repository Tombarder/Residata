/**
 * Tell the account what this person chose in the cookie banner.
 *
 * Page and feature events are recorded only with analytics consent (track.js), and
 * the choice itself lived only in this browser. So in admin → a person's activity, a
 * customer who declined looked exactly like a customer who never opens the app. The
 * signed-in person's latest choice now goes to their profile (analytics_consent /
 * analytics_consent_at) through record_analytics_consent(), which writes those two
 * columns for auth.uid() and nothing else, and only when the choice changed.
 *
 * Runs when someone signs in (the choice may predate the account) and whenever the
 * banner saves a choice. Fire-and-forget: a failure here never touches the page.
 */
import { supabaseData, isSupabaseReady } from "./supabase";
import { getSignedInUser } from "./authToken";
import { readConsent } from "./consent";

let lastSynced = null;

export async function syncConsentToAccount() {
  try {
    if (!isSupabaseReady()) return;
    const me = getSignedInUser();
    const choice = readConsent()?.analytics;
    if (!me?.id || typeof choice !== "boolean") return;
    const key = `${me.id}:${choice}`;
    if (lastSynced === key) return;
    const { error } = await supabaseData.rpc("record_analytics_consent", { p_granted: choice });
    if (!error) lastSynced = key;
  } catch {
    /* the page must never notice */
  }
}

/** Installs the banner listener once; returns the remover. */
export function installConsentSync() {
  if (typeof window === "undefined") return () => {};
  const onChange = () => { syncConsentToAccount(); };
  window.addEventListener("residata-consent-changed", onChange);
  return () => window.removeEventListener("residata-consent-changed", onChange);
}
