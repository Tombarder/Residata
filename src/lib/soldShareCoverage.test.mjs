// Every surface that shows a per-project average price says how much of the
// project is already sold (board decision 186771, Boss 2026-10-06; the rule and
// its reasons: ./soldShare.js). The average is over the flats still on offer,
// and developers remove the prices of the ones they sell — so a page that
// prints `avg_price_eur_m2` without the note reads a remainder as the project.
//
// The test is structural, like the one that keeps `latest_stav` behind
// listingStatus: a source file that reads `avg_price_eur_m2` must also use the
// sold-share helpers, unless it is listed below WITH THE REASON it never prints
// a project's own average. Adding an entry is a deliberate act, never a way to
// make the test pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));

const NEVER_PRINTS_A_PROJECTS_AVERAGE = {
  "App.jsx": "sample-page benchmark: averages the projects of a district and bands projects by their ratio to it — prints band rates, never a project's €/m²",
  "pages/HeroVariants.jsx": "hero map: sums project averages into DISTRICT means",
  "lib/mapMetrics.js": "map lens: colours a pin by its €/m²; the popup that prints the number is MapView.jsx, which carries the note",
  "lib/useData.js": "the column list it selects, not a display",
  "pages/Platform.jsx": "CSV export column lists; the file carries sold_units and total_units beside the average",
};

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "content" || name === "node_modules") continue;
      out.push(...sourceFiles(p));
    } else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\.mjs$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

test("every file that reads a project's average price carries the sold-share note", () => {
  const bare = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (rel.startsWith("lib/soldShare")) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes("avg_price_eur_m2")) continue;
    if (NEVER_PRINTS_A_PROJECTS_AVERAGE[rel]) continue;
    if (!/from ["']\.{1,2}\/(?:lib\/)?soldShare(?:Note)?(?:\.js)?["']/.test(src)) bare.push(rel);
  }
  assert.deepEqual(bare, [],
    `these files read avg_price_eur_m2 without the sold-share note: ${bare.join(", ")}. ` +
    "Show <SoldShareNote> beside the price (lib/soldShareNote.jsx), or list the file above " +
    "with the reason it never prints a project's own average.");
});

test("the exemption list cannot rot", () => {
  for (const rel of Object.keys(NEVER_PRINTS_A_PROJECTS_AVERAGE)) {
    const src = readFileSync(join(SRC, rel), "utf8");
    assert.ok(src.includes("avg_price_eur_m2"), `${rel} is exempted but no longer reads the average`);
  }
});
