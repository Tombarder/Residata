// Shared date helpers.
//
// daysUntil — the SINGLE source for "days left". Counts whole CALENDAR days
// between today and the target (both at local midnight), clamped to >= 0, so the
// number always matches the end DATE shown to the user (ends 16 Jul, today 10 Jul
// → 6). An earlier hour-based Math.ceil over-counted a partial day (6.16 → "7"),
// which disagreed with the end date — and the same ceil had drifted into the
// admin panel. One helper so every surface stays consistent.
export function daysUntil(target) {
  if (target === null || target === undefined) return 0;
  const ms = target instanceof Date ? target.getTime() : new Date(target).getTime();
  if (!Number.isFinite(ms)) return 0;
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  return Math.max(0, Math.round((startOfDay(ms) - startOfDay(Date.now())) / 86400000));
}
