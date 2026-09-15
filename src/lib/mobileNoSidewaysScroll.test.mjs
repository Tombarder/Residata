/**
 * Guard: an aspect-ratio box must pin its width, or it overflows the phone.
 *
 * 🔴 WHY (2026-09-15). Measured live at 375px: /sample scrolled sideways —
 * document scrollWidth 405 against a 375 viewport. One element caused all of it.
 * It carried `aspectRatio: "4 / 3"` and `minHeight: 280` and no width, which
 * gives the box an intrinsic MINIMUM WIDTH of 280 × 4/3 = 373.33px. The measured
 * width was 373.328px. It kept that width even though its grid column was 311px,
 * pushed past the right edge, and dragged the whole page sideways with it.
 *
 * Sideways scroll is the single most obvious "this site is broken" signal on a
 * phone, and a phone is where a shared link is opened. Pinning the width makes
 * the ratio derive HEIGHT from the column instead of width from the height —
 * verified live: 405 → 375, the box becomes 311×280, desktop unchanged.
 *
 * Every other aspect-ratio box in the codebase already pins width, so this guard
 * codifies the house pattern rather than inventing one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");

/** Every .jsx under src/, read once. */
function jsxFiles(dir = SRC, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) jsxFiles(full, acc);
    else if (name.endsWith(".jsx")) acc.push([full, readFileSync(full, "utf8")]);
  }
  return acc;
}

test("every aspectRatio box pins its width", () => {
  const files = jsxFiles();
  assert.ok(files.length > 5, `read ${files.length} jsx files — guard would be vacuous`);

  let checked = 0;
  for (const [path, src] of files) {
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (!/aspectRatio\s*:/.test(line)) return;
      checked++;
      // The style object can span lines; look at a small window around it, which
      // is how these are actually written.
      const window = lines.slice(Math.max(0, i - 12), i + 6).join("\n");
      const pinsWidth = /\bwidth\s*:\s*["'`]?\s*(100%|[0-9])/.test(window);
      const hasMinHeight = /\bminHeight\s*:/.test(window);
      assert.ok(pinsWidth || !hasMinHeight,
        `${path.replace(SRC, "src")}:${i + 1} sets aspectRatio with minHeight and no width. ` +
        `That box has an intrinsic minimum width of minHeight × ratio and will push ` +
        `the page sideways on a phone — exactly what /sample did at 375px.`);
    });
  }
  assert.ok(checked >= 1, "found no aspectRatio at all — this guard reads nothing");
});
