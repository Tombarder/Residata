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
