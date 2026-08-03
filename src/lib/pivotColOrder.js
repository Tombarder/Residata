/**
 * pivotColOrder — logical ordering for pivot COLUMN keys.
 *
 * The pivot cross-tab picks its column values by frequency (so the most-populated
 * columns survive the MAX_COL_VALUES cap), but that leaves them in an arbitrary
 * left→right order (e.g. rooms 3, 2, 1, 4). This module re-orders an already-
 * selected set of column keys into a *logical* order that holds for ANY dimension,
 * filter, or dataset:
 *
 *   • numeric dims (rooms, floor, area, price)  → ascending    1 < 2 < 3 < 4
 *   • known ordinals (stav: V,R,PR,P)           → canonical funnel order
 *   • date-ish dims (handover, month)           → chronological 2025 < 2026-05 < 2027
 *   • everything else (project, building, geo)   → locale-natural  A1 < A2 < A10
 *   • blank / unknown buckets                    → always last
 *
 * Pure + dependency-free (no React, no FIELDS registry) so it is trivially
 * unit-testable — see pivotColOrder.test.mjs. The caller passes the field's
 * numeric-ness and any explicit ordinal; nothing else is needed.
 */

/** The bucket normKey() uses for null/empty column values. */
export const DEFAULT_BLANK_KEY = "(prázdne)";

/** Keys that mean "no value" and must sort to the very end, in any mode. */
const BLANKISH = new Set([
  "(prázdne)", "(blank)", "(none)", "-", "—", "–", "", "null", "undefined", "n/a", "na", "?",
]);

function isBlankKey(k, blankKey) {
  if (k == null) return true;
  const s = String(k).trim();
  if (s === "" || k === blankKey) return true;
  return BLANKISH.has(s.toLowerCase());
}

/**
 * Extract a comparable chronological key from a (possibly messy) date-ish string.
 * Returns an integer `year*100 + month` (month 0 when unknown), or null when the
 * string does not START like a date/quarter — so "Rezidencia 2026" is NOT a date,
 * but "2026-05", "2026", "2026/2027" and "1Q 2026" are.
 *
 * Handles the real kolaudácia formats seen in production:
 *   "2026-05-31", "2026-12", "2027", "2026/2027", "1Q 2026", "Q1 2026", "2015".
 */
export function dateSortKey(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return null;

  // ISO-ish, year-first: YYYY  |  YYYY-MM  |  YYYY-MM-DD  |  YYYY/…  |  YYYY.MM
  let m = s.match(/^(19|20)(\d{2})(?:[-/.](\d{1,2}))?/);
  if (m) {
    const year = parseInt(m[1] + m[2], 10);
    const mm = m[3] ? parseInt(m[3], 10) : 0;
    return year * 100 + (mm >= 1 && mm <= 12 ? mm : 0);
  }

  // Quarter forms: "1Q 2026" / "Q1 2026" (→ month 1,4,7,10 so quarters order too).
  m = s.match(/^([1-4])\s*Q\s*((?:19|20)\d{2})/i) || s.match(/^Q\s*([1-4])\s*((?:19|20)\d{2})/i);
  if (m) {
    const q = parseInt(m[1], 10);
    const year = parseInt(m[2], 10);
    return year * 100 + (q - 1) * 3 + 1;
  }
  return null;
}

// A string that is ENTIRELY a number (optional sign, digits, spaces as thousands,
// one decimal separator). "1.0" ✓  "-1" ✓  "2 939" ✓  "2026-05" ✗  "1Q 2026" ✗.
const NUM_RE = /^-?\d[\d \u00A0]*(?:[.,]\d+)?$/;
function toNumber(value) {
  const s = String(value == null ? "" : value).trim();
  if (!NUM_RE.test(s)) return NaN;
  const cleaned = s.replace(/[ \u00A0]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Slovak-locale natural comparison ("A2" < "A10", diacritics folded). */
function localeCmp(a, b) {
  return String(a).localeCompare(String(b), "sk", { numeric: true, sensitivity: "base" });
}

/**
 * Return `keys` re-ordered into logical display order. Non-mutating.
 *
 * @param {string[]} keys        the (already frequency-capped) column keys
 * @param {object}   [opts]
 * @param {boolean}  [opts.isNumber]  true when the column field is numeric-typed
 * @param {string[]} [opts.ordinal]   explicit order for a known ordinal dim (e.g. stav)
 * @param {string}   [opts.blankKey]  the empty-bucket sentinel (default "(prázdne)")
 * @returns {string[]}
 */
export function orderPivotColKeys(keys, opts = {}) {
  if (!Array.isArray(keys)) return [];
  if (keys.length < 2) return [...keys];

  const { isNumber = false, ordinal = null, blankKey = DEFAULT_BLANK_KEY } = opts;
  const blank = (k) => isBlankKey(k, blankKey);
  const nonBlank = keys.filter((k) => !blank(k));

  // Pick the base comparator (applied only to non-blank vs non-blank).
  let base;
  if (ordinal && ordinal.length) {
    // Explicit ordinal (e.g. stav V<R<PR<P). Unknown values go after known ones,
    // ordered among themselves by locale — deterministic, never throws.
    const rank = new Map(ordinal.map((v, i) => [String(v), i]));
    base = (a, b) => {
      const ra = rank.has(String(a)) ? rank.get(String(a)) : Infinity;
      const rb = rank.has(String(b)) ? rank.get(String(b)) : Infinity;
      return ra !== rb ? ra - rb : localeCmp(a, b);
    };
  } else {
    const allNumeric = nonBlank.length > 0 && nonBlank.every((k) => !Number.isNaN(toNumber(k)));
    if (isNumber || allNumeric) {
      // Numeric ascending. A stray non-numeric key (shouldn't happen on a numeric
      // dim) is placed after the real numbers rather than corrupting the order.
      base = (a, b) => {
        const na = toNumber(a), nb = toNumber(b);
        const fa = !Number.isNaN(na), fb = !Number.isNaN(nb);
        if (fa && fb) return na !== nb ? na - nb : localeCmp(a, b);
        if (fa !== fb) return fa ? -1 : 1;
        return localeCmp(a, b);
      };
    } else {
      // Date-like only when the field is PREDOMINANTLY date-shaped (guards against
      // a lone project name that happens to contain a year).
      const dated = nonBlank.filter((k) => dateSortKey(k) != null).length;
      const isDateLike = nonBlank.length > 0 && dated >= Math.ceil(nonBlank.length * 0.6);
      if (isDateLike) {
        base = (a, b) => {
          const da = dateSortKey(a), db = dateSortKey(b);
          if (da != null && db != null) return da !== db ? da - db : localeCmp(a, b);
          if ((da != null) !== (db != null)) return da != null ? -1 : 1; // dated before undated
          return localeCmp(a, b);
        };
      } else {
        base = localeCmp; // plain locale-natural
      }
    }
  }

  // Wrap: blank-ish keys always sort last (stable among themselves).
  const cmp = (a, b) => {
    const ba = blank(a), bb = blank(b);
    if (ba || bb) return ba === bb ? localeCmp(a, b) : ba ? 1 : -1;
    return base(a, b);
  };

  return [...keys].sort(cmp);
}
