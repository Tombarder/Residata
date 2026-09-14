/**
 * Run with:  node --test src/lib/maplibreWorker.test.mjs
 *
 * These tests exist because of a bug that produced NO error of any kind. MapLibre 6
 * loads its tile worker from a sibling file resolved at runtime; Vite never emitted
 * it, the SPA rewrite answered the request with index.html, and the map went black
 * while every other sign of health — mount, canvas size, controls, attribution,
 * sprite, glyphs — stayed green. It shipped because nothing could catch it: the
 * build was clean, the tests passed, and the only proof is a WebGL composite that
 * neither browser surface available here will render.
 *
 * So the three facts the fix rests on are asserted as facts, statically.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("the worker file we point at is really in the package", () => {
  const spec = "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs";
  assert.ok(
    existsSync(join(root, spec)),
    `${spec} is gone — MapLibre renamed or moved its worker. Update the import in ` +
      `src/lib/maplibreWorker.js to the new name; do NOT delete it, or the map goes ` +
      `black with no error anywhere.`,
  );
  assert.match(read("src/lib/maplibreWorker.js"), /maplibre-gl\/dist\/maplibre-gl-worker\.mjs\?url/);
  assert.match(read("src/lib/maplibreWorker.js"), /setWorkerUrl\(workerUrl\)/);
});

test("every page that builds a map says where the worker is", () => {
  const pages = readdirSync(join(root, "src", "pages")).filter((f) => /\.jsx?$/.test(f));
  const offenders = [];
  for (const f of pages) {
    const src = read(join("src", "pages", f));
    if (!/new\s+maplibregl\.Map\s*\(/.test(src)) continue;
    if (!/from\s+["']maplibre-gl["']|import\s+\*\s+as\s+maplibregl/.test(src)) continue;
    if (!/lib\/maplibreWorker/.test(src)) offenders.push(f);
  }
  assert.deepEqual(
    offenders,
    [],
    `these construct a MapLibre map without importing lib/maplibreWorker, so they will ` +
      `render a black rectangle in production and report nothing: ${offenders.join(", ")}`,
  );
});

test("the CSP still allows the same-origin worker the fix depends on", () => {
  const csp = JSON.stringify(JSON.parse(read("vercel.json")));
  const m = /worker-src ([^;\\"]*)/.exec(csp);
  assert.ok(m, "no worker-src in the CSP at all");
  assert.match(
    m[1],
    /'self'/,
    "worker-src lost 'self'. MapLibre only blob:-shims a CROSS-origin worker, so a " +
      "blob:-only policy blocks our same-origin one and the map goes black again.",
  );
});
