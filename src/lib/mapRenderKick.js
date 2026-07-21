/* kickFirstRender — work around a MapLibre first-paint quirk.

   On mount the map can settle with a CORRECT transform (container already at its
   final size) yet never start its tile-load loop: map.loaded() stays false, ZERO
   tiles are requested and the canvas paints BLANK until the browser window is
   resized. Root-caused live (Boss 2026-07-21: Map view + Market Radar blank on
   first open).

   Two things matter:
   1. A plain map.resize() is a NO-OP when the container size is unchanged, so it
      never re-triggers tile loading. The reliable kick is a resize with a REAL
      dimension delta — briefly shrink the container, resize, restore, resize —
      all in one synchronous frame so the intermediate size is never painted and
      the user sees no flicker.
   2. TIMING: the map mounts *inside* the page-transition fade (a 0.3s CSS
      animation). Kicking during that animation doesn't take; the render loop only
      starts reliably once layout has settled. So we kick when the ancestor's
      animation ends — with an immediate attempt (in case there's no animation or
      it already finished) and a timeout fallback (reduced-motion / no wrapper). */
export function kickFirstRender(map) {
  const kick = () => {
    try {
      const c = map.getContainer();
      if (!c) return;
      const h = c.style.height;
      // 1px differs from the real (hundreds-of-px) height, so the rounded pixel
      // size changes and resize() isn't coalesced away.
      c.style.height = "1px";
      map.resize();
      c.style.height = h;
      map.resize();
    } catch {
      // Never let a render-kick failure break map init.
    }
  };

  kick(); // layout may already be stable (load fired after the fade finished)

  // Primary trigger: kick again once the page-transition fade on an ancestor ends,
  // when layout is truly settled and the render loop will actually start.
  try {
    const wrapper = map.getContainer()?.closest(".page-transition");
    if (wrapper) wrapper.addEventListener("animationend", kick, { once: true });
  } catch {
    /* closest() unsupported — the fallback below still covers it. */
  }

  // Fallback safety net if no animationend fires (no wrapper / reduced-motion).
  // Comfortably past the 0.3s fade.
  setTimeout(kick, 450);
}
