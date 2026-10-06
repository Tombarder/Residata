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
 * normaliseArchiveGrain() turns the grain into flats at an average reading:
 *   · grouped by Datum, each day bucket is one reading. A day that is a full reading of
 *     its market (public.archive_days) is kept as it is; any other day is dropped.
 *   · otherwise each (market, month) cell is divided by the number of full readings of
 *     that market in that month that the Datum filter lets through — one when a single
 *     day is picked, every reading of the month when none is. A cell with no full reading
 *     in scope is dropped.
 *   · grouped by Batch (presný čas), each bucket is one snapshot already: unchanged, and
 *     the same when the Batch filter picks snapshots.
 * Every additive component is divided — the counts and the sums and counts behind
 * averages, sums and €/m² — so a figure over several months weighs each month by its
 * flats, not by how often it was read. Minimum and maximum are one flat's own value and
 * stay. The rows of a morning that re-collected missed projects stay in their month: they
 * complete the reading before them.
 *
 * The grain must carry the market and the month of every row, so archive-mode requests
 * add `country` and `snapshot_month` to the dims they do not already hold
 * (archiveGrainDims). Both are cube dimensions, so the request stays on the cube; they go
 * LAST, after the Rows and the Column, so the tree builder — which reads d[0..] for the
 * Rows and d[rows.length] for the Column — sums over them.
 */

// The grain's additive components (analytics_pivot's m object). mn_*/mx_* are not.
const PREFIXES = ["cs", "cb", "ob", "ce", "iz", "po", "m2"];
const ADDITIVE = ["n", "avail", "sold", "res", "prer", "s_pw", "s_lw",
  ...PREFIXES.flatMap((p) => [`s_${p}`, `n_${p}`])];

/** The dims an archive-mode grain is asked for: the page's own, then the market and the
 *  month of every row when they are not among them. */
export function archiveGrainDims(dims) {
  const out = [...(dims || [])];
  for (const k of ["country", "snapshot_month"]) if (!out.includes(k)) out.push(k);
  return out;
}

/** public.archive_days rows { day, country } → { SK: Set('2026-10-05', …), CZ: … }. */
export function readingDaysByCountry(rows) {
  const out = {};
  for (const r of rows || []) {
    if (!r || !r.country || !r.day) continue;
    (out[r.country] ||= new Set()).add(String(r.day).slice(0, 10));
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

function scaled(m, r) {
  const out = { ...m };
  for (const k of ADDITIVE) if (out[k] != null) out[k] = (Number(out[k]) || 0) / r;
  return out;
}

/** Archive grain rows [{ d, m }] over `dims` (which include country and snapshot_month)
 *  → the same rows in flats. `days` is readingDaysByCountry(); `scope` is
 *  archiveReadingScope() of the filters the grain was asked with. */
export function normaliseArchiveGrain(grain, dims, days, scope = {}) {
  if (!Array.isArray(grain)) return grain;
  if (dims.includes("batch_timestamp") || scope.perBatch) return grain;
  const iC = dims.indexOf("country");
  const iM = dims.indexOf("snapshot_month");
  const iD = dims.indexOf("datum");
  const inScope = (d) => !scope.none && (!scope.only || scope.only.has(d)) && !(scope.except && scope.except.has(d));
  const perMonth = new Map();
  for (const [country, set] of Object.entries(days || {})) {
    for (const d of set) {
      if (!inScope(d)) continue;
      const k = `${country}|${d.slice(0, 7)}`;
      perMonth.set(k, (perMonth.get(k) || 0) + 1);
    }
  }
  const out = [];
  for (const g of grain) {
    const country = g?.d?.[iC];
    let r;
    if (iD >= 0) {
      const d = g.d[iD] == null ? null : String(g.d[iD]).slice(0, 10);
      r = d && days?.[country]?.has(d) ? 1 : 0;
    } else {
      r = perMonth.get(`${country}|${g?.d?.[iM]}`) || 0;
    }
    if (!r) continue;
    out.push(r === 1 ? g : { d: g.d, m: scaled(g.m || {}, r) });
  }
  return out;
}
