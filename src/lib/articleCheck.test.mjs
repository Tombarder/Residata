/**
 * scripts/article-check.mjs — the gate the scraper repo's publish_issue.py runs
 * before it writes or publishes an analysis. It must pass a complete row and
 * refuse a broken one; a gate nobody has seen refuse is not a gate.
 *
 * Local mode only (files in public/): the --site mode reads residata.eu, and a
 * unit test must not depend on the network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = mkdtempSync(join(tmpdir(), "article-check-"));

// A row as drafts/to_cms.py prints it, pointing at files that are committed.
const ROW = {
  slug: "ke-prehlad-2026-q3",
  article_date: "2026-09-27",
  published: false,
  title: { sk: "Košice: trh nových bytov v 3. štvrťroku 2026", en: "Košice: trh nových bytov v 3. štvrťroku 2026" },
  perex: { sk: "Prehľad trhu s novými bytmi v Košiciach za 3. štvrťrok 2026: ponuka, dopyt a ceny podľa veľkosti bytu.", en: "x" },
  method: { sk: "Údaje pochádzajú z verejne zverejnených cenníkov developerov, ktoré Residata číta denne.", en: "x" },
  og_image: "/analyzy/og-ke-prehlad-2026-q3.png",
  seo_title: { sk: "Novostavby Košice Q3/2026: ceny, ponuka a predaj", en: "Novostavby Košice Q3/2026: ceny, ponuka a predaj" },
  blocks: [{
    type: "figure",
    src: "/analyzy/ke-prehlad-2026-q3-podiel-ponuka.svg",
    srcM: "/analyzy/ke-prehlad-2026-q3-podiel-ponuka-m.svg",
    alt: { sk: "Graf", en: "Chart" }, caption: { sk: "Graf", en: "Chart" },
  }],
};

function check(row) {
  const f = join(DIR, `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify(row));
  const r = spawnSync(process.execPath, ["scripts/article-check.mjs", f], { cwd: ROOT, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("a complete row whose files are in the repo passes, and prints its search title", () => {
  const { code, out } = check(ROW);
  assert.equal(code, 0, out);
  assert.match(out, /title Novostavby Košice Q3\/2026: ceny, ponuka a predaj/);
});

test("a chart that is not on the site is refused", () => {
  const row = structuredClone(ROW);
  row.blocks[0].src = "/analyzy/never-generated-chart.svg";
  const { code, out } = check(row);
  assert.equal(code, 1);
  assert.match(out, /figure-missing — Graf \/analyzy\/never-generated-chart\.svg/);
});

test("a chart named by a full address elsewhere is refused, as the build refuses it", () => {
  const row = structuredClone(ROW);
  row.blocks[0].srcM = "https://example.com/chart.svg";
  const { code, out } = check(row);
  assert.equal(code, 1);
  assert.match(out, /figure-missing/);
});

test("a missing share card and a missing perex are refused", () => {
  const { code, out } = check({ ...ROW, og_image: "/analyzy/og-never.png", perex: { sk: "", en: "" } });
  assert.equal(code, 1);
  assert.match(out, /og-image-missing/);
  assert.match(out, /no-perex/);
});

test("bad usage is an error of its own, never a pass", () => {
  const r = spawnSync(process.execPath, ["scripts/article-check.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 2);
});
