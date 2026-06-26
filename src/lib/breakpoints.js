/**
 * Responsive breakpoints — single source of truth (JS side).
 *
 * CSS `@media` can't read CSS custom properties, so the canonical breakpoint
 * values live in two mirrored places that MUST stay in sync:
 *   • here (for the rare logic that needs a breakpoint in JS — the mobile nav)
 *   • src/styles/responsive.css (documented constants used by every @media)
 *
 * The scale is intentionally small + named. Use these four values for new work
 * instead of inventing ad-hoc pixel numbers.
 *
 *   phone     ≤ 480px   phones, portrait
 *   phoneLg   ≤ 640px   large phones · phones landscape · dense grids → 1 column
 *   tablet    ≤ 900px   tablets portrait · multi-column marketing grids → 1 column
 *   desktop   ≤ 1180px  small laptop / tablet landscape · top nav collapses to a menu
 */
import { useEffect, useState } from "react";

export const BP = Object.freeze({
  phone: 480,
  phoneLg: 640,
  tablet: 900,
  desktop: 1180,
});

/** SSR-safe `matchMedia` for "viewport is at most `px` wide". */
export function mqDown(px) {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia(`(max-width: ${px}px)`);
}

/**
 * React hook — true while the viewport is at most `px` wide. Subscribes to the
 * media query (not raw resize) so it only re-renders when the boolean actually
 * flips, and updates correctly on orientation change. SSR-safe (returns false
 * on the server / first paint, corrects on mount).
 */
export function useBreakpointDown(px) {
  const [down, setDown] = useState(() => {
    const mq = mqDown(px);
    return mq ? mq.matches : false;
  });
  useEffect(() => {
    const mq = mqDown(px);
    if (!mq) return;
    const onChange = (e) => setDown(e.matches);
    setDown(mq.matches); // resync in case width changed before listener attached
    // addEventListener('change') is the modern API; older Safari needs addListener.
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [px]);
  return down;
}

/** True while the top nav should be collapsed into the hamburger menu. */
export function useNavCollapsed() {
  return useBreakpointDown(BP.desktop);
}
