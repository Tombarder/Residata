/**
 * Tests for the map filter engine (src/lib/mapFilters.js).
 *   node scripts/verify-map-filters.mjs   → exit 0 = all pass
 */
import { applyFilters, isComplete, describe, fieldOptions, FIELD_BY_KEY } from "../src/lib/mapFilters.js";

let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`  ${cond ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}${cond ? "" : "  " + extra}`); if (!cond) fail++; };
const ids = (rows) => rows.map((r) => r.id).sort().join(",");

const P = [
  { id: "a", city: "Bratislava", district: "Ružinov", developer: "YIT",    status: "active",   avg_price_eur_m2: 5000, min_price: 180000, total_units: 120, available_units: 40, sold_units: 60, reserved_units: 20, sold_percentage: 50, sold_last_month: 6, is_top20: true,  kolaudacia: "2027" },
  { id: "b", city: "Bratislava", district: "Petržalka", developer: "Corwin", status: "active",   avg_price_eur_m2: 3500, min_price: 120000, total_units: 300, available_units: 0,  sold_units: 280, reserved_units: 20, sold_percentage: 95, sold_last_month: 1, is_top20: false, kolaudacia: "Skolaudované" },
  { id: "c", city: "Brno",       district: "Střed",     developer: "",       status: "sold_out", avg_price_eur_m2: 0,    min_price: null,   total_units: 80,  available_units: 0,  sold_units: 80,  reserved_units: 0,  sold_percentage: 100, sold_last_month: 0, is_top20: false, kolaudacia: "" },
  { id: "d", city: "Bratislava", district: "Ružinov",   developer: "YIT",    status: "active",   avg_price_eur_m2: 7000, min_price: 350000, total_units: 50,  available_units: 30, sold_units: 5,  reserved_units: 0,  sold_percentage: 9,  sold_last_month: 2, is_top20: true,  kolaudacia: "2029" },
];
const run = (conds) => applyFilters(P, conds);

console.log("\n\x1b[1mMap-filter engine\x1b[0m\n");

// category include / exclude
ok("city is any of [Bratislava] → a,b,d", ids(run([{ field: "city", op: "in", value: ["Bratislava"] }])) === "a,b,d");
ok("developer is none of [YIT] → b,c", ids(run([{ field: "developer", op: "nin", value: ["YIT"] }])) === "b,c");
ok("district is any of [Ružinov, Petržalka] → a,b,d", ids(run([{ field: "district", op: "in", value: ["Ružinov", "Petržalka"] }])) === "a,b,d");

// has a value / is empty
ok("developer has a value → a,b,d (c empty)", ids(run([{ field: "developer", op: "set" }])) === "a,b,d");
ok("price is empty → c (0 → null)", ids(run([{ field: "ppm2", op: "empty" }])) === "c");
ok("price has a value → a,b,d", ids(run([{ field: "ppm2", op: "set" }])) === "a,b,d");

// number between / gte / lte
ok("price between 4000–6000 → a", ids(run([{ field: "ppm2", op: "between", value: [4000, 6000] }])) === "a");
ok("price between …–4000 (open lo) → b", ids(run([{ field: "ppm2", op: "between", value: ["", 4000] }])) === "b");
ok("total_units at least 100 → a,b", ids(run([{ field: "total_units", op: "gte", value: 100 }])) === "a,b");
ok("absorption at most 50 → a,d", ids(run([{ field: "sold_percentage", op: "lte", value: 50 }])) === "a,d");
ok("available at least 1 (has stock) → a,d", ids(run([{ field: "available_units", op: "gte", value: 1 }])) === "a,d");

// status (readable labels, raw value filtering)
ok("status is any of [active] → a,b,d", ids(run([{ field: "status", op: "in", value: ["active"] }])) === "a,b,d");

// completion (derived bucket, nowYear via mapMetrics default — test relative ops that don't depend on year)
ok("completion is empty/unknown → c", ids(run([{ field: "completion", op: "in", value: ["unknown"] }])) === "c");

// AND of several conditions — the real developer query
ok("Bratislava · YIT · price 4–8k · has stock → a,d",
  ids(run([
    { field: "city", op: "in", value: ["Bratislava"] },
    { field: "developer", op: "in", value: ["YIT"] },
    { field: "ppm2", op: "between", value: [4000, 8000] },
    { field: "available_units", op: "gte", value: 1 },
  ])) === "a,d");

// incomplete conditions are ignored (don't filter to nothing)
ok("empty 'in' value → no filtering (all 4)", run([{ field: "city", op: "in", value: [] }]).length === 4);
ok("isComplete: in [] → false", isComplete({ field: "city", op: "in", value: [] }) === false);
ok("isComplete: between [4000,''] → true", isComplete({ field: "ppm2", op: "between", value: [4000, ""] }) === true);
ok("isComplete: set → true (no value needed)", isComplete({ field: "developer", op: "set" }) === true);

// describe + options
ok("describe between", (() => { const d = describe({ field: "ppm2", op: "between", value: [4000, 6000] }); return d.startsWith("Price per m²") && /4.?000/.test(d) && /6.?000/.test(d) && d.includes("–"); })(), describe({ field: "ppm2", op: "between", value: [4000, 6000] }));
ok("fieldOptions city → [Bratislava, Brno]", fieldOptions(P, FIELD_BY_KEY.city).join(",") === "Bratislava,Brno");
ok("fieldOptions developer drops empty → [Corwin, YIT]", fieldOptions(P, FIELD_BY_KEY.developer).join(",") === "Corwin,YIT");

console.log(`\n${fail === 0 ? "\x1b[32mALL CHECKS PASSED\x1b[0m" : `\x1b[31m${fail} CHECK(S) FAILED\x1b[0m`}\n`);
process.exit(fail === 0 ? 0 : 1);
