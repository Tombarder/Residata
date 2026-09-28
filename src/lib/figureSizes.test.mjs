/**
 * Every chart of a generated issue carries its drawing's own size, so the page
 * reserves the chart's space before the image arrives. Without it each chart
 * that loaded pushed the text below it down (~780 px per chart on a phone —
 * Lighthouse: "media element lacking an explicit size").
 *
 * Runs the real row builder (drafts/to_cms.py) on a committed issue and holds
 * each recorded size to the file it describes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function viewBox(src) {
  const svg = readFileSync(join(ROOT, "public", src), "utf8").slice(0, 4000);
  const tag = /<svg\b[^>]*>/.exec(svg)[0];
  const m = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(tag);
  return [Number(m[1]), Number(m[2])];
}

test("every chart of a generated issue carries its drawing's own size, phone drawing included", () => {
  const r = spawnSync("python3", ["src/content/analyzy/drafts/to_cms.py", "ke-prehlad-2026-q3"],
    { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const figures = JSON.parse(r.stdout).blocks.filter((b) => b.type === "figure");
  assert.ok(figures.length >= 3, `expected the issue's charts, found ${figures.length}`);
  for (const f of figures) {
    const [w, h] = viewBox(f.src);
    // rounded once, on the Python side — within half a unit of the file
    assert.ok(Math.abs(f.w - w) <= 0.5 && Math.abs(f.h - h) <= 0.5, `${f.src}: ${f.w}×${f.h}, file says ${w}×${h}`);
    assert.ok(f.srcM, `${f.src} has no phone drawing`);
    const [wm, hm] = viewBox(f.srcM);
    assert.ok(Math.abs(f.wM - wm) <= 0.5 && Math.abs(f.hM - hm) <= 0.5, `${f.srcM}: ${f.wM}×${f.hM}, file says ${wm}×${hm}`);
  }
});
