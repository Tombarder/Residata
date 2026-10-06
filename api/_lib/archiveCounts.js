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
// over the months the answer spans. Prices are ratios of sums and need nothing.
//
// rows:      analytics_pivot rows { d: [dim values…], m: { n, avail, sold, res, s_cs,
//            n_cs, mn_cs, mx_cs, s_pw, s_lw } } over dims that include 'country' and
//            'snapshot_month'
// readings:  { 'SK|2026-09': 30, 'SK|2026-10': 8, … } — full readings per market-month
// groupKey:  the dimension the answer is grouped by (null for one overall group)
export function archiveGroups(rows, dims, groupKey, readings) {
  const at = (row, k) => row.d?.[dims.indexOf(k)];
  const groups = new Map();
  const months = new Set();
  for (const row of rows || []) {
    const country = at(row, "country");
    const month = at(row, "snapshot_month");
    const r = readings[`${country}|${month}`];
    if (!r) continue;                     // no full reading of that market that month
    months.add(month);
    const key = groupKey ? (at(row, groupKey) != null ? String(at(row, groupKey)) : "(none)") : "ALL";
    const m = row.m || {};
    const g = groups.get(key) || { n: 0, avail: 0, sold: 0, res: 0, s_cs: 0, n_cs: 0, s_pw: 0, s_lw: 0, mn_cs: null, mx_cs: null };
    g.n += (Number(m.n) || 0) / r;
    g.avail += (Number(m.avail) || 0) / r;
    g.sold += (Number(m.sold) || 0) / r;
    g.res += (Number(m.res) || 0) / r;
    g.s_cs += Number(m.s_cs) || 0;
    g.n_cs += Number(m.n_cs) || 0;
    g.s_pw += Number(m.s_pw) || 0;
    g.s_lw += Number(m.s_lw) || 0;
    if (m.mn_cs != null) g.mn_cs = g.mn_cs == null ? Number(m.mn_cs) : Math.min(g.mn_cs, Number(m.mn_cs));
    if (m.mx_cs != null) g.mx_cs = g.mx_cs == null ? Number(m.mx_cs) : Math.max(g.mx_cs, Number(m.mx_cs));
    groups.set(key, g);
  }
  const span = groupKey === "snapshot_month" ? 1 : Math.max(1, months.size);
  return [...groups.entries()].map(([group, g]) => ({
    group,
    units: Math.round(g.n / span),
    available: Math.round(g.avail / span),
    sold: Math.round(g.sold / span),
    reserved: Math.round(g.res / span),
    avg_price_eur: g.n_cs ? Math.round(g.s_cs / g.n_cs) : null,
    avg_eur_per_m2: g.s_lw ? Math.round(g.s_pw / g.s_lw) : null,
    min_price: g.mn_cs == null ? null : Math.round(g.mn_cs),
    max_price: g.mx_cs == null ? null : Math.round(g.mx_cs),
  }));
}

/** Full readings per market-month from public.archive_days rows { day, country }. */
export function readingsPerMonth(days) {
  const out = {};
  for (const r of days || []) {
    if (!r || !r.country || !r.day) continue;
    const k = `${r.country}|${String(r.day).slice(0, 7)}`;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
