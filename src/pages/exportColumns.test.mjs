/**
 * Tests for the flats export header — run with:
 *   node --test src/pages/exportColumns.test.mjs
 *
 * Zero-dependency (node:test + node:assert), reads Platform.jsx as text on
 * purpose: importing a React page would drag in the whole app.
 *
 * 🔴 WHY THIS FILE EXISTS
 *
 * The CSV and Excel exports are built SERVER-side by `public.export_units_csv`,
 * which emits one line of comma-separated values per flat and no header. The
 * header is a hand-kept list in Platform.jsx — a mirror of a column order that
 * lives in the database — and it has drifted TWICE:
 *
 *   2026-08-18  the four fit-out columns shipped server-side and were not named
 *               here, so `created_at` sat over the fit-out data and four columns
 *               went out unlabelled. (Fixed then; the comment is still in place.)
 *   2026-09-15  the same thing with the three payment schedules added after the
 *               fit-out block — fin_15_45_25_15, fin_15_85, fin_15_70_15. The
 *               server sent 56 fields, this list named 53. In the CSV that put
 *               `created_at` over a PRICE and left three columns unlabelled; in
 *               the Excel path, which maps header→cell BY INDEX, it dropped all
 *               three columns outright and formatted a payment schedule as a date.
 *
 * Both times the export "worked": a file downloaded, it opened, every row was
 * there. Only the names were wrong, which is the kind of error a customer acts
 * on rather than reports.
 *
 * `headersForServerRow` is the guard: it counts the fields the server actually
 * sent and refuses to build a file whose headers would not line up.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SRC = readFileSync(new URL("./Platform.jsx", import.meta.url), "utf8");

const COLUMNS = [...SRC.match(/const FLATS_CSV_COLUMNS = \[(.*?)\n\];/s)[1]
  .matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);

/** The 56 columns `public.export_units_csv` emits, in its concat_ws order.
 *  Read off the live function definition on 2026-09-15. */
const SERVER_ORDER = [
  "project_name", "developer", "district", "city", "project_id", "unit_id",
  "snapshot_month", "batch_id", "batch_timestamp", "typ", "etapa", "budova",
  "unit_detail", "poschodie", "izby", "obytna_plocha", "balkon_plocha",
  "loggia_plocha", "terasa_plocha", "zahrada_plocha", "exterier_plocha",
  "kobka_plocha", "celkova_plocha", "cena_bez_dph", "cena_s_dph",
  "cena_s_dph_text", "cennikova_cena", "stav", "kolaudacia", "orientacia",
  "country", "currency",
  "fin_10_90", "fin_20_80", "fin_30_40_30", "fin_10_40_40_10", "fin_70_30",
  "fin_30_50_20", "fin_95_5", "fin_90_10", "fin_80_20", "fin_60_40",
  "fin_50_50", "fin_40_60", "fin_30_70", "fin_5_95", "fin_20_50_30",
  "fin_5_15_80",
  "fitout_level", "cena_holobyt", "cena_standard", "cena_plne_zariadeny",
  "fin_15_45_25_15", "fin_15_85", "fin_15_70_15", "created_at",
];

test("the header names every column the server sends, in its order", () => {
  assert.deepEqual(COLUMNS, SERVER_ORDER);
});

test("the three schedules that were missing are named", () => {
  for (const col of ["fin_15_45_25_15", "fin_15_85", "fin_15_70_15"]) {
    assert.ok(COLUMNS.includes(col), `${col} is not in the export header`);
  }
});

test("all nineteen payment schedules are exported, each exactly once", () => {
  const fins = COLUMNS.filter((c) => c.startsWith("fin_"));
  assert.equal(fins.length, 19);
  assert.equal(new Set(fins).size, 19, "a schedule column is listed twice");
});

test("no column name is repeated", () => {
  assert.equal(new Set(COLUMNS).size, COLUMNS.length);
});

test("every payment-schedule column is treated as a number in Excel", () => {
  // The numeric set derives its fin_* half from the header, so a newly added
  // schedule cannot export as text again. Assert the derivation is still there.
  assert.match(SRC, /\.\.\.FLATS_CSV_COLUMNS\.filter\(\(c\) => c\.startsWith\("fin_"\)\)/);
});

test("both export paths ask the guard for their headers", () => {
  // CSV and Excel each build a file; neither may use the raw list directly,
  // because the raw list is the thing that drifts.
  const uses = [...SRC.matchAll(/headersForServerRow\(/g)].length;
  assert.ok(uses >= 3, `expected the guard to be defined and used twice, saw ${uses}`);
  assert.doesNotMatch(SRC, /\[FLATS_CSV_COLUMNS\.join\(","\), \.\.\.parts\]/,
    "an export path is still joining the raw column list");
});

test("the guard refuses a row it cannot label", () => {
  // Mirrors headersForServerRow's contract without importing the page.
  const body = SRC.match(/function headersForServerRow\(firstRow\) \{(.*?)\n\}/s)[1];
  assert.match(body, /fields === FLATS_CSV_COLUMNS\.length/);
  assert.match(body, /unknown_/, "extra server columns must still be exported");
  assert.match(body, /throw new Error/, "a short row must be refused, not shifted");
});
