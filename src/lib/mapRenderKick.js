/* kickFirstRender — work around a MapLibre first-paint quirk.

   On mount the map can settle with a CORRECT transform (container already at its
   final size) yet never start its tile-load loop: map.loaded() stays false, ZERO
   tiles are requested and the canvas paints BLANK until the browser window is
   resized. Root-caused live (Boss 2026-07-21: Map view + Market Radar blank on
   first open).

   Why a plain resize() doesn't fix it: MapLibre no-ops resize() when the container
   size is unchanged, so nothing re-triggers tile loading. The reliable kick is a
   resize with a REAL dimension delta — briefly shrink the container, resize,
   restore, resize — all in one synchronous frame, so the intermediate size is
   never painted and the user sees no flicker.

   Timing: the map must not be mid-layout-animation when kicked. Map pages now skip
   the page-transition fade (see Platform.jsx), so layout is stable at 'load' and we
   kick immediately + on the next two animation frames — the map paints instantly.
   The animationend listener + timeout stay as belt-and-suspenders for any context
   where the map still mounts inside an animated ancestor. */
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

  // Instant path: layout is stable (map pages don't fade), so kick right away and
  // again on the next two frames to catch the moment the WebGL context is ready.
  kick();
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() => { kick(); requestAnimationFrame(kick); });
  }

  // Fallbacks for any context where the map DOES mount inside an animated ancestor
  // (kick once the fade ends, and a timed net for reduced-motion / no wrapper).
  try {
    const wrapper = map.getContainer()?.closest(".page-transition");
    if (wrapper) wrapper.addEventListener("animationend", kick, { once: true });
  } catch {
    /* closest() unsupported — the timeout below still covers it. */
  }
  setTimeout(kick, 450);
}
