/**
 * The fixed header stack (trial banner → nav → ticker) is kept in order by CSS
 * rules in App.jsx that find the nav and the ticker by a selector. When the
 * ticker's selector stopped matching (2026-06-30: an a11y pass swapped the
 * aria-label the rule used for aria-hidden), the ticker sat hidden behind the
 * nav for every visitor shown the banner — for three months, with nothing red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(SRC, "App.jsx"), "utf8");
const ticker = readFileSync(join(SRC, "components", "Ticker.jsx"), "utf8");

test("the banner rules find the nav and the ticker by the classes those components carry", () => {
  assert.match(app, /body\.residata-has-trial-banner \.marketing-nav \{ top: var\(--trial-banner-h/, "the nav rule is gone or renamed");
  assert.match(app, /body\.residata-has-trial-banner \.residata-ticker \{ top: calc\(var\(--trial-banner-h/, "the ticker rule is gone or renamed");
  assert.match(app, /className="marketing-nav"/, "Nav no longer carries marketing-nav");
  const wrappers = ticker.match(/<div className="residata-ticker" style=\{styles\.wrapper\}/g) || [];
  assert.equal(wrappers.length, 2, "both Ticker states (loading and loaded) must carry residata-ticker");
  assert.doesNotMatch(app, /\[aria-label="Live market ticker"\]/, "style by class, never by an a11y attribute");
});

test("a pre-built page lets the banner push its text down below the same width the app pads at", () => {
  const css = readFileSync(join(SRC, "index.css"), "utf8");
  const appBp = (app.match(/@media \(max-width: (\d+)px\) \{\s*body\.residata-has-trial-banner \.page-transition \{ padding-top: var\(--trial-banner-h/) || [])[1];
  const staticBp = (css.match(/@media \(max-width: (\d+)px\) \{\s*\.rd-static-banner \.rd-trial-banner \{ position: relative !important; \}/) || [])[1];
  assert.ok(appBp, "App.jsx's banner padding rule is gone or reworded");
  assert.ok(staticBp, "index.css's pre-built banner rule is gone or reworded");
  assert.equal(staticBp, appBp, "the two breakpoints must match, or the text jumps when the app starts");
});
