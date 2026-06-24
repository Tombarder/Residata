/**
 * Tests for the developer-map logic (src/lib/mapMetrics.js), exercised against
 * the REAL kolaudácia formats + coordinate realities found in production.
 *   node scripts/verify-map-metrics.mjs   → exit 0 = all pass
 */
import {
  completionBucket, tertiles, colorFor, coverage, distanceKm,
  computeCompetitiveSet, legendForLens, metricValue, NO_DATA, RAMP, COMPLETION,
  valueRange, heatWeight, hasPublishedPrice,
} from "../src/lib/mapMetrics.js";

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  if (!ok) fail++;
};
const ok = (name, cond, detail = "") => { console.log(`  ${cond ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}${cond ? "" : `  ${detail}`}`); if (!cond) fail++; };

console.log("\n\x1b[1mMap-metrics verification\x1b[0m\n");

// ── completionBucket on the ACTUAL production values (nowYear pinned = 2026) ──
console.log("completionBucket (nowYear=2026)");
const NY = 2026;
const cases = [
  ["2027", "soon"], ["2026-08-31", "ready"], ["Q2 2027", "soon"], ["2Q 2027", "soon"],
  ["03.2028", "mid"], ["Q4/2028", "mid"], ["2028", "mid"], ["léto 2027", "soon"],
  ["Jar 2027", "soon"], ["Skolaudované", "ready"], ["2Q 2017", "ready"], ["12.2029", "far"],
  ["2027-09", "soon"], ["", "unknown"], ["Vo výstavbe", "unknown"], ["K nasťahovaniu", "ready"],
  ["Q2 2029", "far"], [null, "unknown"], ["pripravujeme", "unknown"],
];
for (const [val, want] of cases) eq(`"${val}" → ${want}`, completionBucket({ kolaudacia: val }, NY), want);

// ── tertiles ──
console.log("\ntertiles");
eq("[10,20,30,40,50,60] → [30,50]", tertiles([10, 20, 30, 40, 50, 60]), [30, 50]);
eq("<3 values → null", tertiles([5, 9]), null);
eq("ignores null/NaN", tertiles([1, null, 2, NaN, 3, 4]), [2, 3]);

// ── colorFor ──
console.log("\ncolorFor");
const TH = [3500, 5000];
eq("price 3000 (low) → blue", colorFor({ avg_price_eur_m2: 3000 }, "price", TH), RAMP[0]);
eq("price 4200 (mid) → amber", colorFor({ avg_price_eur_m2: 4200 }, "price", TH), RAMP[1]);
eq("price 6000 (high) → red", colorFor({ avg_price_eur_m2: 6000 }, "price", TH), RAMP[2]);
eq("price 0 (no data) → grey", colorFor({ avg_price_eur_m2: 0 }, "price", TH), NO_DATA);
eq("absorption null → grey", colorFor({ sold_percentage: null }, "absorption", [20, 60]), NO_DATA);
eq("completion 2027 → soon colour", colorFor({ kolaudacia: "2027" }, "completion", null), COMPLETION.soon.color);

// ── coverage ──
console.log("\ncoverage");
ok("price coverage 2/4 = 0.5", coverage([{ avg_price_eur_m2: 1 }, { avg_price_eur_m2: 0 }, { avg_price_eur_m2: 5 }, {}], "price") === 0.5);
ok("completion coverage 1/4 = 0.25", coverage([{ kolaudacia: "2027" }, {}, { kolaudacia: "" }, { kolaudacia: "tba" }], "completion") === 0.25);

// ── distanceKm ──
console.log("\ndistanceKm");
const d = distanceKm({ lat: 48.148, lng: 17.107 }, { lat: 48.157, lng: 17.107 }); // ~1km north
ok(`~1km apart → ${d.toFixed(2)}km`, d > 0.9 && d < 1.1, `got ${d}`);
ok("same point → 0", distanceKm({ lat: 48, lng: 17 }, { lat: 48, lng: 17 }) === 0);

// ── computeCompetitiveSet (incl. placeholder accounting + verifiedOnly) ──
console.log("\ncomputeCompetitiveSet");
const center = { lat: 48.15, lng: 17.11 };
const near = { lat: 48.151, lng: 17.111 };   // ~0.15 km
const far = { lat: 48.30, lng: 17.30 };      // ~25 km
const projects = [
  { id: "a", avg_price_eur_m2: 4000, total_units: 100, available_units: 40, sold_percentage: 30, developer: "YIT", kolaudacia: "2027" },
  { id: "b", avg_price_eur_m2: 5000, total_units: 50,  available_units: 10, sold_percentage: 70, developer: "YIT", kolaudacia: "Skolaudované" },
  { id: "c", avg_price_eur_m2: 6000, total_units: 80,  available_units: 0,  sold_percentage: 90, developer: "Corwin", kolaudacia: "" },
  { id: "x", avg_price_eur_m2: 9000, total_units: 999, available_units: 500, sold_percentage: 5, developer: "Far", kolaudacia: "2029" },
];
const coords = {
  a: { ...near, verified: true },
  b: { ...near, verified: false },  // placeholder (city centroid)
  c: { ...near, verified: true },
  x: { ...far, verified: true },
};
const cs = computeCompetitiveSet(projects, coords, center, 1.5);
ok("3 inside (a,b,c), x excluded", cs.inside.length === 3, `got ${cs.inside.map((p) => p.id)}`);
ok("placeholderCount = 1 (b)", cs.placeholderCount === 1, `got ${cs.placeholderCount}`);
eq("median €/m² of [4000,5000,6000] = 5000", cs.median, 5000);
eq("price range 4000–6000", [cs.priceLo, cs.priceHi], [4000, 6000]);
eq("total units 230", cs.totalUnits, 230);
eq("avail units 50", cs.availUnits, 50);
eq("avg absorption round((30+70+90)/3)=63", cs.avgAbs, 63);
ok("top dev = YIT with 2", cs.topDevs[0].dev === "YIT" && cs.topDevs[0].n === 2);
eq("completion buckets", cs.comp, { ready: 1, soon: 1, mid: 0, far: 0, unknown: 1 });
const csV = computeCompetitiveSet(projects, coords, center, 1.5, true); // verifiedOnly
ok("verifiedOnly drops placeholder b → 2 inside", csV.inside.length === 2 && csV.placeholderCount === 0);

// ── legendForLens ──
console.log("\nlegendForLens");
ok("price legend has 4 rows incl. no-data", legendForLens("price", [3500, 5000]).length === 4);
ok("completion legend has 5 rows", legendForLens("completion", null).length === 5);
ok("metricValue supply = available_units", metricValue({ available_units: 12 }, "supply") === 12);

// ── momentum lens + heatmap weight + percentiles (the "whoa" additions) ──
console.log("\nmomentum / heatmap / percentiles");
eq("momentum: 5 sold → 5", metricValue({ sold_last_month: 5 }, "momentum"), 5);
eq("momentum: 0 sold → null (grey, not a cool dot)", metricValue({ sold_last_month: 0 }, "momentum"), null);
const vr = valueRange([{ avg_price_eur_m2: 3000 }, { avg_price_eur_m2: 7000 }, {}], "price");
eq("valueRange price → {min:3000,max:7000}", vr, { min: 3000, max: 7000 });
ok("heatWeight: max price → ~1", Math.abs(heatWeight({ avg_price_eur_m2: 7000 }, "price", vr) - 1) < 1e-9);
ok("heatWeight: min price → small floor (>0)", heatWeight({ avg_price_eur_m2: 3000 }, "price", vr) > 0 && heatWeight({ avg_price_eur_m2: 3000 }, "price", vr) <= 0.05);
ok("heatWeight: no value → 0", heatWeight({ avg_price_eur_m2: 0 }, "price", vr) === 0);
ok("heatWeight: completion ready → 1", heatWeight({ kolaudacia: "Skolaudované" }, "completion") === 1);
{
  const center2 = { lat: 48.15, lng: 17.11 };
  const near2 = { lat: 48.151, lng: 17.111 };
  const ps = [2000, 4000, 6000, 8000].map((pr, i) => ({ id: "p" + i, avg_price_eur_m2: pr, sold_last_month: i, total_units: 10, available_units: 5 }));
  const cs2 = computeCompetitiveSet(ps, Object.fromEntries(ps.map((p) => [p.id, { ...near2, verified: true }])), center2, 2);
  eq("p25 of [2000,4000,6000,8000] = 2000", cs2.p25, 2000);
  eq("p75 of [2000,4000,6000,8000] = 6000", cs2.p75, 6000);
  eq("soldLastMonth sum 0+1+2+3 = 6", cs2.soldLastMonth, 6);
}

// ── hasPublishedPrice (the "No price" toggle predicate) ──
console.log("\nhasPublishedPrice");
ok("€/m² present → true", hasPublishedPrice({ avg_price_eur_m2: 5000 }) === true);
ok("min_price present → true", hasPublishedPrice({ min_price: 219000 }) === true);
ok("max_price present → true", hasPublishedPrice({ max_price: 400000 }) === true);
ok("nothing → false", hasPublishedPrice({}) === false);
ok("explicit zeros → false", hasPublishedPrice({ avg_price_eur_m2: 0, min_price: 0, max_price: 0 }) === false);

console.log(`\n${fail === 0 ? "\x1b[32mALL CHECKS PASSED\x1b[0m" : `\x1b[31m${fail} CHECK(S) FAILED\x1b[0m`}\n`);
process.exit(fail === 0 ? 0 : 1);
