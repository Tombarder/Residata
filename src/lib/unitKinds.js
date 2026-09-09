/* What counts as a home.
 *
 * MIRRORS v2/lib/unit_kinds.py :: HOME_TYPES — the single source of truth, which
 * also GENERATES reference.is_home_type() in the database. Every server-side money
 * aggregate filters through that function (final.home_units in the serving views,
 * analytics.v_home_unit_facts in market_report.py, the analytics.dim_registry
 * "is_home" row for the Pivot, and the report_* functions). This module exists for
 * the aggregates the browser computes itself — the Pivot's record fallback and the
 * Reports page, which holds a project's units in memory and slices them locally.
 *
 * WHY IT MATTERS (measured on the live catalogue, 2026-09-09). A developer's price
 * list carries parking bays, cellars, shops, offices and building plots next to the
 * flats. Averaging money across them compares different products:
 *   Na Kacici            avg price   98 391 EUR  vs  353 536 EUR for its homes
 *   Rezidencia Timravy   EUR/m2       2 452      vs    3 476       (-29.5%)
 * 45 active projects were distorted, 8 of them by 20% or more. Market-wide the
 * error is under 1%, which is exactly why it survived for so long: invisible in the
 * total, severe in the individual project somebody is deciding on.
 *
 * It is an ALLOW-LIST on both sides, deliberately: a kind added later
 * (parking_garage, storage, land, …) is automatically NOT a home and can never
 * reach a flat count or a EUR/m2 average. That also makes this copy fail SAFE — if
 * a genuinely new HOME kind were added upstream and not here, the browser would
 * leave it out of money aggregates, which shows up as a visibly lower count rather
 * than as a quietly wrong average. Re-verify the two sides agree with:
 *   SELECT prosrc FROM pg_proc WHERE proname = 'is_home_type';
 *
 * NULL is a home: it means the parser stated no kind, and on a residential price
 * list that is a flat. reference.is_home_type() says the same (`typ IS NULL OR …`).
 */
export const HOME_UNIT_TYPES = new Set(["apartment", "flat", "house", "semi-detached house", "studio"]);

/** True when this unit is a dwelling — the only kind that may enter a money average. */
export function isHomeUnit(typ) {
  if (typ == null || typ === "") return true;
  return HOME_UNIT_TYPES.has(String(typ).trim().toLowerCase());
}
