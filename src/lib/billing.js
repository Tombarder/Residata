// src/lib/billing.js
//
// Frontend entry points for real Stripe billing. Mirrors trial.js: always
// refresh the access token first (dead tokens are the #1 cause of silent
// 401s), POST to the API, then hand off to Stripe's hosted pages by
// redirecting to the returned URL.
//
//   startCheckout()      → Stripe Checkout (subscribe €49.99/mo)
//   openBillingPortal()  → Stripe Billing Portal (update card / cancel)
//
// Both throw Error("SESSION_EXPIRED") if the session can't be revived, so the
// caller can prompt re-login instead of showing a dead button.

import { getFreshAccessToken } from "./sessionGuard";
import { forceTokenRefresh } from "./authToken";

const authHeaders = (token) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

async function postAuthed(path) {
  let token = await getFreshAccessToken(); // non-blocking; throws SESSION_EXPIRED only if no session
  let r = await fetch(path, { method: "POST", headers: authHeaders(token), body: "{}" });
  // Stale-token recovery: the non-blocking token store can hand back a token
  // that just crossed expiry (its bounded refresh raced out). One forced refresh
  // + single retry — the same "stale → 401 → refresh → retry" contract the
  // RLS-gated read layer uses — instead of surfacing a false "session expired".
  if (r.status === 401) {
    token = await forceTokenRefresh();
    if (token) r = await fetch(path, { method: "POST", headers: authHeaders(token), body: "{}" });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.url) {
    const e = new Error(data?.error || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return data.url;
}

// Start a subscription. On success the browser leaves for Stripe's Checkout;
// this function does not return in the happy path.
// Opens Stripe in a NEW tab so residata.eu stays open behind it. The tab is
// opened synchronously inside the click handler (before any await) so the
// browser's popup blocker allows it; we point it at Stripe once the session URL
// is ready. If the popup was blocked, we fall back to same-tab navigation.
async function openStripe(path) {
  // Open the new tab onto our OWN branded "Opening secure checkout…" page (not
  // about:blank) so the user never sees a raw blank tab during the ~1s it takes
  // the server to create the checkout session. It's a fully-loaded static page,
  // so setting win.location.href navigates cleanly to Stripe — unlike
  // document.write, which left the doc mid-load and swallowed the navigation
  // (the old stuck-blank bug). Popup blocked → fall back to same-tab.
  const win = window.open("/checkout-redirect.html", "_blank");
  let url;
  try {
    url = await postAuthed(path);
  } catch (e) {
    if (win && !win.closed) win.close();
    throw e;
  }
  if (win && !win.closed) win.location.href = url;
  else window.location.href = url; // popup blocked → same tab, so it never hangs
}

export async function startCheckout() {
  await openStripe("/api/stripe?action=checkout");
}

// Open the self-serve billing portal (manage card / cancel / invoices).
export async function openBillingPortal() {
  await openStripe("/api/stripe?action=portal");
}
