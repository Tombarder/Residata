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

// "zostáva 1 deň" / "zostávajú 3 dni" / "zostáva 5 dní" — Slovak counts change both
// the noun AND the verb (1 · 2–4 · 5+), and a counter that runs down a trial or a
// Premium period passes through all three. It used to print "1 dní zostáva".
export function daysLeftText(n, lang = "sk") {
  if (!(n > 0)) return lang === "sk" ? "posledný deň" : "last day";
  if (lang !== "sk") return `${n} day${n === 1 ? "" : "s"} left`;
  if (n === 1) return "zostáva 1 deň";
  if (n >= 2 && n <= 4) return `zostávajú ${n} dni`;
  return `zostáva ${n} dní`;
}
