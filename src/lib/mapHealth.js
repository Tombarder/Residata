/**
 * mapHealth.js — is this machine actually drawing the map, and can we take it back?
 *
 * Two failure modes live here, both of which look identical on screen (a black
 * rectangle) and neither of which is our data's fault:
 *
 *   1. The graphics stack never paints. The style and the tiles arrived, maplibre
 *      is running — the readouts above the map change as you pan — but nothing is
 *      drawn. A broken or ancient driver does this.
 *   2. The browser LOSES the graphics context mid-session. The map draws for a
 *      moment, then the canvas goes black and stays black. Before this module we
 *      never listened for that at all, so it was the one way a map could still
 *      fail completely silently — the exact thing `MapUnavailable` exists to stop.
 *
 * The rule that shapes the whole file: **a wrong verdict must never cost the user
 * a working map.** The first version of this check (2026-08-19) sampled ONCE, four
 * seconds after the first idle, and its answer was permanent — one unlucky reading
 * and an opaque sheet sat over a perfectly good map until the page was reloaded.
 * So now: several readings have to agree before we accuse the machine, readings are
 * skipped whenever they would be meaningless (hidden tab, zero-size canvas, a style
 * swap in flight), and the check keeps running afterwards so a verdict that turns
 * out to be wrong clears itself.
 */

/** How many blank readings in a row before we say the machine isn't painting. */
const CONFIRM_BLANKS = 3;
/** While deciding — long enough apart that a slow machine gets a fair chance. */
const CONFIRM_EVERY_MS = 5000;
/** After a verdict — keep looking, so we can hand the map back if it recovers. */
const RECHECK_EVERY_MS = 20000;

/**
 * Watch one maplibre map. Returns a stop() to call on unmount.
 *
 * @param map        the maplibre Map
 * @param onFail     ({reason, detail}) => void   — reason is "gpu" or "gpu-lost"
 * @param onOk       () => void                   — an earlier verdict proved wrong
 * @param isCurrent  () => boolean                — false once the component moved on
 */
export function watchMapHealth(map, { onFail, onOk, isCurrent = () => true }) {
  let blanks = 0;
  let accused = false;
  let timer = null;
  let stopped = false;

  const schedule = (ms) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(sample, ms);
  };

  function sample() {
    if (stopped || !isCurrent()) return;

    // Readings that cannot mean anything are not readings. A hidden tab is
    // throttled to no frames on purpose; a zero-size canvas has nothing to draw
    // into; and during a setStyle (the theme toggle) the map is legitimately
    // empty for a moment. Taking any of these as evidence is how a healthy map
    // gets accused.
    const canvas = typeof map.getCanvas === "function" ? map.getCanvas() : null;
    const meaningful =
      (typeof document === "undefined" || document.visibilityState === "visible") &&
      canvas && canvas.width > 0 && canvas.height > 0 &&
      map.isStyleLoaded();
    if (!meaningful) return schedule(RECHECK_EVERY_MS);   // nothing to learn yet — look again later, cheaply

    let drawn;
    try { drawn = map.queryRenderedFeatures().length; } catch { return schedule(CONFIRM_EVERY_MS); }

    if (drawn > 0) {
      blanks = 0;
      if (accused) { accused = false; onOk && onOk(); }
      // A drawing map needs no further polling — a context that dies later
      // announces itself through the webglcontextlost event below.
      return;
    }

    blanks += 1;
    if (blanks >= CONFIRM_BLANKS && !accused) {
      accused = true;
      onFail && onFail({
        reason: "gpu",
        detail: `The map style and its tiles loaded, but nothing was rendered in ${CONFIRM_BLANKS} checks over ${(CONFIRM_BLANKS * CONFIRM_EVERY_MS) / 1000}s — the browser's graphics layer is not drawing.`,
      });
    }
    schedule(accused ? RECHECK_EVERY_MS : CONFIRM_EVERY_MS);
  }

  // ── Failure mode 2: the context dies underneath a map that was working ──
  const canvas = typeof map.getCanvas === "function" ? map.getCanvas() : null;
  const onLost = (e) => {
    // Without preventDefault the browser will never offer the context back.
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (!isCurrent()) return;
    accused = true;
    onFail && onFail({
      reason: "gpu-lost",
      detail: "The browser lost its WebGL context while the map was running (driver reset, GPU out of memory, or the machine went to sleep).",
    });
  };
  const onRestored = () => {
    if (!isCurrent()) return;
    try { map.resize(); map.triggerRepaint(); } catch { /* the map may already be gone */ }
    blanks = 0;
    schedule(CONFIRM_EVERY_MS);   // prove it draws again before clearing the notice
  };
  if (canvas) {
    canvas.addEventListener("webglcontextlost", onLost, false);
    canvas.addEventListener("webglcontextrestored", onRestored, false);
  }

  // ── Failure mode 1: start looking once the map claims to have settled ──
  // Whichever of load/idle comes first: "idle" alone would never arrive on a map
  // whose tiles never finish, and that map deserves an answer too.
  let started = false;
  const begin = () => { if (started) return; started = true; schedule(CONFIRM_EVERY_MS); };
  map.once("idle", begin);
  map.once("load", begin);

  return function stop() {
    stopped = true;
    clearTimeout(timer);
    if (canvas) {
      canvas.removeEventListener("webglcontextlost", onLost, false);
      canvas.removeEventListener("webglcontextrestored", onRestored, false);
    }
  };
}
