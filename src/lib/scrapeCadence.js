/**
 * The data-collection interval an admin sets in Data Control → Zber dát.
 * Pure helpers, shared by the editor and its tests. The database enforces the same
 * range (public.admin_set_scrape_cadence raises 22023 outside it).
 */
export const MIN_DAYS = 1;
export const MAX_DAYS = 30;
export const PRESETS = [1, 2, 3, 4, 7, 14, 30];

/** A whole number of days in range, or null. Accepts what an <input> gives. */
export function parseDays(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= MIN_DAYS && n <= MAX_DAYS ? n : null;
}

/** The −/+ buttons: one day either way from what is typed (or the saved value), clamped. */
export function stepDays(draft, current, delta) {
  const base = parseDays(draft) ?? parseDays(current) ?? MIN_DAYS;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, base + delta));
}

/** "každý deň" / "každé 4 dni" / "každých 7 dní" — and the English equivalents. */
export function everyDays(n, lang = "sk") {
  if (lang === "sk") {
    if (n === 1) return "každý deň";
    return n >= 2 && n <= 4 ? `každé ${n} dni` : `každých ${n} dní`;
  }
  return n === 1 ? "every day" : `every ${n} days`;
}
