/**
 * Run with:  node --test src/lib/maplibreWorker.test.mjs
 *
 * These exist because of a bug that produced no error of any kind: MapLibre 6 builds
 * its tile worker at runtime from a file Vite never emitted, the SPA rewrite answered
 * with index.html, and `new Worker(anHtmlPage, {type:"module"})` failed silently. The
 * map went black while mount, canvas size, controls, sprite and glyphs all stayed
 * green. A clean build and a green suite could not see it.
 *
 * The FIRST fix could not see it either. `?url` emitted the worker and nothing for
 * the `./maplibre-gl-shared.mjs` the worker imports, so it still died — one 404
 * further along. That is why the central test here is not "is the worker emitted"
 * but "is EVERY file the worker reaches for emitted with it".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const DIST = "node_modules/maplibre-gl/dist";

/** The file list the build plugin ships, read from the config rather than retyped. */
function shippedFiles() {
  const cfg = read("vite.config.js");
  const m = /const FILES = \[([^\]]*)\]/.exec(cfg);
  assert.ok(m, "maplibreWorkerAssets lost its FILES list");
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

test("every module the worker imports is shipped beside it", () => {
  const shipped = shippedFiles();
  const entry = "maplibre-gl-worker.mjs";
  assert.ok(shipped.includes(entry), `the worker itself (${entry}) is not in FILES`);

  // Walk the worker's relative imports transitively — the same graph the browser
  // walks when it loads the worker as a module.
  const seen = new Set();
  const queue = [entry];
  const missing = [];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    const p = join(DIST, f);
    assert.ok(existsSync(join(root, p)), `${p} is not in the package — MapLibre moved or renamed it`);
    for (const m of read(p).matchAll(/from\s*["'](\.\/[^"']+)["']/g)) {
      const dep = m[1].replace(/^\.\//, "");
      if (!shipped.includes(dep)) missing.push(`${f} imports ${dep}`);
      queue.push(dep);
    }
  }
  assert.deepEqual(
    missing,
    [],
    "the worker reaches for files the build does not emit, so it will 404 and the map " +
      "will go black with no error anywhere. Add them to FILES in vite.config.js: " +
      missing.join("; "),
  );
});

test("the build plugin is registered and the app uses the URL it defines", () => {
  const cfg = read("vite.config.js");
  assert.match(cfg, /plugins:\s*\[[^\]]*maplibreWorkerAssets\(\)/, "plugin not registered");
  assert.match(cfg, /__MAPLIBRE_WORKER_URL__/, "plugin no longer defines the worker URL");
  assert.match(cfg, /configureServer/, "dev would stop serving the worker, so dev and prod could diverge again");
  const app = read("src/lib/maplibreWorker.js");
  assert.match(app, /setWorkerUrl\(workerUrl\)/);
  assert.match(app, /__MAPLIBRE_WORKER_URL__/);
});

test("every page that builds a map says where the worker is", () => {
  const pages = ["MapView.jsx", "MapView2.jsx", "LocationManager.jsx"];
  const offenders = [];
  for (const f of pages) {
    const src = read(join("src", "pages", f));
    if (!/new\s+maplibregl\.Map\s*\(/.test(src)) continue;
    if (!/lib\/maplibreWorker/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `these construct a map without importing lib/maplibreWorker: ${offenders.join(", ")}`);
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
