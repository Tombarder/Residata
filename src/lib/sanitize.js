/**
 * Minimal input sanitization helpers.
 *
 * Why not DOMPurify?
 *   DOMPurify is a ~40 kB dep for an HTML-fragment sanitization problem
 *   we don't have. Residata's user-entered fields are plain text (name,
 *   company) or URL/phone strings — not rich HTML. For that surface, a
 *   targeted whitelist/blacklist approach ships less code, has fewer
 *   moving parts, and is easier to reason about.
 *
 * Why sanitize at all if React escapes?
 *   React's JSX interpolation auto-escapes, so rendering
 *   `<div>{profile.full_name}</div>` is XSS-safe even if name contains
 *   <script>. But the attack surface isn't only React:
 *     · Welcome emails (HTML templates in api/webhooks/welcome-user.js)
 *       could render name in a context that isn't escaped
 *     · Admin CSV export: a name of =HYPERLINK("evil") in Excel fires
 *     · Third-party tools that re-emit the data (Slack notifications)
 *   So we scrub at intake — a single controlled boundary — rather than
 *   rely on every downstream consumer doing the right thing.
 */

/**
 * Sanitize a plain-text input. Strips HTML tag characters, control
 * characters, and leading formula characters that trigger CSV/XLSX
 * formula execution. Collapses whitespace. Enforces max length.
 *
 * @param {string} raw input from user
 * @param {object} opts
 *   - max (default 200): max chars after sanitization
 * @returns {string}
 */
export function cleanText(raw, { max = 200 } = {}) {
  if (typeof raw !== "string") return "";
  let s = raw;
  // Strip HTML tag delimiters — prevents <script>, <img onerror=...>
  s = s.replace(/[<>]/g, "");
  // Strip control chars (keeps newline — but we also collapse whitespace below)
  s = s.replace(/[\x00-\x1F\x7F]/g, " ");
  // CSV/spreadsheet formula injection — any leading =, +, -, @ is treated
  // as a formula by Excel/Sheets. Prefix with apostrophe (Excel convention
  // to force literal) OR just strip. We strip, since a leading + or - on
  // a name is never legitimate.
  s = s.replace(/^[=+@]+/, "");
  // Collapse internal whitespace to single spaces
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/**
 * Validate and lightly clean a URL. Rejects non-http(s) schemes to
 * prevent javascript:, data:, file:, mailto: smuggled as LinkedIn URLs.
 * Returns clean string, or empty string on invalid.
 */
export function cleanUrl(raw, { max = 500 } = {}) {
  if (typeof raw !== "string") return "";
  const s = raw.trim().slice(0, max);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

/**
 * Phone number — keep digits, +, spaces, parentheses, dashes. Reject
 * anything longer than a reasonable phone. No formatting normalization
 * (don't want to mangle international numbers).
 */
export function cleanPhone(raw, { max = 32 } = {}) {
  if (typeof raw !== "string") return "";
  const s = raw.replace(/[^0-9+\-\s()]/g, "").trim().slice(0, max);
  return s;
}

/**
 * Email — very lightweight. Real RFC 5322 validation is complex and
 * full email libraries are heavy; a pragmatic regex catches obvious
 * garbage while allowing edge-case-valid addresses through.
 */
export function cleanEmail(raw, { max = 254 } = {}) {
  if (typeof raw !== "string") return "";
  const s = raw.trim().slice(0, max).toLowerCase();
  if (!s) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return "";
  return s;
}
