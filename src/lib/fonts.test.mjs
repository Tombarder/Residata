/**
 * The site's typefaces are self-hosted (src/styles/fonts.css). Loading them from
 * Google sent every visitor's IP address to Google on every page view — held
 * unlawful without consent in the EU (LG München I, 3 O 17493/20) — and started
 * the download only after the app had run, so text reflowed when they arrived.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("nothing the site ships loads a font from Google", () => {
  const files = [join(ROOT, "index.html"), ...walk(join(ROOT, "src")).filter((f) => /\.(jsx?|mjs|css|html)$/.test(f) && !f.endsWith(".test.mjs"))];
  const offenders = files.filter((f) => /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => f.slice(ROOT.length + 1)), []);
});

test("every font file the stylesheet and the page head name exists", () => {
  const css = readFileSync(join(ROOT, "src", "styles", "fonts.css"), "utf8");
  const used = [...css.matchAll(/url\('(\/fonts\/[^']+)'\)/g)].map((m) => m[1]);
  assert.equal(used.length, 4, `expected 4 @font-face files, found ${used.length}`);
  for (const f of used) assert.ok(existsSync(join(ROOT, "public", f)), `${f} is not in public/`);
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const preloaded = [...html.matchAll(/<link rel="preload" href="(\/fonts\/[^"]+)" as="font"/g)].map((m) => m[1]);
  assert.deepEqual(preloaded.sort(), used.slice().sort(), "index.html must preload exactly the files fonts.css uses");
  const index = readFileSync(join(ROOT, "src", "index.css"), "utf8");
  assert.ok(index.includes('@import "./styles/fonts.css";'), "index.css no longer imports fonts.css");
});
