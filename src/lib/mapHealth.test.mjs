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

/** Minimal stand-in for a maplibre Map + its canvas.
 *
 * `painted` is the pixel side of the world and it is SEPARATE from `drawn` on
 * purpose: the failure this module exists for is a map that reports plenty of
 * features to draw while the canvas reaches the screen as one flat colour.
 *   painted: true   — the grid reads back varied colours (a real map)
 *   painted: false  — every pixel identical (the black rectangle)
 *   painted: null   — no WebGL context to read (cannot tell, never a verdict)
 */
function fakeMap({ drawn = 0, styleLoaded = true, size = [800, 600], painted = true } = {}) {
  const listeners = {};
  const canvasHandlers = {};
  const self = {
    _drawn: drawn,
    _painted: painted,
    _redraws: 0,
  };
  const canvas = {
    width: size[0], height: size[1],
    getContext: (kind) => {
      if (self._painted === null) return null;
      if (kind !== "webgl2" && kind !== "webgl") return null;
      let n = 0;
      return {
        isContextLost: () => false,
        RGBA: 1, UNSIGNED_BYTE: 1,
        readPixels: (x, y, w, h, fmt, type, out) => {
          // Uniform grey when nothing is painted; a varying value otherwise.
          const v = self._painted ? (n++ * 37) % 255 : 9;
          out[0] = v; out[1] = v; out[2] = v; out[3] = 255;
        },
      };
    },
    addEventListener: (t, fn) => { (canvasHandlers[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { canvasHandlers[t] = (canvasHandlers[t] || []).filter((f) => f !== fn); },
  };
  return Object.assign(self, {
    canvasHandlers,
    getCanvas: () => canvas,
    _styleLoaded: styleLoaded,
    redraw() { this._redraws += 1; },
    isStyleLoaded() { return this._styleLoaded; },
    queryRenderedFeatures() { return new Array(this._drawn).fill({}); },
    resize() {}, triggerRepaint() {},
    once: (evt, fn) => { (listeners[evt] ||= []).push(fn); },
    on: (evt, fn) => { (listeners[evt] ||= []).push(fn); },
    fire: (evt) => (listeners[evt] || []).forEach((fn) => fn()),
    fireCanvas: (evt, e) => (canvasHandlers[evt] || []).forEach((fn) => fn(e)),
  });
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
    // The real failure: maplibre HAS features to draw and the canvas comes back
    // one flat colour. `drawn: 0` used to stand in for this and it is a different
    // thing entirely — an empty view is not a broken machine.
    const map = fakeMap({ drawn: 412, painted: false });
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
    const map = fakeMap({ drawn: 412, painted: false });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 15000);
    assert.equal(calls.fail.length, 1);
    map._painted = true;                    // the machine started painting after all
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

/* This test used to model "a style swap in flight" as a style that is NEVER
   loaded, and assert that nothing is ever reported. That is not a swap — it is a
   map that never loads, and asserting silence for it is precisely what let both
   maps sit black for three days in September 2026 while this module said nothing.
   A swap is TEMPORARY, so it is now modelled temporarily, and the permanent case
   has a test of its own below saying the opposite. */
test("a style swap in flight is never evidence (the theme toggle empties the map)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 3, styleLoaded: false });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 8000);                 // the empty moment during setStyle
    map._styleLoaded = true;          // …and the new style arrives
    advance(t, 300000);
    assert.equal(calls.fail.length, 0, "a theme toggle must never accuse anything");
  });
});

test("a map whose style NEVER loads is reported — it used to be the one silent failure", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 0, styleLoaded: false });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    // Deliberately fire NEITHER load nor idle: when the style never completes,
    // maplibre never fires them, which is half of why this went unseen.
    advance(t, 300000);
    assert.equal(calls.fail.length, 1, "exactly one verdict, not a stream of them");
    assert.equal(calls.fail[0].reason, "never-loaded");
    assert.match(calls.fail[0].detail, /not your computer/i,
      "the copy must not send the user off to change graphics settings for our bug");
  });
});

test("a late-loading style takes the accusation back", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 4, styleLoaded: false });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    advance(t, 60000);
    assert.equal(calls.fail.length, 1, "accused after a minute of nothing");
    map._styleLoaded = true;
    advance(t, 60000);
    assert.equal(calls.ok, 1, "a map that arrives late must get its screen back");
  });
});

test("an unloaded style on a hidden tab is never evidence", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument((doc) => {
    doc.visibilityState = "hidden";
    const map = fakeMap({ drawn: 0, styleLoaded: false });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    advance(t, 300000);
    assert.equal(calls.fail.length, 0, "a background tab loads nothing on purpose");
  });
});

test("an unloaded style on a zero-size canvas is never evidence", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 0, styleLoaded: false, size: [0, 0] });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
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

/* ── 2026-09-24: the two reasons a black map stayed silent for months ──────────
 *
 * Boss, on his Windows laptop: both maps show for about a second and are then a
 * black rectangle with NO TEXT on it, for months, while the sidebar, top bar and
 * filters stay put. No text is the whole tell — every verdict in this file puts
 * words on screen, so a silent black rectangle means no verdict was ever reached.
 *
 * Two independent reasons it could not be reached, both fixed together: the
 * watcher switched itself off after one good reading, and its "is it drawing"
 * test never looked at a pixel.
 */

test("a map that goes black AFTER it was drawing is still caught", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 412, painted: true });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 20000);
    assert.equal(calls.fail.length, 0, "a healthy map must not be accused");

    // The canvas stops reaching the screen — and crucially NO webglcontextlost
    // fires, because the browser believes it drew. This is the reported failure.
    map._painted = false;
    advance(t, 240000);
    assert.equal(calls.fail.length, 1,
      "the map went black after drawing and nothing said so — the months-long silence");
    assert.equal(calls.fail[0].reason, "gpu");
  });
});

test("the paint check reads the canvas, not maplibre's opinion of it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    // queryRenderedFeatures reports plenty to draw — it reads the style and the
    // loaded tiles, never a pixel — while the canvas is one flat colour.
    const map = fakeMap({ drawn: 900, painted: false });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 20000);
    assert.equal(calls.fail.length, 1, "features-to-draw must not pass for pixels-drawn");
    assert.match(calls.fail[0].detail, /single flat colour/);
  });
});

test("an empty view is not a broken machine", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    // A filter that matches nothing over open sea is legitimately one flat colour.
    // Accusing the user's graphics for it would be the 2026-08-19 mistake again.
    const map = fakeMap({ drawn: 0, painted: false });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 240000);
    assert.equal(calls.fail.length, 0);
  });
});

test("a canvas that cannot be read is never a verdict", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 412, painted: null });   // no WebGL context to read
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 240000);
    assert.equal(calls.fail.length, 0, "\"could not look\" must never become \"it is broken\"");
  });
});

test("the paint check renders before reading — maplibre keeps no drawing buffer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withVisibleDocument(() => {
    const map = fakeMap({ drawn: 412, painted: true });
    const [calls, cbs] = collect();
    watchMapHealth(map, cbs);
    map.fire("idle");
    advance(t, 20000);
    assert.ok(map._redraws > 0,
      "without redraw() the buffer is already cleared and every healthy map reads blank");
  });
});
