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
 * The grain must carry the market of every row, and its month when the scope spans more
 * than one (archiveGrainDims): `country`, and `snapshot_month` unless the rows are days,
 * batches, or a single month the filters name. Both are cube dimensions, so the request
 * stays on the cube; they go LAST, after the Rows and the Column, so the tree builder —
 * which reads d[0..] for the Rows and d[rows.length] for the Column — groups over them.
 * The month is asked only when needed: 500 projects over 12 months is 6 000 rows.
 *
 * The record path (median, distinct counts) counts the same way: each record weighs
 * 1 / the readings of its market-month in scope (of its day, by Datum), over the same
 * periods (archiveRecordCells, weightedCount).
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

/** The dims an archive-mode grain is asked for: the page's own, then the market of every
 *  row, then its month — only when the rows are not days or batches already and the scope
 *  (archiveReadingScope) does not name a single month. */
export function archiveGrainDims(dims, scope = {}) {
  const out = [...(dims || [])];
  if (!out.includes("country")) out.push("country");
  const monthKnown = out.includes("snapshot_month") || out.includes("datum")
    || out.includes("batch_timestamp") || scope.perBatch || !!scope.month;
  if (!monthKnown) out.push("snapshot_month");
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

/** A short fingerprint of readingDaysByCountry(): it changes when a reading lands or is
 *  withdrawn, so whatever was divided by the old readings can be asked again. */
export function readingsSignature(days) {
  const parts = [];
  for (const c of Object.keys(days || {}).sort()) {
    for (const [d, n] of [...days[c]].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) parts.push(`${c}${d}${n}`);
  }
  let h = 5381;
  const s = parts.join(",");
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${parts.length}.${h.toString(36)}`;
}

const active = (f) => !!f && (f.mode === "empty" || f.mode === "not_empty"
  || ((f.mode == null || f.mode === "in" || f.mode === "not_in") && Array.isArray(f.values) && f.values.length > 0));
const EMPTY = "__EMPTY__";   // the Pivot's "(prázdne)" value

/** Which readings a Pivot's filters let into the grain: the Datum filter as the engine
 *  applies it (in / not_in / empty / not_empty — buildPivotSpec sends nothing else for a
 *  date), whether a Batch filter has picked snapshots, and the single month the Datum and
 *  Mesiac filters confine it to (`month`), when they do. */
export function archiveReadingScope(filters) {
  const scope = { only: null, except: null, none: false, perBatch: false, month: null };
  let dayMonths = null;
  let monthsIn = null;
  for (const f of filters || []) {
    if (!active(f)) continue;
    if (f.key === "batch_timestamp" && (f.mode == null || f.mode === "in")) scope.perBatch = true;
    if (f.key === "snapshot_month" && (f.mode == null || f.mode === "in")) {
      monthsIn = new Set(f.values.filter((v) => v !== EMPTY).map((v) => String(v).slice(0, 7)));
    }
    if (f.key !== "datum") continue;
    if (f.mode === "empty") scope.none = true;          // every row has a day
    else if (f.mode === "not_empty") continue;
    else {
      const days = new Set(f.values.filter((v) => v !== EMPTY).map((v) => String(v).slice(0, 10)));
      if (f.mode === "not_in") scope.except = days;
      else { scope.only = days; dayMonths = new Set([...days].map((d) => d.slice(0, 7))); }
    }
  }
  const months = dayMonths && monthsIn ? new Set([...dayMonths].filter((m) => monthsIn.has(m))) : (dayMonths || monthsIn);
  if (months && months.size === 1) scope.month = [...months][0];
  return scope;
}

/** cell(country, day, month) → { r, mk, month, day } — the readings `r` a grain row or a
 *  record of that market and day/month is divided by, and the period it belongs to — or
 *  null when no full reading of it is in scope. By Datum (`dims` holds 'datum') the period
 *  is the day; otherwise the month, the scope's single month when the row carries none. */
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
    const mo = month != null ? String(month).slice(0, 7) : scope.month;
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

/** The record path's cell of a flat record (flats_archive: country, batch_timestamp,
 *  snapshot_month), or null for a weighing that does not apply (by Batch). */
export function archiveRecordCells(days, scope, dims) {
  if ((dims || []).includes("batch_timestamp") || scope.perBatch) return null;
  const cellOf = archiveCells(days, scope, dims);
  return (r) => {
    const day = r?.batch_timestamp ? String(r.batch_timestamp).slice(0, 10) : null;
    return cellOf(r?.country, day, r?.snapshot_month || (day ? day.slice(0, 7) : null));
  };
}

/** Flats among `recs` (those passing `pred`), as the grain path counts them: each record
 *  1 / its cell's readings, averaged over the periods `recs` span. */
export function weightedCount(recs, recordCell, pred) {
  const cells = recs.map(recordCell);
  const f = periodFactors(cells, (c) => c);
  let n = 0;
  for (let i = 0; i < recs.length; i += 1) {
    const c = cells[i];
    if (!c || (pred && !pred(recs[i]))) continue;
    n += f[i] / c.r;
  }
  return n;
}

/* ── THE CUBE LAGS ──────────────────────────────────────────────────────────────────
 * public.archive_days counts a reading the moment it is approved, and so do the facts
 * (analytics.unit_facts, written in the approval). analytics.unit_cube — the fast path an
 * archive grain is read from unless it needs the facts (a Datum row, a range, a measure
 * filter) — holds it only after its next refresh, which runs concurrently, after the
 * approval. Until then the newest month of a cube grain was divided by a reading it does
 * not hold: early in a month read every four days, the second reading made the month read
 * half its flats. So the divisor counts only the readings the grain's source holds.
 *
 * What the cube holds is read from what already answers: analytics_pivot over the cube by
 * market and month, and over the facts by market and day, for each market's newest month
 * (holdingSpecs). The cube is the facts at its last refresh, and readings arrive in day
 * order, so the cube holds a market's days in order for as long as its month total covers
 * at least HALF of each next day's rows (archiveHolding). Not all of them: the facts can
 * grow by a few rows without a refresh — a resync drained on a morning without one, a
 * refresh that failed (the cube was 26 rows behind on 2026-08-26) — and requiring every
 * row dropped the month's last reading while the cube held it: SK November, read on the
 * 2nd and the 6th with 26 rows resynced into the 2nd, read 15 000 for 7 500. Half a
 * reading's rows tell a reading the cube holds from one it does not; a retry of a few
 * projects or a late sibling moves neither. A day the facts do not hold either — its sync
 * failed — is held by neither. Older months are held by both.
 */

// analytics.dim_registry's cube dimensions (is_cube_dim), for when the registry has not
// been read — and for the assistant, which never reads it. Not kolaudacia: it has been
// answered from the facts since 2026-06-29 (2026-06-29_kolaudacia_serving.sql), and taken
// for a cube dimension, an archive answer by kolaudacia was divided by the cube's readings.
const CUBE_DIMS_FALLBACK = new Set(["country", "market", "city", "cast", "sub_district", "developer",
  "project_name", "import_status", "lifecycle", "typ", "etapa", "stav", "izby", "poschodie",
  "orientacia", "snapshot_month", "is_home", "has_price"]);

/** Whether analytics_pivot answers `spec` from the cube (its routing, step 1): no median,
 *  range or distinct, and every dim and filter key a cube dimension. `cubeDims` is the
 *  registry's (is_cube_dim); empty, the registry's seed. */
export function specUsesCube(spec, cubeDims) {
  if (!spec) return false;
  const cube = cubeDims && cubeDims.size ? cubeDims : CUBE_DIMS_FALLBACK;
  if (spec.median || (spec.ranges && Object.keys(spec.ranges).length) || (spec.distinct && spec.distinct.length)) return false;
  const keys = [...(spec.dims || []), ...Object.keys(spec.filters || {}),
    ...Object.keys(spec.filters_not || {}), ...Object.keys(spec.nulls || {})];
  return keys.every((k) => cube.has(k));
}

/** The two analytics_pivot questions that say what the cube and the facts hold, for each
 *  market's newest month in `days` (readingDaysByCountry), or null with no readings. */
export function holdingSpecs(days) {
  const from = new Map();
  const months = new Set();
  for (const [c, m] of Object.entries(days || {})) {
    let last = "";
    for (const d of m.keys()) if (d > last) last = d;
    if (!last) continue;
    months.add(last.slice(0, 7));
    from.set(c, `${last.slice(0, 7)}-01`);
  }
  if (!from.size) return null;
  const min = [...from.values()].sort()[0];
  return {
    from,
    cube: { dims: ["country", "snapshot_month"], mode: "archive", filters: { snapshot_month: [...months].sort() } },
    facts: { dims: ["country", "datum"], mode: "archive", ranges: { datum: { min, max: null, includeEmpty: false } } },
  };
}

/** From the answers to holdingSpecs: { from, facts: Map(market → Set(days with rows)),
 *  cubeThrough: Map('SK|2026-11' → the last day the cube holds whole, '' for none),
 *  cubePartial: Map('SK|2026-11' → { day, readings }) — the next day, of which the cube
 *  holds only some readings (a day read twice, the second approved after the refresh) —
 *  cubeExtra: Map('SK|2026-11' → readings) — readings the cube still holds that the facts
 *  no longer do (a withdrawal whose cube refresh failed) —
 *  cubeTotals: Map('SK|2026-11' → the cube's rows) }. `days` (readingDaysByCountry) says
 *  how many readings each day holds; a day not among them (a retry) is one.
 *
 *  A day's readings are counted against ONE reading's rows: the cube holds j of a day's k
 *  readings when its total covers the days before plus j readings' rows, less half of
 *  one — so a few rows of drift, a retry or a late sibling move nothing, and a day read
 *  twice whose second reading the cube lacks is seen as half held, not as held. */
export function archiveHolding(from, cubeRows, factRows, days) {
  const factsN = new Map();
  for (const g of factRows || []) {
    const c = g?.d?.[0];
    const day = g?.d?.[1] == null ? null : String(g.d[1]).slice(0, 10);
    const n = Number(g?.m?.n) || 0;
    if (!c || !day || !(n > 0)) continue;
    if (!factsN.has(c)) factsN.set(c, new Map());
    factsN.get(c).set(day, (factsN.get(c).get(day) || 0) + n);
  }
  const cubeTotals = new Map();
  for (const g of cubeRows || []) {
    const k = `${g?.d?.[0]}|${g?.d?.[1]}`;
    cubeTotals.set(k, (cubeTotals.get(k) || 0) + (Number(g?.m?.n) || 0));
  }
  const facts = new Map();
  const cubeThrough = new Map();
  const cubePartial = new Map();
  const cubeExtra = new Map();
  for (const [c, byDay] of factsN) {
    facts.set(c, new Set(byDay.keys()));
    const byMonth = new Map();
    for (const d of [...byDay.keys()].sort()) {
      const mo = d.slice(0, 7);
      if (!byMonth.has(mo)) byMonth.set(mo, []);
      byMonth.get(mo).push(d);
    }
    for (const [mo, ds] of byMonth) {
      const total = cubeTotals.get(`${c}|${mo}`) || 0;
      let acc = 0;
      let through = "";
      let one = 0;
      let oneFull = 0;
      let whole = true;
      for (const d of ds) {
        const rows = byDay.get(d);
        const k = days?.[c]?.get(d) || 1;
        one = rows / k;                                // one reading's rows
        // one FULL reading's rows — not a not-due morning's retry of a few projects, which
        // is often the month's last day of facts and no measure of a reading
        if (!days || days[c]?.has(d)) oneFull = one;
        const held = Math.max(0, Math.min(k, Math.floor((total - acc) / one + 0.5)));
        if (held < k) {
          if (held > 0) cubePartial.set(`${c}|${mo}`, { day: d, readings: held });
          whole = false;
          break;
        }
        acc += rows;
        through = d;
      }
      cubeThrough.set(`${c}|${mo}`, through);
      // The cube holding MORE than the facts by half a reading or more: a reading withdrawn
      // from the facts whose cube refresh failed (withdraw_snapshot carries on without it).
      // Its rows are still in the cube's answers, so they count in the cube's divisor —
      // or a cube grain read 15 000 for 7 500 until the next refresh — and it is a lag.
      if (whole && oneFull > 0) {
        const extra = Math.floor((total - acc) / oneFull + 0.5);
        if (extra > 0) cubeExtra.set(`${c}|${mo}`, extra);
      }
    }
  }
  return { from, facts, cubeThrough, cubePartial, cubeExtra, cubeTotals };
}

/** `days` (readingDaysByCountry) without the readings a grain's source does not hold yet:
 *  in each market's newest month, a day the facts have no rows of, and — `viaCube` — a day
 *  after the last the cube holds. With no holding (it could not be read), `days` as is. */
export function heldReadingDays(days, holding, viaCube) {
  if (!holding) return days;
  const out = {};
  for (const [c, m] of Object.entries(days || {})) {
    const from = holding.from.get(c);
    const kept = new Map();
    for (const [d, n] of m) {
      if (from && d >= from) {
        if (!holding.facts.get(c)?.has(d)) continue;
        if (viaCube) {
          const through = holding.cubeThrough.get(`${c}|${d.slice(0, 7)}`);
          if (!through || d > through) {
            const part = holding.cubePartial?.get(`${c}|${d.slice(0, 7)}`);
            if (part && part.day === d) kept.set(d, Math.min(n, part.readings));
            continue;
          }
        }
      }
      kept.set(d, n);
    }
    if (viaCube) {
      // readings the cube still holds and the facts no longer do count on the month's last
      // day the cube holds (a cube answer is by month; a day is asked of the facts)
      for (const [k, extra] of holding.cubeExtra || []) {
        const through = holding.cubeThrough.get(k);
        if (!k.startsWith(`${c}|`) || !through) continue;
        // on the month's last FULL reading the cube holds (`through` may be a retry's day)
        let at = "";
        for (const d of kept.keys()) if (d.slice(0, 7) === through.slice(0, 7) && d <= through && d > at) at = d;
        if (at) kept.set(at, kept.get(at) + extra);
      }
    }
    if (kept.size) out[c] = kept;
  }
  return out;
}

/** A holding's fingerprint, part of the readings' version: a cube refresh changes it. */
export function holdingSignature(holding) {
  if (!holding) return "-";
  const parts = [];
  for (const [k, t] of [...holding.cubeThrough].sort()) parts.push(`${k}:${t}`);
  for (const [k, p] of [...(holding.cubePartial || [])].sort()) parts.push(`${k}~${p.day}:${p.readings}`);
  for (const [k, n] of [...(holding.cubeExtra || [])].sort()) parts.push(`${k}+${n}`);
  // the cube's own totals: any refresh of it moves them, whatever the days it holds
  for (const [k, n] of [...(holding.cubeTotals || [])].sort()) parts.push(`${k}=${n}`);
  for (const [c, s] of [...holding.facts].sort()) parts.push(`${c}:${[...s].sort().pop() || ""}:${s.size}`);
  return parts.join(",");
}

/** The facts' side of a holding — which days of each market's newest month the facts
 *  hold — as a fingerprint: the archive's records (flats_archive, the facts) change with
 *  it, whatever the cube does. */
export function holdingFactsSignature(holding) {
  if (!holding) return "-";
  return [...holding.facts].sort().map(([c, s]) => `${c}:${[...s].sort().join(";")}`).join(",");
}

/** What divides the archive's records of one request, as a fingerprint: each market's
 *  full readings as the facts hold them (heldReadingDays, not via the cube) in the months
 *  the request covers. `country` is its market (null: every market); `months` the
 *  snapshot months it asks and `dates` the days (null: all) — by whole months, a month's
 *  records being divided by the readings of its days, which the Datum filter may take
 *  beyond the days fetched. A reading of another market or month, a not-due morning's
 *  retry (no full reading) and the cube leave it as it is. */
export function recordReadingsSignature(days, holding, { country = null, months = null, dates = null } = {}) {
  if (!days) return "";
  const held = heldReadingDays(days, holding, false);
  const inMonths = Array.isArray(months) && months.length ? new Set(months.map((m) => String(m).slice(0, 7))) : null;
  const ds = Array.isArray(dates) && dates.length ? dates.map((d) => String(d).slice(0, 10)).sort() : null;
  const lo = ds ? ds[0].slice(0, 7) : null;
  const hi = ds ? ds[ds.length - 1].slice(0, 7) : null;
  const parts = [];
  for (const c of Object.keys(held || {}).sort()) {
    if (country && c !== country) continue;
    const kept = [...held[c]].filter(([d]) => {
      const mo = d.slice(0, 7);
      return (!inMonths || inMonths.has(mo)) && (!lo || (mo >= lo && mo <= hi));
    }).map(([d, n]) => `${d}=${n}`).sort();
    if (kept.length) parts.push(`${c}:${kept.join(";")}`);
  }
  return parts.join(",");
}

/** Readings per market-month ({ 'SK|2026-10': 8 }) from readingDaysByCountry(). */
export function monthReadings(days) {
  const out = {};
  for (const [c, m] of Object.entries(days || {})) {
    for (const [d, n] of m) {
      const k = `${c}|${d.slice(0, 7)}`;
      out[k] = (out[k] || 0) + n;
    }
  }
  return out;
}

/** Σ value × weight and Σ weight over the records with a numeric value, each record
 *  weighing as weightedCount counts it — the record path's sum and average on the grain
 *  path's basis (s_* and n_* divided by the readings, averaged over the periods). */
export function weightedSum(recs, recordCell, valueOf) {
  const cells = recs.map(recordCell);
  const f = periodFactors(cells, (c) => c);
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < recs.length; i += 1) {
    const c = cells[i];
    if (!c) continue;
    const v = valueOf(recs[i]);
    if (v == null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const w = f[i] / c.r;
    sum += n * w;
    weight += w;
  }
  return { sum, weight };
}

/** Whether the cube lags: a reading of a market's newest month the facts hold and the
 *  cube does not yet. Such a lag lasts until the cube's refresh, minutes after the
 *  approval, so whoever keeps a holding asks again soon while this is true. */
export function holdingLags(days, holding) {
  if (!holding) return false;
  if (holding.cubeExtra && holding.cubeExtra.size) return true;   // the cube awaits a refresh
  for (const [c, m] of Object.entries(days || {})) {
    const from = holding.from.get(c);
    if (!from) continue;
    for (const d of m.keys()) {
      if (d < from || !holding.facts.get(c)?.has(d)) continue;
      const through = holding.cubeThrough.get(`${c}|${d.slice(0, 7)}`);
      if (!through || d > through) return true;     // a day the cube holds none or only some of
    }
  }
  return false;
}
