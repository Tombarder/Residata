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

/** Did the developer publish any price for this project (€/m², min or max)? */
export function hasPublishedPrice(p) {
  return ppm2Of(p) > 0 || Number(p.min_price) > 0 || Number(p.max_price) > 0;
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

// ── Canonical statistics ──────────────────────────────────────────────────
// One definition each for median / percentile / set-absorption, shared by the
// map header (MapView2) and the competitive-set panel so the same area never
// reports two different medians or two different "absorbed %". These match the
// analytics engine (PivotV2: median averages the two middles for even N).

/** Standard median — averages the two middle values for even N. Accepts an
 *  unsorted array; null if empty. */
export function median(nums) {
  const s = (nums || []).filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Linear-interpolation percentile (type-7 / Excel PERCENTILE.INC) over an
 *  already-ascending finite array. q in [0,1]; null if empty. */
export function percentile(sortedAsc, q) {
  const n = sortedAsc ? sortedAsc.length : 0;
  if (!n) return null;
  if (n === 1) return sortedAsc[0];
  const idx = q * (n - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** Unit-weighted absorption for a SET of projects: Σ sold / Σ(available +
 *  reserved + prereserved + sold), as a rounded %. The single definition used
 *  by both the market header and the competitive-set panel. null if the set has
 *  no in-offer inventory counts. */
export function setAbsorptionPct(projects) {
  let sold = 0, denom = 0;
  for (const p of projects || []) {
    const s = Number(p.sold_units) || 0;
    const a = Number(p.available_units) || 0;
    const r = (Number(p.reserved_units) || 0) + (Number(p.prereserved_units) || 0);
    sold += s; denom += s + a + r;
  }
  return denom > 0 ? Math.round((sold / denom) * 100) : null;
}

/**
 * Summarise the competitive set within `radiusKm` of `center`.
 * `coords` is { id -> {lat,lng,verified} }. `verifiedOnly` excludes projects
 * whose coordinates are placeholders (city centroid) so the radius is honest.
 */
/** Ray-casting point-in-polygon. `ring` = [[lng,lat], …] (closed or open). */
export function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Aggregate a set of projects into the competitive-panel shape. Shared by the
 *  radius (computeCompetitiveSet) and polygon (computePolygonSet) selections so an
 *  area never reports two different medians / absorption figures. */
function summarizeSet(inside, coords) {
  const placeholderCount = inside.filter((p) => coords[p.id] && !coords[p.id].verified).length;
  const priced = inside.map(ppm2Of).filter((v) => v > 0).sort((a, b) => a - b);
  const soldLastMonth = inside.reduce((s, p) => s + (Number(p.sold_last_month) || 0), 0);
  const totalUnits = inside.reduce((s, p) => s + (Number(p.total_units) || 0), 0);
  const availUnits = inside.reduce((s, p) => s + (Number(p.available_units) || 0), 0);
  const avgAbs = setAbsorptionPct(inside); // unit-weighted, identical to the header
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
    p25: percentile(priced, 0.25), p75: percentile(priced, 0.75),
    priceLo: priced.length ? priced[0] : null,
    priceHi: priced.length ? priced[priced.length - 1] : null,
    totalUnits, availUnits, avgAbs, soldLastMonth, comp, topDevs,
  };
}

/** Summarise the competitive set within `radiusKm` of `center`. verifiedOnly
 *  excludes placeholder (city-centroid) coords so the radius stays honest. */
export function computeCompetitiveSet(projects, coords, center, radiusKm, verifiedOnly = false) {
  if (!center || !coords) return null;
  const inside = projects.filter((p) => {
    const c = coords[p.id];
    if (!c) return false;
    if (verifiedOnly && !c.verified) return false;
    return distanceKm(center, c) <= radiusKm;
  });
  return summarizeSet(inside, coords);
}

/** Summarise the competitive set inside a hand-drawn polygon `ring` ([[lng,lat],…]).
 *  Same shape + stats as computeCompetitiveSet — just a polygon membership test. */
export function computePolygonSet(projects, coords, ring, verifiedOnly = false) {
  if (!ring || ring.length < 3 || !coords) return null;
  const inside = projects.filter((p) => {
    const c = coords[p.id];
    if (!c) return false;
    if (verifiedOnly && !c.verified) return false;
    return pointInRing(c.lng, c.lat, ring);
  });
  return summarizeSet(inside, coords);
}

// ── Corridor (draw a route + a width) ─────────────────────────────────────────
// Local equirectangular scale factors at a reference latitude (km per degree).
const _kx = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);
const _ky = 110.574;
const _meanLat = (line) => line.reduce((s, p) => s + p[1], 0) / line.length;

/** Min distance (km) from a point to a polyline. */
export function distanceToPolylineKm(lng, lat, line) {
  if (!line || !line.length) return Infinity;
  if (line.length === 1) return distanceKm({ lng, lat }, { lng: line[0][0], lat: line[0][1] });
  const kx = _kx(lat), px = lng * kx, py = lat * _ky;
  let min = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = line[i - 1][0] * kx, ay = line[i - 1][1] * _ky, bx = line[i][0] * kx, by = line[i][1] * _ky;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    min = Math.min(min, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return min;
}

/** Total length (km) of a polyline. */
export function polylineLengthKm(line) {
  let d = 0;
  for (let i = 1; i < (line || []).length; i++) d += distanceKm({ lng: line[i - 1][0], lat: line[i - 1][1] }, { lng: line[i][0], lat: line[i][1] });
  return d;
}

/** Summarise the set inside a corridor: within `widthKm` of the drawn route. */
export function computeCorridorSet(projects, coords, line, widthKm, verifiedOnly = false) {
  if (!line || line.length < 2 || !coords) return null;
  const inside = projects.filter((p) => {
    const c = coords[p.id];
    if (!c) return false;
    if (verifiedOnly && !c.verified) return false;
    return distanceToPolylineKm(c.lng, c.lat, line) <= widthKm;
  });
  return summarizeSet(inside, coords);
}

/** Shoelace area (km²) of a lng/lat ring (cos-lat corrected). */
export function polygonAreaKm2(ring) {
  if (!ring || ring.length < 3) return 0;
  const kx = _kx(_meanLat(ring));
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * kx) * (ring[i][1] * _ky) - (ring[i][0] * kx) * (ring[j][1] * _ky);
  }
  return Math.abs(a) / 2;
}

/** Approximate buffer polygon around a polyline — VISUAL only (membership uses the
 *  exact distance test). Offsets each side by widthKm in a local metric frame. */
export function corridorBufferRing(line, widthKm) {
  if (!line || line.length < 2) return null;
  const kx = _kx(_meanLat(line));
  const M = line.map((p) => [p[0] * kx, p[1] * _ky]);
  const left = [], right = [];
  for (let i = 0; i < M.length; i++) {
    const prev = M[Math.max(0, i - 1)], next = M[Math.min(M.length - 1, i + 1)];
    let vx = next[0] - prev[0], vy = next[1] - prev[1];
    const len = Math.hypot(vx, vy) || 1; vx /= len; vy /= len;
    const nx = -vy * widthKm, ny = vx * widthKm; // perpendicular × width (km)
    left.push([M[i][0] + nx, M[i][1] + ny]);
    right.push([M[i][0] - nx, M[i][1] - ny]);
  }
  const ring = [...left, ...right.reverse()];
  ring.push(ring[0]);
  return ring.map((m) => [m[0] / kx, m[1] / _ky]);
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
