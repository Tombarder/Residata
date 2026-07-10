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

async function postAuthed(path) {
  const token = await getFreshAccessToken(); // throws SESSION_EXPIRED if dead
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: "{}",
  });
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
// Opens Stripe in a NEW tab so residata.eu stays open behind it. The blank tab
// is opened synchronously inside the click handler (before any await) so the
// browser's popup blocker allows it; we point it at Stripe once the session URL
// is ready. If the popup was blocked, we fall back to same-tab navigation.
async function openStripe(path) {
  const win = window.open("", "_blank");
  if (win) { try { win.document.write("<p style='font-family:sans-serif;padding:2rem;color:#555'>Opening secure Stripe checkout…</p>"); } catch (_) {} }
  try {
    const url = await postAuthed(path);
    if (win && !win.closed) win.location.assign(url);
    else window.location.assign(url);
  } catch (e) {
    if (win && !win.closed) win.close();
    throw e;
  }
}

export async function startCheckout() {
  await openStripe("/api/stripe?action=checkout");
}

// Open the self-serve billing portal (manage card / cancel / invoices).
export async function openBillingPortal() {
  await openStripe("/api/stripe?action=portal");
}
