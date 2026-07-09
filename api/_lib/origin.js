// api/_lib/origin.js
//
// Shared origin-check helper for API endpoints.
//
// F-310 (DP-095): the previous `referer.startsWith(o)` pattern matched
// `https://residata.sk.evil.com/page` against the trusted entry
// `https://residata.sk` — subdomain-spoofing vector. With a stolen
// Supabase Bearer token, an attacker hosting at residata.sk.evil.com
// could craft a Referer header and pass the origin gate.
//
// Fix: use `new URL().origin` to extract the canonical origin (scheme +
// host + port, no path, no trailing slash) and compare exact-match against
// the allowlist. This shape is what the WHATWG URL spec produces; it's
// what `req.headers.origin` would natively be for same-origin XHR/fetch
// requests anyway.

/**
 * Returns true if the request originates from one of the trusted origins.
 *
 * Checks BOTH:
 *  - `Origin` header (set on CORS preflights, fetch, XHR) — exact match
 *  - `Referer` header (set on navigations) — parsed via URL() so the
 *    origin is canonical (no path manipulation possible).
 *
 * On `Referer` parse failure (malformed URL), returns false.
 */
export function isTrustedOrigin(req, trustedOrigins) {
  const originHeader = req.headers.origin || "";
  if (originHeader && trustedOrigins.includes(originHeader)) return true;

  const refererHeader = req.headers.referer || "";
  if (refererHeader) {
    try {
      const refOrigin = new URL(refererHeader).origin;
      if (trustedOrigins.includes(refOrigin)) return true;
    } catch (_) {
      // Malformed referer (rare) — reject conservatively.
      return false;
    }
  }
  return false;
}

// ── ONE canonical trusted-origins list for the whole API ──────────────────
//
// Every browser-facing endpoint gates on this SAME list. It lives here, once,
// so adding or moving a domain is a single edit — never per-endpoint copies
// that drift out of sync. That drift is exactly what broke the residata.eu
// launch: the frontend moved to residata.eu but seven endpoints kept their own
// stale arrays (residata-gamma / residata.sk only), so every authenticated
// action from the new domain answered 403 "untrusted origin" — which the client
// surfaced as "your session expired", i.e. "login is broken". A shared constant
// makes that class of bug impossible: the next domain change touches one line.
export const TRUSTED_ORIGINS = [
  "https://residata.eu",               // live production domain
  "https://www.residata.eu",
  "https://residata-gamma.vercel.app", // Vercel production alias / fallback
  "https://residata.sk",               // reserved brand domains (kept trusted)
  "https://www.residata.sk",
  "http://localhost:5173",             // Vite dev
  "http://localhost:4173",             // Vite preview
  "http://localhost:3000",             // alt local dev
];

/** Check a request against the canonical shared allowlist (the common case). */
export function isTrustedRequest(req) {
  return isTrustedOrigin(req, TRUSTED_ORIGINS);
}
