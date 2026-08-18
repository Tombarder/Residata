// absorption.js — sales-velocity-derived metrics (the useful replacement for the
// vanity "sold to date" cumulative count).
//
// CADENCE-INDEPENDENT BY DESIGN: every formula here is built on `sold_last_month`,
// which the backend computes as a DATE-WINDOWED count (flats whose sale date falls in
// the last 30 days), NOT as "diff the last N snapshots". So whether we scrape daily,
// weekly, or monthly, "sold last month" still means the same thing and these ratios
// stay correct — only the smoothness of the underlying signal changes, never its
// meaning. Do not reintroduce any snapshot-count assumption here.

// --- per-PROJECT: "sells out in ~X months" -------------------------------------
// available now ÷ sales per month. Null when there is no velocity signal yet (we
// can't estimate a sell-out pace from zero recent sales) or nothing left to sell.
export function monthsToSellout(availableUnits, soldLastMonth) {
  const a = Number(availableUnits);
  const v = Number(soldLastMonth);
  if (!Number.isFinite(a) || !Number.isFinite(v) || v <= 0 || a <= 0) return null;
  return a / v;
}

// Just the value, e.g. "~4 mo" / "~2 yr" — for a KPI tile that already has a label.
export function fmtSelloutValue(availableUnits, soldLastMonth, lang = "en") {
  const m = monthsToSellout(availableUnits, soldLastMonth);
  if (m == null) return null;
  if (m >= 24) {
    const y = Math.round(m / 12);
    return lang === "sk" ? `~${y} r.` : `~${y} ${y === 1 ? "year" : "years"}`;
  }
  const r = m < 10 ? Math.round(m * 10) / 10 : Math.round(m);
  // Slovak writes decimals with a comma ("4,1"), not a dot — the rest of the UI
  // already formats numbers the Slovak way ("6 357"), so this kept it inconsistent.
  return lang === "sk" ? `~${String(r).replace(".", ",")} mes.` : `~${r} ${r === 1 ? "month" : "months"}`;
}

// Full phrase, e.g. "sells out in ~4 mo" — for inline text next to other copy.
export function fmtMonthsToSellout(availableUnits, soldLastMonth, lang = "en") {
  const v = fmtSelloutValue(availableUnits, soldLastMonth, lang);
  if (v == null) return null;
  return lang === "sk" ? `vypredané o ${v}` : `sells out in ${v}`;
}

// --- per-MARKET: "months of inventory" -----------------------------------------
// total available ÷ total sold-per-month = how many months of supply the market
// holds at the current pace. ONLY for country/market aggregates — never framed as a
// project "sell-out", which would be confusing at market scope.
export function marketMonthsOfInventory(totalAvailable, totalSoldLastMonth) {
  const a = Number(totalAvailable);
  const v = Number(totalSoldLastMonth);
  if (!Number.isFinite(a) || !Number.isFinite(v) || v <= 0) return null;
  return a / v;
}

// READINESS GATE — the market figure is only trustworthy once enough projects have a
// real velocity signal. Our data is still young (we only "see" a sale that happens
// AFTER we start tracking a project), so today most projects read 0 sold-last-month
// and the market velocity undercounts → months-of-inventory would look like false
// oversupply. Until coverage crosses the threshold we show "waiting for more data"
// instead of the number. Auto-flips on as history accumulates — no code change needed.
export const MARKET_ABSORPTION_MIN_COVERAGE = 0.40; // ≥40% of active projects w/ velocity

export function velocityCoverage(projects) {
  const active = (projects || []).filter((p) => (p.status || "active") === "active");
  if (!active.length) return 0;
  const withVel = active.filter((p) => Number(p.sold_last_month) > 0).length;
  return withVel / active.length;
}

export function isMarketAbsorptionReady(projects) {
  return velocityCoverage(projects) >= MARKET_ABSORPTION_MIN_COVERAGE;
}

// What to show for the market "months of inventory" stat right now: either the live
// value (once ready) or the honest waiting state, so the stat is visible + plumbed.
export function marketInventoryDisplay(totalAvailable, totalSoldLastMonth, projects, lang = "en") {
  if (!isMarketAbsorptionReady(projects)) {
    return { ready: false, text: lang === "sk" ? "čaká sa na viac dát" : "waiting for more data" };
  }
  const m = marketMonthsOfInventory(totalAvailable, totalSoldLastMonth);
  if (m == null) return { ready: false, text: lang === "sk" ? "čaká sa na viac dát" : "waiting for more data" };
  const r = m < 10 ? Math.round(m * 10) / 10 : Math.round(m);
  return { ready: true, text: lang === "sk" ? `${r} mes. zásob` : `${r} mo of supply`, value: m };
}
