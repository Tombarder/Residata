/**
 * Krajina reads the same on both of the Pivot's paths — run with:
 *   node --test src/pages/pivotCountryLabels.test.mjs
 *
 * 🔴 WHY (2026-09-29)
 *
 * The Pivot answers a layout two ways: the server engine (analytics_pivot) for most,
 * the browser's own records for medians, distinct counts and drill-downs. For the
 * country dimension the two disagreed on the VALUE itself. The engine returns the stored
 * code — analytics.dim_registry maps `country` to f.country_code, SK / CZ — while the
 * browser's accessor turned the code into a name, "Slovensko" / "Česko". So:
 *
 *   · a Krajina row read SK on the server path and Slovensko once the layout fell back to
 *     the records (adding a median does that);
 *   · a Krajina filter takes its options from the server (usePivotDistinct), so it holds
 *     "SK" — and on the record path passesFilter() compared "SK" with "Slovensko": nothing
 *     passed, and a drill-down or a median under that filter came back EMPTY.
 *
 * They had agreed until 2026-06-17 only because the retired pivot_grain turned the code
 * into the name on the server. The fix keeps the stored code as the value on every path
 * and adds the name at display time only, in dimValueLabel — where a status code already
 * becomes "Voľný".
 *
 * The page is React, so importing it would drag in the app (same read-the-source approach
 * as pivotFields.test.mjs). But these tests do not merely match text: they compile the
 * page's own accessor and passesFilter out of the source and RUN them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PivotV2.jsx"), "utf8");

/** The source of a top-level `function name(` … up to its closing brace at column 0. */
function fnSource(name) {
  const i = SRC.indexOf(`\nfunction ${name}(`);
  assert.ok(i >= 0, `${name} not found in PivotV2.jsx`);
  const j = SRC.indexOf("\n}\n", i);
  return SRC.slice(i + 1, j + 2);
}

/** The palette accessor of one field, compiled from the page's own source. */
function accessor(key) {
  const line = SRC.split("\n").find((l) => new RegExp(`^  ${key}:\\s+\\{`).test(l));
  assert.ok(line, `no palette entry for ${key}`);
  const m = line.match(/accessor:\s*(\(r\)\s*=>.*?)\s*\},?\s*$/);
  assert.ok(m, `could not read the accessor of ${key}`);
  return new Function(`return (${m[1]});`)();
}

/** The page's own passesFilter, runnable, over a palette holding just `fields`. */
function passesFilterWith(fields) {
  const sentinel = SRC.match(/const EMPTY_SENTINEL = ("[^"]*");/);
  assert.ok(sentinel, "EMPTY_SENTINEL not found");
  const factory = new Function("FIELDS",
    `const EMPTY_SENTINEL = ${sentinel[1]};\n${fnSource("isFilterActive")}\n` +
    `${fnSource("passesFilter")}\nreturn passesFilter;`);
  return factory(fields);
}

/** What analytics_pivot returns for the country dimension: the stored code. */
const SERVER_VALUES = ["SK", "CZ"];

test("the record path gives Krajina the stored code — the value the server grain returns", () => {
  const country = accessor("country");
  for (const code of SERVER_VALUES) assert.equal(country({ country: code }), code);
  assert.equal(country({ country: null }), null);
  assert.equal(country({}), null);
});

test("a Krajina filter chosen from the server's values keeps its flats on the record path", () => {
  // The drill-down / median case: the filter holds "SK" (from usePivotDistinct) and the
  // browser filters its own records with it.
  const passesFilter = passesFilterWith({ country: { type: "text", accessor: accessor("country") } });
  const onlySlovakia = { key: "country", mode: "in", values: ["SK"] };
  assert.equal(passesFilter({ country: "SK" }, onlySlovakia), true,
    "a Slovak flat must pass a Krajina = SK filter on the record path — this returned false " +
    "while the accessor answered 'Slovensko', and every drill-down under it came back empty");
  assert.equal(passesFilter({ country: "CZ" }, onlySlovakia), false);
  assert.equal(passesFilter({ country: "CZ" }, { key: "country", mode: "not_in", values: ["SK"] }), true);
});

test("the readable name is added at display time only, beside the status label", () => {
  const label = fnSource("dimValueLabel");
  assert.match(label, /fieldKey === "country"\) return countryName\(value,/,
    "dimValueLabel must turn SK/CZ into Slovensko/Česko — the table would print bare codes");
  assert.match(SRC, /import \{[^}]*\bcountryName\b[^}]*\} from "\.\.\/lib\/useCountry"/);
  const entry = SRC.split("\n").find((l) => /^  country:\s+\{/.test(l));
  assert.doesNotMatch(entry, /Slovensko|Česko/,
    "the palette entry must not turn the code into a name — that is display, not value");
});
