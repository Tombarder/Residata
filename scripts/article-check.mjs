#!/usr/bin/env node
/**
 * article-check.mjs — the checks ONE analysis must pass before it is written
 * to the database or made public. The scraper repo's publishing command
 * (v2/scripts/publish_issue.py) runs it on every row it writes.
 *
 *     node scripts/article-check.mjs row.json                          # files in public/ — a draft
 *     node scripts/article-check.mjs row.json --site https://residata.eu   # files LIVE — before publishing
 *     … | node scripts/article-check.mjs -                             # the row on stdin
 *
 * WHY. The rules are the build's own (lib/articleSeo.js articleSeoChecks, run
 * by prerender.mjs on every published article), so the command that publishes
 * and the build that serves cannot disagree about what "ready" means. The build
 * can only WARN — by then the article is already public — so this is where a
 * missing chart or share card is refused: with --site, every file the article
 * shows must answer 200 from the live site, which is what catches charts that
 * were generated but never pushed.
 *
 * Prints one line per finding and the search title, and exits 1 on any error.
 * The row is a public.articles row, as drafts/to_cms.py prints it or the
 * database returns it. Node built-ins only.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toArticle } from "../src/lib/articleModel.js";
import { articleSeoChecks, seoTitle } from "../src/lib/articleSeo.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const file = args.find((a) => a === "-" || !a.startsWith("--"));
const at = args.indexOf("--site");
const site = at >= 0 ? String(args[at + 1] || "").replace(/\/$/, "") : null;
if (!file || (at >= 0 && !/^https?:\/\//.test(site))) {
  console.error("usage: node scripts/article-check.mjs <row.json | -> [--site https://residata.eu]");
  process.exit(2);
}

const article = toArticle(JSON.parse(readFileSync(file === "-" ? 0 : file, "utf8")));

// The build's rule (prerender.mjs distHas): a figure is a file ON the site,
// named by its path — a full address elsewhere counts as missing. Live, a file
// must also BE an image: the site answers a path it does not have with the
// app's own page, 200 text/html, so a status alone would pass a missing chart.
async function exists(src) {
  if (!src || !src.startsWith("/")) return false;
  const p = src.split("?")[0];
  if (!site) return existsSync(join(ROOT, "public", p));
  try {
    const r = await fetch(site + p, { method: "HEAD" });
    return r.status === 200 && /^image\//.test(r.headers.get("content-type") || "");
  } catch {
    return false;
  }
}

const missingFigures = [];
for (const b of article.blocks) {
  if (b?.type !== "figure") continue;
  for (const src of [b.src, b.srcM, b.srcEn]) if (src && !(await exists(src))) missingFigures.push(src);
}
const shareImageExists = article.ogImage ? await exists(article.ogImage) : undefined;
const checks = articleSeoChecks(article, { shareImageExists, missingFigures });

for (const c of checks) console.log(`${c.level.padEnd(5)} ${c.code} — ${c.sk}`);
console.log(`title ${seoTitle(article)}`);
process.exit(checks.some((c) => c.level === "error") ? 1 : 0);
