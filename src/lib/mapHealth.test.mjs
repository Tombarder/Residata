/**
 * Tests for mapHealth — run with:  node --test src/lib/mapHealth.test.mjs
 * Zero-dependency (node:test + node:assert), fake timers, fake maplibre Map.
 *
 * What is actually being defended here: the FIRST version of this check (shipped
 * 2026-08-19) took ONE reading four seconds after the map settled and made that
 * answer permanent — an opaque panel over the map, accusing the user's graphics
 * driver, with no way back except reloading the page. One unlucky reading and a
 * working map was gone. So the contract worth testing is not "does it detect a
 * dead GPU" but "can a healthy map ever lose its map to this code" — no — and
 * "does a wrong verdict take itself back" — yes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { watchMapHealth } from "./mapHealth.js";

/**
 * node:test's mock timers do not cascade into timers scheduled *during* a tick,
 * and this module reschedules itself after every reading — so advance in steps,
 * the way real time arrives.
 */
const advance = (t, totalMs, stepMs = 1000) => {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) t.mock.timers.tick(stepMs);
};

/** Minimal stand-in for a maplibre Map + its canvas. */
function fakeMap({ drawn = 0, styleLoaded = true, size = [800, 600] } = {}) {
  const listeners = {};
  const canvasHandlers = {};
  const canvas = {
    width: size[0], height: size[1],
    addEventListener: (t, fn) => { (canvasHandlers[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { canvasHandlers[t] = (canvasHandlers[t] || []).filter((f) => f !== fn); },
  };
  return {
    _drawn: drawn,
    canvasHandlers,
    getCanvas: () => canvas,
    isStyleLoaded: () => styleLoaded,
    queryRenderedFeatures() { return new Array(this._drawn).fill({}); },
    resize() {}, triggerRepaint() {},
    once: (evt, fn) => { (listeners[evt] ||= []).push(fn); },
    on: (evt, fn) => { (listeners[evt] ||= []).push(fn); },
    fire: (evt) => (listeners[evt] || []).forEach((fn) => fn()),
    fireCanvas: (evt, e) => (canvasHandlers[evt] || []).forEach((fn) => fn(e)),
  };
}

const withVisibleDocument = (fn) => {
  const had = "document" in globalThis;
  const prev = globalThis.document;
  globalThis.document = { visibilityState: "visible" };
  try { return fn(globalThis.document); } finally { if (had) globalThis.document = prev; else delete globalThis.document; }
};

const collect = () => {
  const calls = { fail: [], ok: 0 };
  return [calls, { onFail: (f) => calls.fail.push(f), onOk: () => { calls.ok += 1; } }];
};

test("a drawing map is never accused, and polling stops after one good reading", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 412 });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 120000);                    // two full minutes of chances to get it wrong
    assert.equal(calls.fail.length, 0);
  });
});

test("one blank reading is not a verdict — three in a row are", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 0 });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 5000);  assert.equal(calls.fail.length, 0, "1st blank reading must not accuse");
    advance(t, 5000);  assert.equal(calls.fail.length, 0, "2nd blank reading must not accuse");
    advance(t, 5000);  assert.equal(calls.fail.length, 1, "3rd agreeing reading may accuse");
    assert.equal(calls.fail[0].reason, "gpu");
    advance(t, 120000);
    assert.equal(calls.fail.length, 1, "it accuses once, not once per check");
  });
});

test("a verdict takes itself back the moment the map is seen drawing", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 0 });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 15000);
    assert.equal(calls.fail.length, 1);
    map._drawn = 300;                       // the machine started painting after all
    advance(t, 20000);                      // recovery re-check
    assert.equal(calls.ok, 1, "the map must be handed back without a page reload");
  });
});

test("a hidden tab is never evidence — the browser stops painting it on purpose", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument((doc) => {
    doc.visibilityState = "hidden";
    const map = fakeMap({ drawn: 0 });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 300000);
    assert.equal(calls.fail.length, 0, "a backgrounded tab must not be called a broken GPU");
  });
});

test("a style swap in flight is never evidence (the theme toggle empties the map)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 0, styleLoaded: false });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 300000);
    assert.equal(calls.fail.length, 0);
  });
});

test("a zero-size canvas is never evidence", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 0, size: [0, 0] });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 300000);
    assert.equal(calls.fail.length, 0);
  });
});

test("losing the graphics context is reported at once, and not silently", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 900 });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("load");
    let prevented = false;
    map.fireCanvas("webglcontextlost", { preventDefault: () => { prevented = true; } });
    assert.equal(calls.fail.length, 1);
    assert.equal(calls.fail[0].reason, "gpu-lost");
    assert.equal(prevented, true, "without preventDefault the browser never offers the context back");
  });
});

test("a restored context clears the notice once the map is proven drawing again", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 900 });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("load");
    map.fireCanvas("webglcontextlost", { preventDefault() {} });
    map.fireCanvas("webglcontextrestored", {});
    advance(t, 5000);
    assert.equal(calls.ok, 1);
  });
});

test("stop() unsubscribes: nothing is reported after the map is gone", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 0 });
    const [calls, cbs] = collect();
    const stop = watchMapHealth(map, cbs);
    map.fire("idle");
    stop();
    advance(t, 300000);
    map.fireCanvas("webglcontextlost", { preventDefault() {} });
    assert.equal(calls.fail.length, 0);
  });
});

test("a component that has moved on is never spoken for (isCurrent false)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 0 });
    const [calls, cbs] = collect();
    watchMapHealth(map, { ...cbs, isCurrent: () => false });
    map.fire("idle");
    advance(t, 300000);
    map.fireCanvas("webglcontextlost", { preventDefault() {} });
    assert.equal(calls.fail.length, 0);
  });
});
