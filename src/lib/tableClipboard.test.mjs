/**
 * Tests for tableClipboard — run with:  node --test src/lib/tableClipboard.test.mjs
 * Zero-dependency (node:test + node:assert).
 *
 * The bug these exist for: a Slovak Excel reads `1234.56` as text and splits on
 * `;`, not `,`. Every assertion below is about a value surviving the trip into a
 * spreadsheet cell as the thing it actually is.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  exportFormats, formatExportNumber, guardFormula, toTSV, toCSV, toHTMLTable,
} from "./tableClipboard.js";

/* ─────────────────────────── locale conventions ─────────────────────────── */

test("sk/cs use a comma decimal and a semicolon delimiter", () => {
  assert.deepEqual(exportFormats("sk"), { decimal: ",", delimiter: ";" });
  assert.deepEqual(exportFormats("cs"), { decimal: ",", delimiter: ";" });
});
test("en uses a dot decimal and a comma delimiter", () => {
  assert.deepEqual(exportFormats("en"), { decimal: ".", delimiter: "," });
});
test("an unknown language falls back to the dot/comma pair", () => {
  assert.deepEqual(exportFormats(undefined), { decimal: ".", delimiter: "," });
});

/* ──────────────────────────────── numbers ───────────────────────────────── */

test("no thousands separator — a space inside a number is what breaks the paste", () => {
  assert.equal(formatExportNumber(1234567, "sk"), "1234567");
  assert.equal(formatExportNumber(1234567, "en"), "1234567");
});
test("decimals follow the locale", () => {
  assert.equal(formatExportNumber(1234.56, "sk"), "1234,56");
  assert.equal(formatExportNumber(1234.56, "en"), "1234.56");
});
test("trailing zeros are dropped, not padded", () => {
  assert.equal(formatExportNumber(1200.0, "sk"), "1200");
  assert.equal(formatExportNumber(0.5, "sk"), "0,5");
});
test("rounds to two places by default and honours an override", () => {
  assert.equal(formatExportNumber(1.23456, "en"), "1.23");
  assert.equal(formatExportNumber(57.349, "en", 1), "57.3");
});
test("negatives and zero survive", () => {
  assert.equal(formatExportNumber(-42.5, "sk"), "-42,5");
  assert.equal(formatExportNumber(0, "en"), "0");
});
test("nothing is not zero — null/NaN/Infinity become an empty cell", () => {
  for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(formatExportNumber(v, "sk"), "");
  }
});

/* ───────────────────────── formula injection ────────────────────────────── */

test("a cell that would execute in Excel is neutralised", () => {
  assert.equal(guardFormula('=HYPERLINK("evil")'), '\'=HYPERLINK("evil")');
  assert.equal(guardFormula("+1+1"), "'+1+1");
  assert.equal(guardFormula("-cmd"), "'-cmd");
  assert.equal(guardFormula("@SUM(A1)"), "'@SUM(A1)");
});
test("an ordinary project name is left alone", () => {
  assert.equal(guardFormula("PARQ Zátišie"), "PARQ Zátišie");
  assert.equal(guardFormula("Slnečnice – Viladomy"), "Slnečnice – Viladomy");
});

/* ─────────────────────────────── TSV ────────────────────────────────────── */

const MATRIX = [
  ["Projekt", "Počet", "Priemer (€/m²)", "Podiel"],
  ["PARQ Zátišie", 148, 4210.5, { v: 57.3, pct: true }],
  ["Nulové ceny", 0, null, { v: 0, pct: true }],
];

test("TSV separates with tabs and CRLF, locale numbers inside", () => {
  assert.equal(
    toTSV(MATRIX, "sk"),
    "Projekt\tPočet\tPriemer (€/m²)\tPodiel\r\n" +
      "PARQ Zátišie\t148\t4210,5\t57,3 %\r\n" +
      "Nulové ceny\t0\t\t0 %"
  );
});
test("TSV never emits a tab or newline from inside a cell", () => {
  const out = toTSV([["a\tb", "c\nd"]], "en");
  assert.equal(out, "a b\tc d");
  assert.equal(out.split("\t").length, 2);
});
test("an empty cell stays empty rather than becoming 0", () => {
  assert.equal(toTSV([[null, undefined, "", 0]], "en"), "\t\t\t0");
});

/* ─────────────────────────────── CSV ────────────────────────────────────── */

test("CSV uses the locale's list separator", () => {
  assert.equal(toCSV([["a", "b", 1.5]], "sk"), "a;b;1,5");
  assert.equal(toCSV([["a", "b", 1.5]], "en"), "a,b,1.5");
});
test("a cell containing the delimiter is quoted", () => {
  assert.equal(toCSV([["Rimavská; Sobota", 1]], "sk"), '"Rimavská; Sobota";1');
  assert.equal(toCSV([["Bratislava, Ružinov", 1]], "en"), '"Bratislava, Ružinov",1');
});
test("a comma decimal does NOT drag quotes into an en export, and vice versa", () => {
  // 1,5 under sk is a number, and `,` is not the sk delimiter → no quotes needed.
  assert.equal(toCSV([[1.5]], "sk"), "1,5");
});
test("embedded quotes are doubled", () => {
  assert.equal(toCSV([['He said "hi"']], "en"), '"He said ""hi"""');
});

/* ─────────────────────────────── HTML ───────────────────────────────────── */

test("HTML gives a spreadsheet real cells", () => {
  const html = toHTMLTable([["A", "B"], ["x", 1]], "en");
  assert.match(html, /<table>/);
  assert.match(html, /<th[^>]*>A<\/th>/);
  assert.match(html, /<td[^>]*>1<\/td>/);
});
test("text cells are pinned as text so 01-02 does not become a date", () => {
  const html = toHTMLTable([["h"], ["01-02"]], "en");
  // Excel's "treat as text" token is mso-number-format:'\@' — one backslash.
  assert.match(html, /<td style="mso-number-format:'\\@';text-align:left">01-02<\/td>/);
});
test("numeric cells are right-aligned and NOT pinned as text", () => {
  const html = toHTMLTable([["h"], [1234.5]], "en");
  assert.match(html, /<td style="text-align:right">1234\.5<\/td>/);
});
test("a percentage keeps its sign so Excel reads it as a percentage", () => {
  assert.match(toHTMLTable([["h"], [{ v: 57.3, pct: true }]], "sk"), />57,3 %</);
});
test("HTML-significant characters in a scraped name are escaped", () => {
  assert.match(toHTMLTable([["h"], ["<b>&x</b>"]], "en"), /&lt;b&gt;&amp;x&lt;\/b&gt;/);
});
test("multi-row headers are honoured", () => {
  const html = toHTMLTable([["a"], ["b"], ["c"]], "en", { headerRows: 2 });
  assert.equal((html.match(/<th/g) || []).length, 2);
  assert.equal((html.match(/<td/g) || []).length, 1);
});
