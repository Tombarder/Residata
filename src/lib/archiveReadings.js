/* The Pivot's history, in flats.
 *
 * In archive mode analytics_pivot counts rows of analytics.unit_facts — one per flat per
 * READING (analytics.unit_cube's n is count(*) over them). The Pivot summed those as
 * though they were flats: SK holds about 7 500, so September, read 30 times, showed about
 * 225 000 under Počet by Mesiac, and October — five daily readings, then one every four
 * days — about 82 000: a 63 % fall that is only the market being read less often, and a
 * November of about 60 000 after it. Grouped by Datum, the mornings that only re-collect
 * the few projects a reading missed showed as days of their own, a few projects each: a
 * sawtooth under a flat market.
 *
 * TWO STEPS, the assistant's rule (api/_lib/archiveCounts.js):
 *
 * 1. normaliseArchiveGrain() turns each grain row into flats at an average reading:
 *   · grouped by Datum, each day bucket is divided by the full readings that day holds
 *     (public.archive_days.readings — one, or two on a day with a re-run such as SK
 *     2026-08-31); a day that holds no full reading of its market is dropped.
 *   · otherwise each (market, month) cell is divided by the full readings of that market
 *     in that month on the days the Datum filter lets through — the sum of those days'
 *     readings, so a re-run day counts twice there as its rows do. A cell with no full
 *     reading in scope is dropped.
 *   · grouped by Batch (presný čas), each bucket is one snapshot already: unchanged, and
 *     the same when the Batch filter picks snapshots.
 *   Every additive component is divided — the counts and the sums and counts behind
 *   averages, sums and €/m² — so a figure over several months weighs each month by its
 *   flats, not by how often it was read. Minimum and maximum are one flat's own value and
 *   stay. The rows of a morning that re-collected missed projects stay in their month:
 *   they complete the reading before them.
 *
 * 2. periodFactors() then lets a table node — a row, a column cell, the total — AVERAGE
 *   its rows over the periods it spans instead of adding them up: each market over its
 *   own distinct months among the node's rows (and, rows being days, over its days within
 *   each month), and the markets added together. Added up, a scope of 30 September and
 *   1 October showed a 100-flat project as 200 — one month-average each — where the
 *   assistant says 100. A node of one month in one market is unchanged.
 *
 * The grain must carry the market and the month of every row, so archive-mode requests
 * add `country` and `snapshot_month` to the dims they do not already hold
 * (archiveGrainDims). Both are cube dimensions, so the request stays on the cube; they go
 * LAST, after the Rows and the Column, so the tree builder — which reads d[0..] for the
 * Rows and d[rows.length] for the Column — groups over them.
 */

// The grain's additive components (analytics_pivot's m object). mn_*/mx_* are not.
const PREFIXES = ["cs", "cb", "ob", "ce", "iz", "po", "m2"];
const ADDITIVE = ["n", "avail", "sold", "res", "prer", "s_pw", "s_lw",
  ...PREFIXES.flatMap((p) => [`s_${p}`, `n_${p}`])];

/** A grain row's components with every additive one multiplied by `f`. */
export function scaleComponents(m, f) {
  const out = { ...(m || {}) };
  for (const k of ADDITIVE) if (out[k] != null) out[k] = (Number(out[k]) || 0) * f;
  return out;
}

/** The dims an archive-mode grain is asked for: the page's own, then the market and the
 *  month of every row when they are not among them. */
export function archiveGrainDims(dims) {
  const out = [...(dims || [])];
  for (const k of ["country", "snapshot_month"]) if (!out.includes(k)) out.push(k);
  return out;
}

/** public.archive_days rows { day, country, readings } → { SK: Map('2026-10-05' → 1, …),
 *  CZ: … }: the full readings each market's day holds. A row without `readings` (the view
 *  before it carried them) is one reading; a day of none is left out. */
export function readingDaysByCountry(rows) {
  const out = {};
  for (const r of rows || []) {
    if (!r || !r.country || !r.day) continue;
    const n = r.readings == null ? 1 : Number(r.readings);
    if (!(n > 0)) continue;
    const day = String(r.day).slice(0, 10);
    const m = (out[r.country] ||= new Map());
    m.set(day, (m.get(day) || 0) + n);
  }
  return out;
}

const active = (f) => !!f && (f.mode === "empty" || f.mode === "not_empty"
  || ((f.mode == null || f.mode === "in" || f.mode === "not_in") && Array.isArray(f.values) && f.values.length > 0));
const EMPTY = "__EMPTY__";   // the Pivot's "(prázdne)" value

/** Which readings a Pivot's filters let into the grain: the Datum filter as the engine
 *  applies it (in / not_in / empty / not_empty — buildPivotSpec sends nothing else for a
 *  date), and whether a Batch filter has picked snapshots. */
export function archiveReadingScope(filters) {
  const scope = { only: null, except: null, none: false, perBatch: false };
  for (const f of filters || []) {
    if (!active(f)) continue;
    if (f.key === "batch_timestamp" && (f.mode == null || f.mode === "in")) scope.perBatch = true;
    if (f.key !== "datum") continue;
    if (f.mode === "empty") scope.none = true;          // every row has a day
    else if (f.mode === "not_empty") continue;
    else {
      const days = new Set(f.values.filter((v) => v !== EMPTY).map((v) => String(v).slice(0, 10)));
      if (f.mode === "not_in") scope.except = days;
      else scope.only = days;
    }
  }
  return scope;
}

/** cell(country, day, month) → { r, mk, month, day } — the readings `r` a grain row or a
 *  record of that market and day/month is divided by, and the period it belongs to — or
 *  null when no full reading of it is in scope. By Datum (`dims` holds 'datum') the period
 *  is the day; otherwise the month. */
export function archiveCells(days, scope, dims) {
  const byDay = (dims || []).includes("datum");
  const inScope = (d) => !scope.none && (!scope.only || scope.only.has(d)) && !(scope.except && scope.except.has(d));
  const perMonth = new Map();
  for (const [country, byDate] of Object.entries(days || {})) {
    for (const [d, n] of byDate) {
      if (!inScope(d)) continue;
      const k = `${country}|${d.slice(0, 7)}`;
      perMonth.set(k, (perMonth.get(k) || 0) + n);
    }
  }
  return (country, day, month) => {
    if (country == null) return null;
    if (byDay) {
      const d = day == null ? null : String(day).slice(0, 10);
      const r = (d && inScope(d) && days?.[country]?.get(d)) || 0;
      return r ? { r, mk: String(country), month: d.slice(0, 7), day: d } : null;
    }
    const mo = month != null ? String(month).slice(0, 7) : null;
    const r = (mo && perMonth.get(`${country}|${mo}`)) || 0;
    return r ? { r, mk: String(country), month: mo, day: null } : null;
  };
}

/** Archive grain rows [{ d, m }] over `dims` → the same rows in flats, each carrying its
 *  `cell` (archiveCells) for periodFactors. `days` is readingDaysByCountry(); `scope` is
 *  archiveReadingScope() of the filters the grain was asked with. */
export function normaliseArchiveGrain(grain, dims, days, scope = {}) {
  if (!Array.isArray(grain)) return grain;
  if (dims.includes("batch_timestamp") || scope.perBatch) return grain;
  const cellOf = archiveCells(days, scope, dims);
  const iC = dims.indexOf("country");
  const iM = dims.indexOf("snapshot_month");
  const iD = dims.indexOf("datum");
  const out = [];
  for (const g of grain) {
    const cell = cellOf(g?.d?.[iC], iD >= 0 ? g.d[iD] : null, iM >= 0 ? g.d[iM] : null);
    if (!cell) continue;
    out.push({ d: g.d, m: cell.r === 1 ? g.m : scaleComponents(g.m, 1 / cell.r), cell });
  }
  return out;
}

/** For the items of one table node, the factor each one counts with so the node is the
 *  AVERAGE over the periods it spans: each market over its distinct months among the
 *  items (and, items being days, over its days within each month), the markets added.
 *  `cellOf(item)` gives the item's cell; an item without one (today's market, a batch)
 *  counts in full. */
export function periodFactors(items, cellOf) {
  const months = new Map();
  const days = new Map();
  const cells = items.map(cellOf);
  for (const c of cells) {
    if (!c) continue;
    if (!months.has(c.mk)) months.set(c.mk, new Set());
    months.get(c.mk).add(c.month);
    if (c.day) {
      const k = `${c.mk}|${c.month}`;
      if (!days.has(k)) days.set(k, new Set());
      days.get(k).add(c.day);
    }
  }
  return cells.map((c) => {
    if (!c) return 1;
    const M = months.get(c.mk).size;
    const D = c.day ? days.get(`${c.mk}|${c.month}`).size : 1;
    return 1 / (M * D);
  });
}
