// The archive holds one row per flat per READING. Its counts (analytics_pivot's n,
// avail, sold, res in mode 'archive') are therefore flat-readings: a month read every
// day counts each flat ~30 times, a month read every few days a handful of times. As a
// number of flats that is meaningless, and it moves with how often the market is read
// rather than with the market — a month of fewer readings looks like a collapse.
//
// archiveGroups() turns them into flats: each (market, month) cell is divided by the
// number of full readings of that market in that month, which gives the flats on the
// market at an average reading of the month. A history grouped by month is then the
// average stock of each month; any other grouping over the history is that, averaged
// over the months IN WHICH THAT GROUP HAS ROWS — each market over its own months, the
// markets added (a group over SK since July and CZ since September is SK's average month
// plus CZ's, as the two read grouped by country). Averaged over the months of the whole
// answer instead, a project launched in September read 100 by project (its 400
// flat-months over the four months July–October) and 200 as a filter on the same
// project; a market read since September was diluted by the other market's summer.
// The Pivot's history averages its table nodes the same way (src/lib/archiveReadings.js).
//
// Prices are ratios of sums — of the same per-reading cells. Left as flat-readings, a
// month read daily weighed ~4x a month read every four days, so a history's average
// price leaned toward the months read most often: 200 000 € for July–September and
// 240 000 € in October averaged 203 200 €, not the average month's 210 000 €. The sums
// behind them are divided by the readings too, so every month weighs by its flats.
// Minimum and maximum are a flat's own price and need nothing.

import {
  readingDaysByCountry, holdingSpecs, archiveHolding, heldReadingDays, monthReadings, holdingLags,
} from "../../src/lib/archiveReadings.js";

// rows:      analytics_pivot rows { d: [dim values…], m: { n, avail, sold, res, s_cs,
//            n_cs, mn_cs, mx_cs, s_pw, s_lw } } over dims that include 'country' and
//            'snapshot_month'
// readings:  { 'SK|2026-09': 30, 'SK|2026-10': 8, … } — full readings per market-month
//            (readingsPerMonth)
// groupKey:  the dimension the answer is grouped by (null for one overall group)
export function archiveGroups(rows, dims, groupKey, readings) {
  const at = (row, k) => row.d?.[dims.indexOf(k)];
  const SUMS = ["n", "avail", "sold", "res", "s_cs", "n_cs", "s_pw", "s_lw"];
  const groups = new Map();
  for (const row of rows || []) {
    const country = at(row, "country");
    const month = at(row, "snapshot_month");
    const r = readings[`${country}|${month}`];
    if (!r) continue;                     // no full reading of that market that month
    const key = groupKey ? (at(row, groupKey) != null ? String(at(row, groupKey)) : "(none)") : "ALL";
    const m = row.m || {};
    const g = groups.get(key) || { markets: new Map(), mn_cs: null, mx_cs: null };
    const mk = g.markets.get(country) || { months: new Set(), ...Object.fromEntries(SUMS.map((k) => [k, 0])) };
    mk.months.add(month);
    for (const k of SUMS) mk[k] += (Number(m[k]) || 0) / r;
    if (m.mn_cs != null) g.mn_cs = g.mn_cs == null ? Number(m.mn_cs) : Math.min(g.mn_cs, Number(m.mn_cs));
    if (m.mx_cs != null) g.mx_cs = g.mx_cs == null ? Number(m.mx_cs) : Math.max(g.mx_cs, Number(m.mx_cs));
    g.markets.set(country, mk);
    groups.set(key, g);
  }
  // Each market over its own months among the group's rows (one when grouped by month),
  // the markets added — so the same flats give the same number whether they are asked
  // for as a group or as a filter.
  return [...groups.entries()].map(([group, g]) => {
    const t = Object.fromEntries(SUMS.map((k) => [k, 0]));
    for (const mk of g.markets.values()) for (const k of SUMS) t[k] += mk[k] / mk.months.size;
    return {
      group,
      units: Math.round(t.n),
      available: Math.round(t.avail),
      sold: Math.round(t.sold),
      reserved: Math.round(t.res),
      avg_price_eur: t.n_cs ? Math.round(t.s_cs / t.n_cs) : null,
      avg_eur_per_m2: t.s_lw ? Math.round(t.s_pw / t.s_lw) : null,
      min_price: g.mn_cs == null ? null : Math.round(g.mn_cs),
      max_price: g.mx_cs == null ? null : Math.round(g.mx_cs),
    };
  });
}

/** Full readings per market-month from public.archive_days rows { day, country,
 *  readings }: the sum of each day's `readings`, not the number of days.
 *
 *  A day can hold two full readings: 2026-08-31 SK holds two complete markets three
 *  hours apart (07:56 and 10:58, a manual re-run), and the archive holds every row of
 *  both — counted as days, August had 31 readings against 32 readings' flat-rows, and its
 *  stock read 7 742 for 7 500. archive_days says how many full readings each day holds
 *  (count(DISTINCT scraped_at) over the approved, non-withdrawn full snapshots), so a
 *  held-back sibling, which shares its reading's time, and a repair of the projects a
 *  reading missed, which is partial, are no reading of their own: their rows complete one.
 *  A row without `readings` (the view before it carried them) is one reading. */
export function readingsPerMonth(days) {
  const out = {};
  for (const r of days || []) {
    if (!r || !r.country || !r.day) continue;
    const n = r.readings == null ? 1 : Number(r.readings);
    if (!(n > 0)) continue;
    const k = `${r.country}|${String(r.day).slice(0, 7)}`;
    out[k] = (out[k] || 0) + n;
  }
  return out;
}

// PostgREST returns at most 1 000 rows a request (db-max-rows) and says nothing when
// it stops there, so the day list is read page by page until a short page.
const PAGE = 1000;
async function readAll(page) {
  const out = [];
  for (let from = 0; from < 100 * PAGE; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message || String(error));
    const rows = Array.isArray(data) ? data : [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error("archive readings: more than 100 000 rows");
}

/** Full readings per market-month from public.archive_days, every page of it, as two
 *  maps: { cube, facts } — the readings the cube holds yet and those the facts hold
 *  (src/lib/archiveReadings.js, THE CUBE LAGS): an answer read from the cube is divided by
 *  `cube`, one read from the facts (a range filter) by `facts`; `lagging` while the cube
 *  lacks a reading the facts hold. If what they hold cannot be read, both are every
 *  reading. A view that does not carry `readings` yet is read without
 *  it — each day then one reading, as before. */
export async function fetchMarketReadings(admin) {
  const read = (cols) => readAll((from, to) => admin.from("archive_days")
    .select(cols).order("day").order("country").range(from, to));
  let rows;
  try {
    rows = await read("day,country,readings");
  } catch (e) {
    console.error("[archive readings] archive_days without readings, counting its days", e?.message || e);
    rows = await read("day,country");
  }
  const days = readingDaysByCountry(rows);
  const specs = holdingSpecs(days);
  let holding = null;
  if (specs) {
    try {
      const [cube, facts] = await Promise.all([
        admin.rpc("analytics_pivot", { p_spec: specs.cube }), admin.rpc("analytics_pivot", { p_spec: specs.facts })]);
      if (cube.error || facts.error) throw new Error((cube.error || facts.error).message);
      holding = archiveHolding(specs.from, cube.data, facts.data);
    } catch (e) {
      console.error("[archive readings] what the cube holds", e?.message || e);
    }
  }
  return {
    cube: monthReadings(heldReadingDays(days, holding, true)),
    facts: monthReadings(heldReadingDays(days, holding, false)),
    lagging: holdingLags(days, holding),
  };
}
