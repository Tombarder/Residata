// Taking data out of Residata (CSV download, "copy for Excel") is Premium-only:
// the 7-day trial browses, it does not take files home (useCapabilities
// "export_data"). On 2026-10-06 that lock went onto Reports and stopped there —
// five other pages kept handing a trial user the files. This fails when any
// page or component builds a CSV or copies a table without the gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Pages that may export without the gate, each with the reason. */
const NOT_A_CUSTOMER_PAGE = {
  "pages/DataQA.jsx": "admin only — Platform renders it inside <AdminGate require=\"manage_data_qa\">",
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.jsx?$/.test(name) && !/\.test\./.test(name)) yield p;
  }
}

const exporters = [...files(SRC)]
  .map((p) => ({ rel: relative(SRC, p).split("\\").join("/"), src: readFileSync(p, "utf8") }))
  .filter(({ rel, src }) => rel !== "lib/tableClipboard.js"
    && (/text\/csv/.test(src) || /\bcopyTable\(/.test(src)));

test("every page that hands out data as a file or a copied table checks export_data", () => {
  assert.ok(exporters.length >= 8, `found only ${exporters.length} exporting files — the scan is broken`);
  const ungated = exporters
    .filter(({ rel }) => !NOT_A_CUSTOMER_PAGE[rel])
    .filter(({ src }) => !/<CsvGate[\s>]/.test(src) && !/can\("export_data"\)/.test(src))
    .map(({ rel }) => rel);
  assert.deepEqual(ungated, [], "wrap the download / copy control in <CsvGate> (src/components/CsvGate.jsx)");
});

test("each gated page gates every download button it has, not just one", () => {
  // A page with three CSV buttons and one <CsvGate> is the 2026-10-06 bug in miniature.
  for (const { rel, src } of exporters) {
    if (NOT_A_CUSTOMER_PAGE[rel] || /can\("export_data"\)/.test(src) && !/<CsvGate[\s>]/.test(src)) continue;
    const buttons = (src.match(/⬇[^<]{0,80}CSV|Kopírovať pre Excel/g) || []).length;
    const gates = (src.match(/<CsvGate[\s>]/g) || []).length;
    assert.ok(gates >= buttons, `${rel}: ${buttons} download/copy button(s), ${gates} <CsvGate>`);
  }
});

test("the gate lets only export_data through", () => {
  const gate = readFileSync(join(SRC, "components/CsvGate.jsx"), "utf8");
  assert.match(gate, /if \(can\("export_data"\)\) \{/);
  assert.match(gate, /disabled/);
});

test("every gate says what it hands out, so admin sees each download (2026-10-07)", () => {
  // admin -> a person's activity lists their downloads by `what`. A gate without it
  // records "unknown", and a page that records the download itself says selfTracked
  // so it is not counted twice.
  const unnamed = [];
  for (const p of files(SRC)) {
    const rel = relative(SRC, p).split("\\").join("/");
    for (const m of readFileSync(p, "utf8").matchAll(/<CsvGate\b[^>]*>/g)) {
      if (!/\bwhat="[a-z_]+"/.test(m[0]) && !/\bselfTracked\b/.test(m[0])) unnamed.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(unnamed, [], 'give the gate what="<data>" (or selfTracked when the page records the download)');
  const gate = readFileSync(join(SRC, "components/CsvGate.jsx"), "utf8");
  assert.match(gate, /track\(kind === "copy" \? "data_copied" : "csv_exported"/);
});
