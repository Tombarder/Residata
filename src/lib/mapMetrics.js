/**
 * mapMetrics — pure, testable logic behind the developer map (Mapa 2).
 *
 * Extracted from MapView2 so it can be unit-tested without React/MapLibre and
 * reused if the developer map graduates to replace the live map. Everything
 * here is a pure function of project rows + coordinates.
 *
 * Data realities this module is built around (measured 2026-06-23 over live
 * projects_live + project_coords):
 *   · ~41% of projects have PLACEHOLDER coords (city centroid, location_verified
 *     = false) — so a radius set must report how many of its members are only
 *     approximately located, or it misleads.
 *   · completion (kolaudácia) is known for only ~13% of projects, in messy
 *     formats ("Q2 2027", "2Q 2017", "léto 2027", "03.2028", "Skolaudované").
 *   · price / absorption / developer are partial — "no data" must be first-class.
 */

export const LENSES = [
  { key: "price",      label: "Price €/m²",  unit: "€/m²", desc: "Average asking price per m² — where the market runs rich vs soft." },
  { key: "supply",     label: "Supply",      unit: "u",    desc: "Units still available — where competing inventory is concentrated." },
  { key: "absorption", label: "Absorption",  unit: "%",    desc: "Share already sold/reserved — what's clearing fast vs sitting." },
  { key: "momentum",   label: "Sold / mo",   unit: "u",    desc: "Units sold in the last month — where demand is actually moving." },
  { key: "completion", label: "Completion",  unit: "",     desc: "When competing supply hands over (sparse data — many unknown)." },
];

export const RAMP = ["#3aa0ff", "#f5a623", "#ff5d5d"]; // low blue · mid amber · high red
export const NO_DATA = "#5b5b66";

export const COMPLETION = {
  ready:   { color: "#00e5a0", label: "ready / done", short: "ready" },
  soon:    { color: "#3aa0ff", label: "next year",    short: "+1y" },
  mid:     { color: "#f5a623", label: "in 2 years",   short: "+2y" },
  far:     { color: "#ff5d5d", label: "later",        short: "later" },
  unknown: { color: NO_DATA,   label: "unknown",      short: "?" },
};
export const COMPLETION_ORDER = ["ready", "soon", "mid", "far", "unknown"];

export const ppm2Of = (p) => Math.round(Number(p.avg_price_eur_m2) || 0);

/** Raw metric value for the active lens. null = no data (rendered grey). */
export function metricValue(p, lens) {
  if (lens === "price")      { const v = ppm2Of(p); return v > 0 ? v : null; }
  if (lens === "supply")     { return Number(p.available_units) || 0; }
  if (lens === "absorption") { return p.sold_percentage == null ? null : Number(p.sold_percentage); }
  if (lens === "momentum")   { const v = Number(p.sold_last_month) || 0; return v > 0 ? v : null; }
  return null; // completion is categorical, not a scalar
}

/** Min/max of the lens metric across projects (for normalising heatmap weight). */
export function valueRange(projects, lens) {
  let min = Infinity, max = -Infinity;
  for (const p of projects) { const v = metricValue(p, lens); if (v != null && Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } }
  return Number.isFinite(min) ? { min, max } : null;
}

const COMPLETION_HEAT = { ready: 1, soon: 0.7, mid: 0.4, far: 0.2, unknown: 0 };

/** 0..1 weight for the heatmap: how "hot" a project is on the active lens. */
export function heatWeight(p, lens, range) {
  if (lens === "completion") return COMPLETION_HEAT[completionBucket(p)] ?? 0;
  const v = metricValue(p, lens);
  if (v == null) return 0;
  if (!range || range.max <= range.min) return 0.5;
  return Math.max(0.04, Math.min(1, (v - range.min) / (range.max - range.min)));
}

/** Bucket a free-text kolaudácia value into a completion category. */
export function completionBucket(p, nowYear = new Date().getFullYear()) {
  const k = (p.kolaudacia || "").toString().toLowerCase().trim();
  if (!k) return "unknown";
  if (/skolaud|hotov|dokon|nas[ťt]ah|ready|complet|move/.test(k)) return "ready";
  const m = k.match(/(20\d{2})/);
  if (m) {
    const y = +m[1];
    if (y <= nowYear) return "ready";
    if (y === nowYear + 1) return "soon";
    if (y === nowYear + 2) return "mid";
    return "far";
  }
  return "unknown";
}

/** 33rd / 66th percentile breakpoints over the finite values; null if < 3. */
export function tertiles(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 3) return null;
  // q*n (not q*(n-1)) so the three colour tiers split into even thirds.
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  return [at(1 / 3), at(2 / 3)];
}

/** Colour for a project under the active lens. */
export function colorFor(p, lens, thresholds) {
  if (lens === "completion") return COMPLETION[completionBucket(p)].color;
  const v = metricValue(p, lens);
  if (v == null) return NO_DATA;
  if (!thresholds) return RAMP[1];
  return v < thresholds[0] ? RAMP[0] : v < thresholds[1] ? RAMP[1] : RAMP[2];
}

/** Fraction of projects that actually carry a value for the lens (0..1). */
export function coverage(projects, lens) {
  if (!projects.length) return 0;
  const has = projects.filter((p) =>
    lens === "completion" ? completionBucket(p) !== "unknown" : metricValue(p, lens) != null
  ).length;
  return has / projects.length;
}

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Approximate circle as a GeoJSON polygon (good enough at city scale). */
export function circlePolygon(center, radiusKm, steps = 72) {
  const latR = (center.lat * Math.PI) / 180;
  const dLat = radiusKm / 110.574;
  const dLng = radiusKm / (111.32 * Math.cos(latR));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([center.lng + dLng * Math.cos(t), center.lat + dLat * Math.sin(t)]);
  }
  return { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} }] };
}

const median = (sortedNums) => (sortedNums.length ? sortedNums[Math.floor((sortedNums.length - 1) / 2)] : null);

/**
 * Summarise the competitive set within `radiusKm` of `center`.
 * `coords` is { id -> {lat,lng,verified} }. `verifiedOnly` excludes projects
 * whose coordinates are placeholders (city centroid) so the radius is honest.
 */
export function computeCompetitiveSet(projects, coords, center, radiusKm, verifiedOnly = false) {
  if (!center || !coords) return null;
  const inside = projects.filter((p) => {
    const c = coords[p.id];
    if (!c) return false;
    if (verifiedOnly && !c.verified) return false;
    return distanceKm(center, c) <= radiusKm;
  });
  const placeholderCount = inside.filter((p) => coords[p.id] && !coords[p.id].verified).length;
  const priced = inside.map(ppm2Of).filter((v) => v > 0).sort((a, b) => a - b);
  const pAt = (q) => (priced.length ? priced[Math.min(priced.length - 1, Math.floor(q * (priced.length - 1)))] : null);
  const soldLastMonth = inside.reduce((s, p) => s + (Number(p.sold_last_month) || 0), 0);
  const totalUnits = inside.reduce((s, p) => s + (Number(p.total_units) || 0), 0);
  const availUnits = inside.reduce((s, p) => s + (Number(p.available_units) || 0), 0);
  const absVals = inside.map((p) => p.sold_percentage).filter((v) => v != null).map(Number);
  const avgAbs = absVals.length ? Math.round(absVals.reduce((a, b) => a + b, 0) / absVals.length) : null;
  const comp = { ready: 0, soon: 0, mid: 0, far: 0, unknown: 0 };
  inside.forEach((p) => { comp[completionBucket(p)]++; });
  const byDev = {};
  inside.forEach((p) => { const d = (p.developer || "").trim() || "—"; (byDev[d] = byDev[d] || []).push(p); });
  const topDevs = Object.entries(byDev)
    .map(([dev, ps]) => {
      const v = ps.map(ppm2Of).filter((x) => x > 0);
      return { dev, n: ps.length, ppm2: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null };
    })
    .sort((a, b) => b.n - a.n).slice(0, 5);
  return {
    inside, placeholderCount,
    median: median(priced),
    p25: pAt(0.25), p75: pAt(0.75),
    priceLo: priced.length ? priced[0] : null,
    priceHi: priced.length ? priced[priced.length - 1] : null,
    totalUnits, availUnits, avgAbs, soldLastMonth, comp, topDevs,
  };
}

/** Legend rows for the active lens (colour + label). */
export function legendForLens(lens, thresholds, fmt = (n) => String(Math.round(n))) {
  if (lens === "completion") {
    return COMPLETION_ORDER.map((k) => ({ color: COMPLETION[k].color, label: COMPLETION[k].label }));
  }
  const unit = LENSES.find((l) => l.key === lens)?.unit || "";
  if (!thresholds) return [{ color: RAMP[1], label: unit || lens }, { color: NO_DATA, label: "no data" }];
  const [t1, t2] = thresholds;
  return [
    { color: RAMP[0], label: `< ${fmt(t1)}${unit}` },
    { color: RAMP[1], label: `${fmt(t1)}–${fmt(t2)}` },
    { color: RAMP[2], label: `≥ ${fmt(t2)}${unit}` },
    { color: NO_DATA, label: "no data" },
  ];
}
