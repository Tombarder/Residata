// Regression test for the draw-area geometry (mapMetrics): point-in-polygon,
// polyline distance, area, corridor buffer, and the polygon/corridor set membership.
// Run: node scripts/verify-map-geometry.mjs
import {
  pointInRing, distanceToPolylineKm, polylineLengthKm, polygonAreaKm2,
  corridorBufferRing, computePolygonSet, computeCorridorSet,
} from "../src/lib/mapMetrics.js";

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) { pass++; console.log(`\x1b[32mPASS\x1b[0m ${name}`); } else { fail++; console.log(`\x1b[31mFAIL\x1b[0m ${name}${got !== undefined ? "  got=" + JSON.stringify(got) : ""}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// A 1° square around (17,48) → (18,49).
const sq = [[17, 48], [18, 48], [18, 49], [17, 49], [17, 48]];
ok("point-in-ring: inside", pointInRing(17.5, 48.5, sq) === true);
ok("point-in-ring: outside", pointInRing(16.5, 48.5, sq) === false);
ok("point-in-ring: far outside", pointInRing(20, 60, sq) === false);
// Concave (L-shape) — a ray-caster must handle non-convex.
const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0]];
ok("point-in-ring: concave inside arm", pointInRing(0.5, 1.5, L) === true);
ok("point-in-ring: concave notch (outside)", pointInRing(1.5, 1.5, L) === false);

// Polyline distance: a point ON the line ≈ 0; a point ~1km away ≈ 1km.
const line = [[17.10, 48.15], [17.14, 48.15]]; // horizontal segment at lat 48.15
ok("polyline distance: on the line ≈ 0", near(distanceToPolylineKm(17.12, 48.15, line), 0, 0.05));
// 0.01° lat ≈ 1.106 km north of the line
ok("polyline distance: ~1.1km off", near(distanceToPolylineKm(17.12, 48.16, line), 1.106, 0.2), distanceToPolylineKm(17.12, 48.16, line));
ok("polyline length ~2.96km", near(polylineLengthKm(line), 2.96, 0.3), polylineLengthKm(line));

// Area of a 1km × 1km square (≈ 0.009°lat × ~0.0135°lng at 48°) ≈ 1 km².
const latRef = 48, dLat = 1 / 110.574, dLng = 1 / (111.32 * Math.cos((latRef * Math.PI) / 180));
const km2sq = [[17, 48], [17 + dLng, 48], [17 + dLng, 48 + dLat], [17, 48 + dLat], [17, 48]];
ok("polygon area ≈ 1 km²", near(polygonAreaKm2(km2sq), 1, 0.05), polygonAreaKm2(km2sq));

// Corridor buffer returns a closed ring with points.
const buf = corridorBufferRing(line, 0.4);
ok("corridor buffer is a closed ring", Array.isArray(buf) && buf.length > 3 && buf[0][0] === buf[buf.length - 1][0] && buf[0][1] === buf[buf.length - 1][1]);

// Set membership: 3 projects, one clearly inside the square, one outside.
const projects = [
  { id: "a", developer: "X", total_units: 10, available_units: 5, sold_units: 5, cena_s_dph: 1 },
  { id: "b", developer: "Y", total_units: 20, available_units: 10, sold_units: 10 },
  { id: "c", developer: "Z", total_units: 30, available_units: 30, sold_units: 0 },
];
const coords = { a: { lng: 17.5, lat: 48.5, verified: true }, b: { lng: 16.0, lat: 48.5, verified: true }, c: { lng: 17.6, lat: 48.51, verified: false } };
const ps = computePolygonSet(projects, coords, sq, false);
ok("polygonSet: 2 inside the square (a,c)", ps && ps.inside.length === 2 && ps.inside.map((p) => p.id).sort().join("") === "ac", ps && ps.inside.map((p) => p.id));
const psV = computePolygonSet(projects, coords, sq, true); // verifiedOnly drops c
ok("polygonSet: verifiedOnly drops placeholder c", psV && psV.inside.length === 1 && psV.inside[0].id === "a");
const cs = computeCorridorSet(projects, coords, [[17.4, 48.5], [17.7, 48.5]], 2, false);
ok("corridorSet: catches a & c near the route", cs && cs.inside.map((p) => p.id).sort().join("") === "ac", cs && cs.inside.map((p) => p.id));

console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
