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
 * How long a VISIBLE, sized map may go without its style finishing before that is
 * itself the failure. Counted in eligible time only, so a tab left in the
 * background for an hour is not accused the moment it is looked at.
 *
 * This exists because of 2026-09-14, when both maps were black for three days and
 * this module said nothing at all. MapLibre 6 could not load its tile worker, so
 * the style never finished; `load` and `idle` therefore never fired, so the
 * sampler below was never even started; and `meaningful` requires isStyleLoaded(),
 * so every reading would have been skipped anyway. The one shape of failure
 * MapUnavailable exists to catch — a black rectangle — was the one shape this
 * watcher was structurally unable to see.
 */
const NEVER_LOADED_AFTER_MS = 25000;

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
  // Whichever of load/idle comes first.
  let started = false;
  const begin = () => { if (started) return; started = true; schedule(CONFIRM_EVERY_MS); };
  map.once("idle", begin);
  map.once("load", begin);

  // ── Failure mode 3: the map never finishes loading at all ──
  // The comment above used to claim load/idle covered a map whose tiles never
  // arrive. It does not: when the style itself never completes, NEITHER event
  // fires, and the watcher simply never runs. So this one starts on its own,
  // immediately, and owes no debt to either event.
  let ungraded = 0;
  let neverLoaded = false;
  let watchdog = null;
  const eligible = () => {
    const c = typeof map.getCanvas === "function" ? map.getCanvas() : null;
    return (typeof document === "undefined" || document.visibilityState === "visible")
      && !!c && c.width > 0 && c.height > 0;
  };
  const tick = () => {
    if (stopped || !isCurrent()) return;
    let loaded = false;
    try { loaded = map.isStyleLoaded(); } catch { loaded = false; }
    if (loaded) {
      // It got there. Hand over to the normal sampler and withdraw any accusation.
      if (neverLoaded) { neverLoaded = false; accused = false; onOk && onOk(); }
      begin();
      return;                       // no further watchdog ticks — sample() owns it now
    }
    if (eligible()) ungraded += CONFIRM_EVERY_MS;
    if (ungraded >= NEVER_LOADED_AFTER_MS && !neverLoaded && !accused) {
      neverLoaded = true;
      accused = true;
      onFail && onFail({
        reason: "never-loaded",
        detail: `The map's style did not finish loading after ${NEVER_LOADED_AFTER_MS / 1000}s on screen — `
              + "the base map or its tile worker did not load. This is not your computer.",
      });
    }
    watchdog = setTimeout(tick, CONFIRM_EVERY_MS);
  };
  watchdog = setTimeout(tick, CONFIRM_EVERY_MS);

  return function stop() {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    if (canvas) {
      canvas.removeEventListener("webglcontextlost", onLost, false);
      canvas.removeEventListener("webglcontextrestored", onRestored, false);
    }
  };
}
