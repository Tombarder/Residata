/**
 * The marketing pages exist once per language at their own address
 * (routing.SK_PATHS). Until 2026-09-28 both languages shared one URL and the
 * language was app state, so Google had no Slovak page to show a Slovak searcher.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SK_PATHS, pageToPath, pathToPage, pathLang } from "./routing.js";

const HERE = dirname(fileURLToPath(import.meta.url));

test("every Slovak address leads to its page and back, and says it is Slovak", () => {
  for (const [page, sk] of Object.entries(SK_PATHS)) {
    assert.equal(pageToPath(page, "sk"), sk);
    assert.equal(pathToPage(sk), page, `${sk} does not lead back to ${page}`);
    assert.equal(pathToPage(sk + "/"), page, "a trailing slash must not change the page");
    assert.equal(pathLang(sk), "sk");
    assert.equal(pathLang(pageToPath(page, "en")), null, "an English address must not claim a language");
  }
  assert.equal(pathToPage("/sk/no-such-page"), "Home");
  assert.equal(pageToPath("Insights", "sk"), "/analyzy", "the analyses keep their one address");
  assert.equal(pageToPath("Privacy", "sk"), "/privacy", "a page without a twin keeps its one address");
});

test("no Slovak address collides with another page's address", () => {
  const all = Object.values(SK_PATHS);
  assert.equal(new Set(all).size, all.length);
  for (const sk of all) assert.ok(sk === "/sk" || sk.startsWith("/sk/"));
});

test("the build pre-renders every Slovak twin, the Slovak homepage included", () => {
  const pre = readFileSync(join(HERE, "..", "..", "scripts", "prerender.mjs"), "utf8");
  assert.match(pre, /const twin = SK_PATHS\[pageKey\];/, "prerender.mjs no longer writes the Slovak twins");
  assert.match(pre, /writeHead\(SK_PATHS\.Home, "Home", "sk"\)/, "prerender.mjs no longer writes the Slovak homepage");
  const tpl = readFileSync(join(HERE, "..", "..", "index.html"), "utf8");
  assert.ok(tpl.includes('hreflang="sk" href="https://residata.eu/sk"'), "the homepage must name /sk as its Slovak version");
});
